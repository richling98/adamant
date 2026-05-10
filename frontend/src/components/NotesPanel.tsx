"use client";

import { forwardRef, useState, useEffect, useCallback, useRef, useImperativeHandle } from 'react';
import { Block } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import debounce from 'lodash/debounce';
import { invoke } from '@tauri-apps/api/core';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import '@blocknote/shadcn/style.css';
import {
  MEETING_PANE_CONTAINER_CLASS,
  MEETING_PANE_HEADER_CLASS,
  MEETING_PANE_HEADER_ROW_CLASS,
  MEETING_PANE_TITLE_CLASS,
} from '@/components/MeetingDetails/paneHeaderStyles';

interface NotesPanelProps {
  meetingId: string;
  createdAt?: string;
  isNewNote: boolean;
  draftMeetingId: string | null;
  onMeetingCreated?: (actualMeetingId: string) => void;
  onContentPresenceChange?: (hasContent: boolean) => void;
  onMarkdownChange?: (markdown: string) => void;
  onBlocksChange?: (blocks: Block[] | null) => void;
}

export interface NotesPanelRef {
  flushNotes: (targetMeetingId?: string) => Promise<void>;
}

function blockHasMeaningfulContent(block: any): boolean {
  if (!block) return false;

  if (Array.isArray(block.content)) {
    const inlineHasContent = block.content.some((item: any) => {
      if (typeof item === 'string') return item.trim().length > 0;
      if (item && typeof item.text === 'string') return item.text.trim().length > 0;
      return false;
    });
    if (inlineHasContent) return true;
  }

  if (Array.isArray(block.children)) {
    return block.children.some((child: any) => blockHasMeaningfulContent(child));
  }

  return false;
}

function blocksHaveMeaningfulContent(blocks: Block[] | null | undefined): boolean {
  return Array.isArray(blocks) && blocks.some((block) => blockHasMeaningfulContent(block));
}

// Helper to format timestamp as "just now", "2 minutes ago", etc.
function formatTimestamp(date: Date): string {
  const now = new Date();
  const secondsAgo = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (secondsAgo < 10) return 'just now';
  if (secondsAgo < 60) return `${secondsAgo}s ago`;

  const minutesAgo = Math.floor(secondsAgo / 60);
  if (minutesAgo < 60) return `${minutesAgo}m ago`;

  const hoursAgo = Math.floor(minutesAgo / 60);
  if (hoursAgo < 24) return `${hoursAgo}h ago`;

  const daysAgo = Math.floor(hoursAgo / 24);
  return `${daysAgo}d ago`;
}

function formatCreatedDate(timestamp?: string): string | null {
  if (!timestamp) return null;

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export const NotesPanel = forwardRef<NotesPanelRef, NotesPanelProps>(function NotesPanel({
  meetingId,
  createdAt,
  isNewNote,
  draftMeetingId,
  onMeetingCreated,
  onContentPresenceChange,
  onMarkdownChange,
  onBlocksChange,
}, ref) {
  const renderCount = useRef(0);
  renderCount.current += 1;

  console.debug('🔍 DEBUG NotesPanel RENDER #' + renderCount.current, {
    meetingId,
    isNewNote,
    timestamp: new Date().toISOString().split('T')[1]
  });

  const [noteContent, setNoteContent] = useState<Block[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditorReady, setIsEditorReady] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [noteVersion, setNoteVersion] = useState<number>(1);
  const [actualMeetingId, setActualMeetingId] = useState<string | null>(null);
  const formattedCreatedDate = formatCreatedDate(createdAt);
  const editorRef = useRef<any>(null);
  const justSavedRef = useRef<boolean>(false); // Track if we just saved to avoid reload
  const editorContentRef = useRef<Block[] | null>(null); // Preserve content across re-renders
  const currentMeetingIdRef = useRef<string>(meetingId);
  const loadSequenceRef = useRef(0);
  // Prevents editor.replaceBlocks() (used for content restoration) from
  // triggering a debounced autosave. BlockNote fires onChange synchronously
  // during replaceBlocks; we clear the flag after a microtask to be safe.
  const isRestoringContent = useRef<boolean>(false);
  // `isNewNote` is parent state and can be stale for one render during the
  // URL transition from ?id=new to ?id=<persisted-id>. The route id is the
  // authoritative draft signal for save/load behavior.
  const isDraftMeeting = !meetingId || meetingId === 'new';

  useEffect(() => {
    currentMeetingIdRef.current = meetingId;
  }, [meetingId]);

  // Track component mount/unmount
  useEffect(() => {
    console.debug('🎬 COMPONENT MOUNTED');
    return () => {
      console.debug('💀 COMPONENT UNMOUNTING');
    };
  }, []);

  // Track prop changes
  useEffect(() => {
    console.debug('🔍 DEBUG Props changed:', { meetingId, isNewNote, actualMeetingId });
  }, [meetingId, isNewNote, actualMeetingId]);

  // Convert blocks to markdown
  const blocksToMarkdownSync = (blocks: Block[]): string => {
    const blockToMarkdown = (block: any): string => {
      const inlineText = Array.isArray(block.content)
        ? block.content.map((item: any) => {
            if (typeof item === 'string') return item;
            if (item && typeof item.text === 'string') return item.text;
            return '';
          }).join('')
        : '';

      const childText = Array.isArray(block.children)
        ? block.children.map(blockToMarkdown).filter(Boolean).join('\n')
        : '';

      if (block.type === 'heading') {
        const level = block.props?.level || 1;
        return ['#'.repeat(level) + ' ' + inlineText, childText].filter(Boolean).join('\n');
      }

      return [inlineText, childText].filter(Boolean).join('\n');
    };

    return blocks.map(blockToMarkdown).filter(Boolean).join('\n\n');
  };

  const blocksToMarkdown = async (blocks: Block[]): Promise<string> => blocksToMarkdownSync(blocks);

  // Save note function
  const saveNote = useCallback(async (
    blocks: Block[],
    options: { targetMeetingId?: string } = {}
  ) => {
    const explicitTargetMeetingId = options.targetMeetingId;
    console.debug('🔍 DEBUG saveNote called:', {
      blocksCount: blocks?.length,
      isNewNote,
      actualMeetingId,
      meetingId,
      explicitTargetMeetingId,
    });

    if (!blocks || blocks.length === 0) {
      console.debug('📝 NotesPanel: No content to save');
      return;
    }

    try {
      const contentJson = JSON.stringify(blocks);
      const contentMarkdown = await blocksToMarkdown(blocks);
      const hasMeaningfulContent = blocksHaveMeaningfulContent(blocks);

      console.debug('🔍 DEBUG content to save:', {
        contentJsonLength: contentJson.length,
        contentMarkdown: contentMarkdown.substring(0, 100), // First 100 chars
        hasContent: hasMeaningfulContent
      });

      if (!hasMeaningfulContent) {
        console.debug('📝 NotesPanel: Ignoring empty placeholder document save');
        setHasUnsavedChanges(false);
        return;
      }

      setIsSaving(true);
      setError(null);

      // Scenario 1: New note - need to create meeting first
      if (isDraftMeeting && !actualMeetingId && !explicitTargetMeetingId) {
        console.debug('📝 NotesPanel: Creating new meeting for note...');

        // Create meeting using Tauri command
        const meetingData = await invoke('api_create_meeting', {
          title: 'Untitled Note',
        }) as { id: string; title: string; created_at: string; updated_at: string };

        const newMeetingId = meetingData.id;
        setActualMeetingId(newMeetingId);

        console.debug('✅ NotesPanel: Meeting created:', newMeetingId);

        // Save note using Tauri command FIRST before notifying parent
        const noteData = await invoke('api_save_note', {
          meetingId: newMeetingId,
          contentJson,
          contentMarkdown,
          version: null,
        }) as { version: number; updated_at: string };

        setNoteVersion(noteData.version);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);

        console.debug('✅ NotesPanel: Note created successfully', {
          newMeetingId,
          version: noteData.version,
          contentLength: contentMarkdown.length
        });

        // Set flag to prevent unnecessary reload after save
        justSavedRef.current = true;
        // Preserve content in ref before URL transition triggers prop changes
        editorContentRef.current = blocks;

        // Cancel any pending debounce timer. The URL is about to change from
        // ?id=new to ?id=<uuid>, which causes prop changes and re-renders.
        // Any timer still queued at that point would fire the stale saveNote
        // (isNewNote=true / actualMeetingId=null) and create another meeting.
        debouncedSave.cancel();

        // Notify parent component AFTER note is saved to prevent race condition
        console.debug('🔍 DEBUG: About to call onMeetingCreated callback');
        if (onMeetingCreated) {
          onMeetingCreated(newMeetingId);
          console.debug('🔍 DEBUG: onMeetingCreated callback completed');
        }
      }
      // Scenario 2: Existing note - update it
      else {
        const targetMeetingId = explicitTargetMeetingId || actualMeetingId || meetingId;

        console.debug('📝 NotesPanel: Updating note for meeting:', targetMeetingId);

        const noteData = await invoke('api_save_note', {
          meetingId: targetMeetingId,
          contentJson,
          contentMarkdown,
          version: noteVersion,
        }) as { version: number; updated_at: string };

        setNoteVersion(noteData.version);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);
        editorContentRef.current = blocks;

        if (explicitTargetMeetingId && isDraftMeeting) {
          setActualMeetingId(explicitTargetMeetingId);
          justSavedRef.current = true;
        }

        console.debug('✅ NotesPanel: Note updated successfully');
      }
    } catch (err) {
      console.error('❌ NotesPanel: Save error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setIsSaving(false);
    }
  }, [isDraftMeeting, isNewNote, actualMeetingId, meetingId, noteVersion, onMeetingCreated]);

  // Keep a stable ref to the latest saveNote so the debounced wrapper (created
  // once) never calls a stale closure. Without this, debouncedSave would always
  // invoke the initial saveNote where isNewNote=true / actualMeetingId=null,
  // causing infinite meeting creation after the first autosave.
  const latestSaveNote = useRef(saveNote);
  useEffect(() => {
    latestSaveNote.current = saveNote;
  }, [saveNote]);

  // Debounced save - 2 second delay
  const debouncedSave = useRef(
    debounce((blocks: Block[]) => {
      latestSaveNote.current(blocks);
    }, 2000)
  ).current;

  // Safety net: if the component unmounts while a debounced save is still pending
  // (e.g. user navigates away mid-typing), flush it immediately so no edits are lost.
  useEffect(() => {
    return () => {
      debouncedSave.flush();
    };
  }, [debouncedSave]);

  // Track if there are unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const hasUnsavedChangesRef = useRef(false);

  useEffect(() => {
    hasUnsavedChangesRef.current = hasUnsavedChanges;
  }, [hasUnsavedChanges]);

  // Prevent accidental navigation/close when there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = ''; // Chrome requires returnValue to be set
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Keyboard shortcut: Cmd+S (Mac) or Ctrl+S (Windows/Linux) to manually save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (noteContent && noteContent.length > 0) {
          console.debug('📝 NotesPanel: Manual save triggered via Cmd+S');
          // Cancel any pending debounced save and save immediately
          debouncedSave.cancel();
          saveNote(noteContent);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [noteContent, saveNote, debouncedSave]);

  // Initialize editor with empty paragraph for new notes, or loaded content
  const initialContent = isDraftMeeting
    ? [{ type: 'paragraph', content: '' }]
    : noteContent || undefined;

  console.debug('📝 INITIAL CONTENT computed:', {
    isNewNote,
    isDraftMeeting,
    hasNoteContent: !!noteContent,
    noteContentBlocksCount: noteContent?.length || 0,
    initialContentType: isDraftMeeting ? 'empty paragraph' : (noteContent ? 'from noteContent' : 'undefined')
  });

  // Only create editor on client side (not during SSR)
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    console.debug('✅ Component mounted on client');
    setIsMounted(true);
  }, []);

  const editor = useCreateBlockNote({
    initialContent: isMounted ? initialContent as any : undefined,
    placeholders: {
      default: "enter text or type '/'",
    },
  });

  console.debug('🎨 EDITOR state:', {
    editorExists: !!editor,
    editorDocumentLength: editor?.document?.length || 0,
    isMounted
  });

  useImperativeHandle(ref, () => ({
    flushNotes: async (targetMeetingId?: string) => {
      if (!editor) return;

      const blocks = editor.document as Block[];
      if (!blocksHaveMeaningfulContent(blocks)) {
        debouncedSave.cancel();
        setHasUnsavedChanges(false);
        return;
      }

      debouncedSave.cancel();
      await saveNote(blocks, { targetMeetingId });
    },
  }), [debouncedSave, editor, saveNote]);

  // Handle content changes
  const handleEditorChange = useCallback((blocks: Block[]) => {
    // Ignore changes triggered by editor.replaceBlocks() during content
    // restoration — those are not user edits and must not create new meetings.
    if (isRestoringContent.current) return;

    const firstBlockContent = (blocks[0] as any)?.content?.[0]?.text || '';
    console.debug('📝 EDITOR CHANGE:', {
      blocksCount: blocks.length,
      firstBlockPreview: firstBlockContent.substring(0, 50),
      timestamp: new Date().toISOString().split('T')[1]
    });
    console.debug('💾 Setting noteContent state with', blocks.length, 'blocks');
    setNoteContent(blocks);
    editorContentRef.current = blocks; // Preserve content in ref for recovery after prop changes
    onBlocksChange?.(blocks);
    setHasUnsavedChanges(true);
    const markdown = blocksToMarkdownSync(blocks);
    const hasContent = blocksHaveMeaningfulContent(blocks);
    onContentPresenceChange?.(hasContent);
    onMarkdownChange?.(markdown);
    // Autosave only meaningful notes. This prevents programmatic editor resets
    // from overwriting a real saved note with BlockNote's empty paragraph.
    if (hasContent) {
      debouncedSave(blocks);
    } else {
      debouncedSave.cancel();
      setHasUnsavedChanges(false);
    }
  }, [debouncedSave, onBlocksChange, onContentPresenceChange, onMarkdownChange]);

  useEffect(() => {
    if (!handleEditorChange) return;

    const unsubscribe = editor.onChange(() => {
      handleEditorChange(editor.document);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [editor, handleEditorChange]);

  // Load existing note if not in new note mode
  useEffect(() => {
    console.debug('🔍 DEBUG loadNote useEffect triggered:', { meetingId, isNewNote });
    const requestedMeetingId = meetingId;
    const loadId = ++loadSequenceRef.current;

    const loadNote = async () => {
      if (isDraftMeeting) {
        console.debug('🔍 DEBUG Skipping load (new note mode or invalid ID) — clearing editor');
        // Clear any content from the previous meeting so the editor starts blank.
        // useCreateBlockNote() only uses initialContent at creation time; subsequent
        // prop changes do NOT reset the editor, so we must call replaceBlocks() here.
        if (editor) {
          isRestoringContent.current = true;
          editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '' } as any]);
          setTimeout(() => { isRestoringContent.current = false; }, 0);
        }
        setNoteContent(null);
        editorContentRef.current = null;
        onContentPresenceChange?.(false);
        onMarkdownChange?.('');
        onBlocksChange?.(null);
        setIsEditorReady(true);
        return;
      }

      // Skip reload if we just saved - restore content from ref instead
      if (justSavedRef.current) {
        console.debug('🔍 DEBUG Skipping load (just saved, restoring content from ref)');
        justSavedRef.current = false; // Reset flag

        // Restore content using BlockNote API to prevent blank editor after URL transition.
        // Guard with isRestoringContent so the onChange fired by replaceBlocks is ignored.
        if (editorContentRef.current && editor) {
          isRestoringContent.current = true;
          editor.replaceBlocks(editor.document, editorContentRef.current);
          // Clear flag after a microtask — BlockNote may dispatch onChange asynchronously.
          setTimeout(() => { isRestoringContent.current = false; }, 0);
          console.debug('✅ Content restored from ref:', editorContentRef.current.length, 'blocks');
        }
        const restoredHasContent = blocksHaveMeaningfulContent(editorContentRef.current);
        onContentPresenceChange?.(restoredHasContent);
        onMarkdownChange?.(blocksToMarkdownSync(editorContentRef.current || []));
        onBlocksChange?.(editorContentRef.current || null);
        setIsEditorReady(true);
        return;
      }

      console.debug('🔍 DEBUG Loading note from database for:', meetingId);
      setIsLoading(true);
      setError(null);

      try {
        const data = await invoke('api_get_note', {
          meetingId: requestedMeetingId,
        }) as { content_json: string; format: string; version: number; updated_at: string } | null;

        if (loadId !== loadSequenceRef.current || currentMeetingIdRef.current !== requestedMeetingId) {
          console.debug('🔍 DEBUG Ignoring stale note load result:', {
            requestedMeetingId,
            currentMeetingId: currentMeetingIdRef.current,
          });
          return;
        }

        console.debug('🔍 DEBUG Note data from DB:', {
          hasData: !!data,
          contentLength: data?.content_json?.length || 0
        });

        if (data) {
          const content = data.content_json ? JSON.parse(data.content_json) : null;
          console.debug('🔍 DEBUG Setting noteContent from DB:', {
            blocksCount: content?.length || 0
          });
          setNoteContent(content);
          editorContentRef.current = content; // Keep ref in sync with database content
          setNoteVersion(data.version || 1);
          setLastSaved(data.updated_at ? new Date(data.updated_at) : null);
          const hasLoadedContent = blocksHaveMeaningfulContent(content);
          onContentPresenceChange?.(hasLoadedContent);
          onMarkdownChange?.(blocksToMarkdownSync(content || []));
          onBlocksChange?.(content || null);

          // Push loaded content into the editor. useCreateBlockNote() only uses
          // initialContent at creation time — it does NOT react to subsequent state
          // changes. Without this call the editor stays blank even though noteContent
          // state is correctly populated.
          if (content && editor) {
            isRestoringContent.current = true;
            editor.replaceBlocks(editor.document, content);
            setTimeout(() => { isRestoringContent.current = false; }, 0);
          }

          console.debug('✅ NotesPanel: Loaded note', { hasContent: !!content, version: data.version });
        } else {
          const localBlocks = ((editor?.document as Block[] | undefined) || editorContentRef.current) ?? [];
          const hasLocalContent = blocksHaveMeaningfulContent(localBlocks);

          if (hasLocalContent && hasUnsavedChangesRef.current) {
            console.debug('📝 NotesPanel: DB has no note yet, preserving and flushing local editor content');
            setNoteContent(localBlocks);
            editorContentRef.current = localBlocks;
            onContentPresenceChange?.(hasLocalContent);
            onMarkdownChange?.(blocksToMarkdownSync(localBlocks));
            onBlocksChange?.(localBlocks);
            await latestSaveNote.current(localBlocks, { targetMeetingId: requestedMeetingId });
            return;
          }

          // No note exists yet - start with empty
          console.debug('⚠️ DEBUG Setting noteContent to null (no data from DB)');
          setNoteContent(null);
          editorContentRef.current = null;
          onContentPresenceChange?.(false);
          onMarkdownChange?.('');
          onBlocksChange?.(null);
          if (editor) {
            isRestoringContent.current = true;
            editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: '' } as any]);
            setTimeout(() => { isRestoringContent.current = false; }, 0);
          }
          console.debug('ℹ️ NotesPanel: No existing note found');
        }
      } catch (err) {
        console.error('❌ NotesPanel: Error loading note:', err);
        setError(err instanceof Error ? err.message : 'Failed to load note');
      } finally {
        if (loadId === loadSequenceRef.current && currentMeetingIdRef.current === requestedMeetingId) {
          setIsLoading(false);
          setIsEditorReady(true);
        }
      }
    };

    loadNote();
  }, [meetingId, isNewNote, isDraftMeeting, editor, onBlocksChange, onContentPresenceChange, onMarkdownChange]);

  return (
    <div className={MEETING_PANE_CONTAINER_CLASS}>
      {/* Header */}
      <div className={MEETING_PANE_HEADER_CLASS}>
        <div className={MEETING_PANE_HEADER_ROW_CLASS}>
          <div className="min-w-0 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
            <h2 className={MEETING_PANE_TITLE_CLASS}>My Notes</h2>
            {formattedCreatedDate && (
              <span className="text-sm text-foreground/55 whitespace-nowrap">
                created on: {formattedCreatedDate}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Copy notes to clipboard */}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                if (!editor) return;
                try {
                  const markdown = await editor.blocksToMarkdownLossy(editor.document);
                  await navigator.clipboard.writeText(markdown);
                  toast.success('Notes copied to clipboard');
                } catch {
                  toast.error('Failed to copy notes');
                }
              }}
              disabled={
                !isEditorReady ||
                // Disabled when document has only one empty default block
                (editor?.document?.length === 1 &&
                  !(editor.document[0].content as any[])?.length)
              }
              title="Copy notes to clipboard"
            >
              <Copy size={16} />
              <span className="hidden lg:inline">Copy</span>
            </Button>
            {/* Save status indicator */}
            <div className="text-sm text-foreground/60">
              {isSaving && (
                <span className="flex items-center gap-1">
                  <div className="inline-block animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-emerald-400"></div>
                  Saving...
                </span>
              )}
              {!isSaving && lastSaved && (
                <span>Saved {formatTimestamp(lastSaved)}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto px-4 lg:px-6 py-6">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-emerald-400"></div>
          </div>
        )}

        {error && (
          <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-lg p-4">
            <p className="text-emerald-200 text-sm">{error}</p>
          </div>
        )}

        {!isLoading && !error && isEditorReady && isMounted && (
          <div className="h-full notes-editor-surface">
            <BlockNoteView
              editor={editor}
              editable={true}
              theme="dark"
            />
          </div>
        )}
      </div>
    </div>
  );
});
