"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { Block } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import debounce from 'lodash/debounce';
import { invoke } from '@tauri-apps/api/core';
import '@blocknote/shadcn/style.css';

interface NotesPanelProps {
  meetingId: string;
  isNewNote: boolean;
  draftMeetingId: string | null;
  onMeetingCreated?: (actualMeetingId: string) => void;
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

export function NotesPanel({
  meetingId,
  isNewNote,
  draftMeetingId,
  onMeetingCreated
}: NotesPanelProps) {
  const renderCount = useRef(0);
  renderCount.current += 1;

  console.log('🔍 DEBUG NotesPanel RENDER #' + renderCount.current, {
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
  const editorRef = useRef<any>(null);
  const justSavedRef = useRef<boolean>(false); // Track if we just saved to avoid reload
  const editorContentRef = useRef<Block[] | null>(null); // Preserve content across re-renders

  // Track component mount/unmount
  useEffect(() => {
    console.log('🎬 COMPONENT MOUNTED');
    return () => {
      console.log('💀 COMPONENT UNMOUNTING');
    };
  }, []);

  // Track prop changes
  useEffect(() => {
    console.log('🔍 DEBUG Props changed:', { meetingId, isNewNote, actualMeetingId });
  }, [meetingId, isNewNote, actualMeetingId]);

  // Convert blocks to markdown
  const blocksToMarkdown = async (blocks: Block[]): Promise<string> => {
    // Simple markdown conversion - BlockNote's built-in method is more robust
    return blocks.map((block: any) => {
      if (block.type === 'heading') {
        const level = block.props?.level || 1;
        return '#'.repeat(level) + ' ' + (block.content?.[0]?.text || '');
      }
      return block.content?.[0]?.text || '';
    }).join('\n\n');
  };

  // Save note function
  const saveNote = useCallback(async (blocks: Block[]) => {
    console.log('🔍 DEBUG saveNote called:', {
      blocksCount: blocks?.length,
      isNewNote,
      actualMeetingId,
      meetingId
    });

    if (!blocks || blocks.length === 0) {
      console.log('📝 NotesPanel: No content to save');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const contentJson = JSON.stringify(blocks);
      const contentMarkdown = await blocksToMarkdown(blocks);

      console.log('🔍 DEBUG content to save:', {
        contentJsonLength: contentJson.length,
        contentMarkdown: contentMarkdown.substring(0, 100), // First 100 chars
        hasContent: contentMarkdown.trim().length > 0
      });

      // Scenario 1: New note - need to create meeting first
      if (isNewNote && !actualMeetingId) {
        console.log('📝 NotesPanel: Creating new meeting for note...');

        // Create meeting using Tauri command
        const meetingData = await invoke('api_create_meeting', {
          title: 'Untitled Note',
        }) as { id: string; title: string; created_at: string; updated_at: string };

        const newMeetingId = meetingData.id;
        setActualMeetingId(newMeetingId);

        console.log('✅ NotesPanel: Meeting created:', newMeetingId);

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

        console.log('✅ NotesPanel: Note created successfully', {
          newMeetingId,
          version: noteData.version,
          contentLength: contentMarkdown.length
        });

        // Set flag to prevent unnecessary reload after save
        justSavedRef.current = true;
        // Preserve content in ref before URL transition triggers prop changes
        editorContentRef.current = blocks;

        // Notify parent component AFTER note is saved to prevent race condition
        console.log('🔍 DEBUG: About to call onMeetingCreated callback');
        if (onMeetingCreated) {
          onMeetingCreated(newMeetingId);
          console.log('🔍 DEBUG: onMeetingCreated callback completed');
        }
      }
      // Scenario 2: Existing note - update it
      else {
        const targetMeetingId = actualMeetingId || meetingId;

        console.log('📝 NotesPanel: Updating note for meeting:', targetMeetingId);

        const noteData = await invoke('api_save_note', {
          meetingId: targetMeetingId,
          contentJson,
          contentMarkdown,
          version: noteVersion,
        }) as { version: number; updated_at: string };

        setNoteVersion(noteData.version);
        setLastSaved(new Date());
        setHasUnsavedChanges(false);

        console.log('✅ NotesPanel: Note updated successfully');
      }
    } catch (err) {
      console.error('❌ NotesPanel: Save error:', err);
      setError(err instanceof Error ? err.message : 'Failed to save note');
    } finally {
      setIsSaving(false);
    }
  }, [isNewNote, actualMeetingId, meetingId, noteVersion, onMeetingCreated]);

  // Debounced save - 2 second delay
  const debouncedSave = useRef(
    debounce((blocks: Block[]) => {
      saveNote(blocks);
    }, 2000)
  ).current;

  // Track if there are unsaved changes
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

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
          console.log('📝 NotesPanel: Manual save triggered via Cmd+S');
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
  const initialContent = isNewNote
    ? [{ type: 'paragraph', content: '' }]
    : noteContent || undefined;

  console.log('📝 INITIAL CONTENT computed:', {
    isNewNote,
    hasNoteContent: !!noteContent,
    noteContentBlocksCount: noteContent?.length || 0,
    initialContentType: isNewNote ? 'empty paragraph' : (noteContent ? 'from noteContent' : 'undefined')
  });

  // Only create editor on client side (not during SSR)
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    console.log('✅ Component mounted on client');
    setIsMounted(true);
  }, []);

  const editor = useCreateBlockNote({
    initialContent: isMounted ? initialContent as any : undefined,
  });

  console.log('🎨 EDITOR state:', {
    editorExists: !!editor,
    editorDocumentLength: editor?.document?.length || 0,
    isMounted
  });

  // Handle content changes
  const handleEditorChange = useCallback((blocks: Block[]) => {
    const firstBlockContent = (blocks[0] as any)?.content?.[0]?.text || '';
    console.log('📝 EDITOR CHANGE:', {
      blocksCount: blocks.length,
      firstBlockPreview: firstBlockContent.substring(0, 50),
      timestamp: new Date().toISOString().split('T')[1]
    });
    console.log('💾 Setting noteContent state with', blocks.length, 'blocks');
    setNoteContent(blocks);
    editorContentRef.current = blocks; // Preserve content in ref for recovery after prop changes
    setHasUnsavedChanges(true);
    // Trigger debounced autosave
    debouncedSave(blocks);
  }, [debouncedSave]);

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
    console.log('🔍 DEBUG loadNote useEffect triggered:', { meetingId, isNewNote });

    const loadNote = async () => {
      if (isNewNote || !meetingId || meetingId === 'new') {
        console.log('🔍 DEBUG Skipping load (new note mode or invalid ID)');
        setIsEditorReady(true);
        return;
      }

      // Skip reload if we just saved - restore content from ref instead
      if (justSavedRef.current) {
        console.log('🔍 DEBUG Skipping load (just saved, restoring content from ref)');
        justSavedRef.current = false; // Reset flag

        // Restore content using BlockNote API to prevent blank editor after URL transition
        if (editorContentRef.current && editor) {
          editor.replaceBlocks(editor.document, editorContentRef.current);
          console.log('✅ Content restored from ref:', editorContentRef.current.length, 'blocks');
        }
        setIsEditorReady(true);
        return;
      }

      console.log('🔍 DEBUG Loading note from database for:', meetingId);
      setIsLoading(true);
      setError(null);

      try {
        const data = await invoke('api_get_note', {
          meetingId,
        }) as { content_json: string; format: string; version: number; updated_at: string } | null;

        console.log('🔍 DEBUG Note data from DB:', {
          hasData: !!data,
          contentLength: data?.content_json?.length || 0
        });

        if (data) {
          const content = data.content_json ? JSON.parse(data.content_json) : null;
          console.log('🔍 DEBUG Setting noteContent from DB:', {
            blocksCount: content?.length || 0
          });
          setNoteContent(content);
          editorContentRef.current = content; // Keep ref in sync with database content
          setNoteVersion(data.version || 1);
          setLastSaved(data.updated_at ? new Date(data.updated_at) : null);
          console.log('✅ NotesPanel: Loaded note', { hasContent: !!content, version: data.version });
        } else {
          // No note exists yet - start with empty
          console.log('⚠️ DEBUG Setting noteContent to null (no data from DB)');
          setNoteContent(null);
          console.log('ℹ️ NotesPanel: No existing note found');
        }
      } catch (err) {
        console.error('❌ NotesPanel: Error loading note:', err);
        setError(err instanceof Error ? err.message : 'Failed to load note');
      } finally {
        setIsLoading(false);
        setIsEditorReady(true);
      }
    };

    loadNote();
  }, [meetingId, isNewNote]);

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isNewNote ? 'New Note' : 'Meeting Notes'}
          </h2>
          <div className="text-sm text-gray-500">
            {isSaving && (
              <span className="flex items-center gap-1">
                <div className="inline-block animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-blue-500"></div>
                Saving...
              </span>
            )}
            {!isSaving && lastSaved && (
              <span>Saved {formatTimestamp(lastSaved)}</span>
            )}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {!isLoading && !error && isEditorReady && isMounted && (
          <div className="h-full">
            <BlockNoteView
              editor={editor}
              editable={true}
              theme="light"
            />
          </div>
        )}
      </div>
    </div>
  );
}
