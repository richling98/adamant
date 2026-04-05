"use client";

import { useState, useEffect, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import dynamic from 'next/dynamic';
import { Summary, SummaryDataResponse, SummaryFormat, BlockNoteBlock } from '@/types';
import { AISummary } from './index';
import { Block } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import { detectMarkdownShape, normalizeSummaryMarkdown, SummaryMarkdownShape } from '@/lib/summaryMarkdown';
import "@blocknote/shadcn/style.css";

// Dynamically import BlockNote Editor to avoid SSR issues
const Editor = dynamic(() => import('../BlockNoteEditor/Editor'), { ssr: false });

interface BlockNoteSummaryViewProps {
  summaryData: SummaryDataResponse | Summary | null;
  onSave?: (data: { markdown?: string; summary_json?: BlockNoteBlock[] }) => void;
  onSummaryChange?: (summary: Summary) => void;
  status?: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  error?: string | null;
  onRegenerateSummary?: () => void;
  meeting?: {
    id: string;
    title: string;
    created_at: string;
  };
  onDirtyChange?: (isDirty: boolean) => void;
  onParseStateChange?: (
    state: 'idle' | 'parsing' | 'parsed' | 'failed',
    diagnostics: SummaryMarkdownShape & { normalizedLength: number }
  ) => void;
}

export interface BlockNoteSummaryViewRef {
  saveSummary: () => Promise<void>;
  getMarkdown: () => Promise<string>;
  isDirty: boolean;
}

// Format detection helper
function detectSummaryFormat(data: any): { format: SummaryFormat; data: any } {
  if (!data) {
    return { format: 'legacy', data: null };
  }

  // Priority 1: BlockNote format (has summary_json)
  if (data.summary_json && Array.isArray(data.summary_json)) {
    console.debug('✅ FORMAT: BLOCKNOTE (summary_json exists)');
    return { format: 'blocknote', data };
  }

  // Priority 2: Markdown format
  if (data.markdown && typeof data.markdown === 'string') {
    console.debug('✅ FORMAT: MARKDOWN (will parse to BlockNote)');
    return { format: 'markdown', data };
  }

  // Priority 3: Legacy JSON
  const hasLegacyStructure = data.MeetingName || Object.keys(data).some(key =>
    typeof data[key] === 'object' && data[key]?.title && data[key]?.blocks
  );

  if (hasLegacyStructure) {
    console.debug('✅ FORMAT: LEGACY (custom JSON)');
    return { format: 'legacy', data };
  }

  return { format: 'legacy', data: null };
}

export const BlockNoteSummaryView = forwardRef<BlockNoteSummaryViewRef, BlockNoteSummaryViewProps>(({
  summaryData,
  onSave,
  onSummaryChange,
  status = 'idle',
  error = null,
  onRegenerateSummary,
  meeting,
  onDirtyChange,
  onParseStateChange
}, ref) => {
  const { format, data } = detectSummaryFormat(summaryData);
  const [isDirty, setIsDirty] = useState(false);
  const [currentBlocks, setCurrentBlocks] = useState<Block[]>([]);
  const [parseState, setParseState] = useState<'idle' | 'parsing' | 'parsed' | 'failed'>('idle');
  const [fallbackMarkdown, setFallbackMarkdown] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const isContentLoaded = useRef(false);
  const latestDiagnosticsRef = useRef<SummaryMarkdownShape & { normalizedLength: number }>({
    hasInstructionLeak: false,
    hasTable: false,
    hasTemplateArtifacts: false,
    lineCount: 0,
    markdownLength: 0,
    normalizedLength: 0,
  });

  // Create BlockNote editor for markdown parsing
  const editor = useCreateBlockNote({
    initialContent: undefined
  });

  const emitParseState = useCallback((
    state: 'idle' | 'parsing' | 'parsed' | 'failed',
    diagnostics?: SummaryMarkdownShape & { normalizedLength: number }
  ) => {
    setParseState(state);
    onParseStateChange?.(state, diagnostics || latestDiagnosticsRef.current);
  }, [onParseStateChange]);

  const blockHasMeaningfulContent = useCallback((block: any): boolean => {
    if (!block) return false;

    if (typeof block.content === 'string' && block.content.trim().length > 0) {
      return true;
    }

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
  }, []);

  // Parse markdown to blocks when format is markdown
  useEffect(() => {
    if (format === 'markdown' && editor) {
      const loadMarkdown = async () => {
        const rawMarkdown = typeof data?.markdown === 'string' ? data.markdown : '';
        const normalizedMarkdown = normalizeSummaryMarkdown(rawMarkdown);
        const markdownShape = detectMarkdownShape(rawMarkdown);
        const diagnostics = {
          ...markdownShape,
          normalizedLength: normalizedMarkdown.length,
        };
        latestDiagnosticsRef.current = diagnostics;
        setFallbackMarkdown(normalizedMarkdown || rawMarkdown || '');

        console.debug('[summary-render-diagnostics]', {
          meetingId: meeting?.id || 'unknown',
          format,
          parseState: 'parsing',
          ...diagnostics,
        });

        emitParseState('parsing', diagnostics);
        isContentLoaded.current = false;

        if (!normalizedMarkdown.trim()) {
          console.warn('⚠️ Markdown is empty after normalization; rendering fallback.');
          emitParseState('failed', diagnostics);
          return;
        }

        try {
          console.debug('📝 Parsing markdown to BlockNote blocks...');
          const blocks = await editor.tryParseMarkdownToBlocks(normalizedMarkdown);
          const hasMeaningfulContent = blocks.some((block) => blockHasMeaningfulContent(block as any));

          if (!blocks.length || !hasMeaningfulContent) {
            console.warn('⚠️ Parsed markdown has no meaningful content; rendering fallback.');
            emitParseState('failed', diagnostics);
            return;
          }

          editor.replaceBlocks(editor.document, blocks);
          setCurrentBlocks(blocks as Block[]);
          console.debug('✅ Markdown parsed successfully');
          emitParseState('parsed', diagnostics);

          // Delay to ensure editor has finished rendering before allowing onChange
          setTimeout(() => {
            isContentLoaded.current = true;
          }, 100);
        } catch (err) {
          console.error('❌ Failed to parse markdown:', err);
          emitParseState('failed', diagnostics);
        }
      };
      loadMarkdown();
    }
  }, [format, data?.markdown, editor, emitParseState, blockHasMeaningfulContent, meeting?.id, retryCount]);

  // Set content loaded flag for blocknote format
  useEffect(() => {
    if (format === 'blocknote' && data?.summary_json) {
      emitParseState('parsed', latestDiagnosticsRef.current);
      // Delay to ensure editor has finished rendering
      setTimeout(() => {
        isContentLoaded.current = true;
      }, 100);
    }
  }, [format, data?.summary_json, emitParseState]);

  useEffect(() => {
    if (format === 'legacy') {
      emitParseState('idle', latestDiagnosticsRef.current);
    }
  }, [format, emitParseState]);

  const handleEditorChange = useCallback((blocks: Block[]) => {
    // Only set dirty flag if content has finished loading
    if (isContentLoaded.current) {
      setCurrentBlocks(blocks);
      setIsDirty(true);
    }
  }, []);

  // Notify parent of dirty state changes
  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  const handleSave = useCallback(async () => {
    if (!onSave || !isDirty) return;
    try {
      console.debug('💾 Saving BlockNote content...');

      // Generate markdown from current blocks
      const markdown = await editor.blocksToMarkdownLossy(currentBlocks);

      onSave({
        markdown: markdown,
        summary_json: currentBlocks as unknown as BlockNoteBlock[]
      });

      setIsDirty(false);
      console.debug('✅ Save successful');
    } catch (err) {
      console.error('❌ Save failed:', err);
      alert('Failed to save changes. Please try again.');
    }
  }, [onSave, isDirty, currentBlocks, editor]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    saveSummary: handleSave,
    getMarkdown: async () => {
      try {
        console.debug('🔍 getMarkdown called, format:', format);
        console.debug('🔍 currentBlocks length:', currentBlocks.length);
        console.debug('🔍 data:', data);

        // For markdown format - use the main editor
        if (format === 'markdown' && editor) {
          if (parseState === 'failed' && fallbackMarkdown) {
            console.debug('📝 Markdown parse failed; using fallback markdown for export/copy');
            return fallbackMarkdown;
          }
          console.debug('📝 Using markdown editor, blocks:', editor.document.length);
          const markdown = await editor.blocksToMarkdownLossy(editor.document);
          console.debug('📝 Generated markdown length:', markdown.length);
          return markdown.trim() ? markdown : fallbackMarkdown;
        }

        // For blocknote format - use currentBlocks state
        if (format === 'blocknote') {
          console.debug('📝 BlockNote format, currentBlocks:', currentBlocks.length);
          if (currentBlocks.length > 0 && editor) {
            const markdown = await editor.blocksToMarkdownLossy(currentBlocks);
            console.debug('📝 Generated markdown from blocks, length:', markdown.length);
            return markdown;
          }
          // Fallback: if we have the original data with markdown
          if (data?.markdown) {
            console.debug('📝 Using fallback markdown from data');
            return data.markdown;
          }
        }

        // For legacy format - return empty (handled by parent)
        console.warn('⚠️ Cannot generate markdown for legacy format, returning empty');
        return '';
      } catch (err) {
        console.error('❌ Failed to generate markdown:', err);
        return '';
      }
    },
    isDirty
  }), [handleSave, isDirty, editor, format, currentBlocks, data, parseState, fallbackMarkdown]);

  // Render legacy format
  if (format === 'legacy') {
    console.debug('🎨 Rendering LEGACY format');
    return (
      <AISummary
        summary={summaryData as Summary}
        status={status}
        error={error}
        onSummaryChange={onSummaryChange || (() => { })}
        onRegenerateSummary={onRegenerateSummary || (() => { })}
        meeting={meeting}
      />
    );
  }

  // Render BlockNote format (has summary_json)
  if (format === 'blocknote') {
    console.debug('🎨 Rendering BLOCKNOTE format (direct)');
    return (
      <div className="flex flex-col w-full">
        <div className="w-full">
          <Editor
            initialContent={data.summary_json}
            onChange={(blocks) => {
              console.debug('📝 Editor blocks changed:', blocks.length);
              handleEditorChange(blocks);
            }}
            editable={true}
          />
        </div>
      </div>
    );
  }

  // Render Markdown format (parse and display in BlockNote)
  if (format === 'markdown') {
    if (parseState === 'failed') {
      console.debug('🎨 Rendering MARKDOWN fallback (compatibility mode)');
      return (
        <div className="flex flex-col w-full gap-3 rounded-lg border border-amber-400/30 bg-transparent p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-amber-100">
              Rendered in compatibility mode (structured editor parse failed).
            </p>
            <button
              type="button"
              className="rounded-md border border-white/20 px-2 py-1 text-xs text-foreground/90 hover:bg-white/10"
              onClick={() => {
                emitParseState('idle', latestDiagnosticsRef.current);
                setRetryCount((prev) => prev + 1);
              }}
            >
              Retry structured render
            </button>
          </div>
          <div className="max-h-[65vh] overflow-y-auto overflow-x-auto rounded-md border border-white/10 bg-transparent p-4">
            <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90 font-mono">
              {fallbackMarkdown || 'No summary content available.'}
            </pre>
          </div>
        </div>
      );
    }

    console.debug('🎨 Rendering MARKDOWN format (parsed to BlockNote)');
    return (
      <div className="flex flex-col w-full">
        <div className="w-full">
          <BlockNoteView
            editor={editor}
            editable={true}
            onChange={() => {
              if (isContentLoaded.current) {
                handleEditorChange(editor.document);
              }
            }}
            theme="dark"
          />
        </div>
      </div>
    );
  }

  return null;
});

BlockNoteSummaryView.displayName = 'BlockNoteSummaryView';
