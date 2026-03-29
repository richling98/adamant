"use client";

import { Summary, SummaryResponse, Transcript } from '@/types';
import { BlockNoteSummaryView, BlockNoteSummaryViewRef } from '@/components/AISummary/BlockNoteSummaryView';
import { EmptyStateSummary } from '@/components/EmptyStateSummary';
import { SummaryGeneratorButtonGroup } from './SummaryGeneratorButtonGroup';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { Button } from '@/components/ui/button';
import { Copy } from 'lucide-react';
import Analytics from '@/lib/analytics';
import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  MEETING_PANE_CONTAINER_CLASS,
  MEETING_PANE_HEADER_CLASS,
  MEETING_PANE_HEADER_ROW_CLASS,
  MEETING_PANE_TITLE_CLASS,
} from './paneHeaderStyles';

interface SummaryPanelProps {
  meeting: {
    id: string;
    title: string;
    created_at: string;
  };
  meetingTitle: string;
  summaryRef: RefObject<BlockNoteSummaryViewRef>;
  aiSummary: Summary | null;
  summaryStatus: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
  transcripts: Transcript[];
  summaryResponse: SummaryResponse | null;
  onSaveSummary: (summary: Summary | { markdown?: string; summary_json?: any[] }) => Promise<void>;
  onSummaryChange: (summary: Summary) => void;
  onDirtyChange: (isDirty: boolean) => void;
  summaryError: string | null;
  onRegenerateSummary: () => Promise<void>;
  getSummaryStatusMessage: (status: 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error') => string;

  // --- Header action button props ---
  /** Whether a summary already exists; toggles Generate → Copy in the header */
  hasExistingSummary: boolean;
  /** Copy the current summary to clipboard */
  onCopySummary: () => void;
  // SummaryGeneratorButtonGroup props (stripped — no settings/template)
  modelConfig: ModelConfig;
  onGenerateSummary: (customPrompt: string) => Promise<void>;
  onStopGeneration: () => void;
  customPrompt: string;
}

export function SummaryPanel({
  meeting,
  meetingTitle,
  summaryRef,
  aiSummary,
  summaryStatus,
  transcripts,
  summaryResponse,
  onSaveSummary,
  onSummaryChange,
  onDirtyChange,
  summaryError,
  onRegenerateSummary,
  getSummaryStatusMessage,
  hasExistingSummary,
  onCopySummary,
  modelConfig,
  onGenerateSummary,
  onStopGeneration,
  customPrompt,
}: SummaryPanelProps) {
  const isSummaryLoading = summaryStatus === 'processing' || summaryStatus === 'summarizing' || summaryStatus === 'regenerating';
  const isSummaryCompleted = summaryStatus === 'completed';
  const [summaryRenderState, setSummaryRenderState] = useState<'idle' | 'parsing' | 'parsed' | 'failed'>('idle');
  const [displaySummary, setDisplaySummary] = useState<Summary | null>(aiSummary);
  const previousMeetingIdRef = useRef(meeting.id);

  useEffect(() => {
    const meetingChanged = previousMeetingIdRef.current !== meeting.id;
    if (meetingChanged) {
      previousMeetingIdRef.current = meeting.id;
      setDisplaySummary(aiSummary);
      setSummaryRenderState('idle');
      return;
    }

    if (aiSummary) {
      setDisplaySummary(aiSummary);
      return;
    }

    if (summaryStatus === 'idle' || summaryStatus === 'error') {
      setDisplaySummary(null);
    }
  }, [aiSummary, meeting.id, summaryStatus]);

  const handleParseStateChange = useCallback((
    state: 'idle' | 'parsing' | 'parsed' | 'failed',
    diagnostics: any
  ) => {
    setSummaryRenderState(state);
    if (state === 'failed') {
      console.warn('[summary-panel] Structured render failed; showing compatibility mode', {
        meetingId: meeting.id,
        ...diagnostics,
      });
    }
  }, [meeting.id]);

  const handleRegenerateSummary = useCallback(() => {
    Analytics.trackButtonClick('regenerate_summary', 'meeting_details');
    onRegenerateSummary();
  }, [onRegenerateSummary]);

  return (
    <div className={MEETING_PANE_CONTAINER_CLASS}>
      {/* Title area — header button toggles between Generate and Copy */}
      <div className={MEETING_PANE_HEADER_CLASS}>
        <div className={MEETING_PANE_HEADER_ROW_CLASS}>
          <h2 className={MEETING_PANE_TITLE_CLASS}>AI notes</h2>
          {/* Show Copy when summary exists and not actively generating;
              otherwise show Generate/Stop via SummaryGeneratorButtonGroup. */}
          {hasExistingSummary && !isSummaryLoading ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={() => {
                Analytics.trackButtonClick('copy_summary', 'meeting_details');
                onCopySummary();
              }}
              title="Copy AI summary"
            >
              <Copy className="lg:mr-2" size={16} />
              <span className="hidden lg:inline">Copy</span>
            </Button>
          ) : (
            <SummaryGeneratorButtonGroup
              modelConfig={modelConfig}
              onGenerateSummary={onGenerateSummary}
              onStopGeneration={onStopGeneration}
              customPrompt={customPrompt}
              summaryStatus={summaryStatus}
              hasTranscripts={transcripts.length > 0}
            />
          )}
        </div>
      </div>

      {isSummaryLoading ? (
        <div className="flex flex-col h-full">
          {/* Loading spinner */}
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-400 mb-4"></div>
              <p className="text-foreground/70">Generating AI Summary...</p>
            </div>
          </div>
        </div>
      ) : !displaySummary && isSummaryCompleted ? (
        <div className="flex flex-col h-full">
          <div className="flex items-center justify-center flex-1">
            <div className="text-center">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-emerald-400 mb-4"></div>
              <p className="text-foreground/70">
                {summaryRenderState === 'parsing' ? 'Rendering summary...' : 'Finalizing summary...'}
              </p>
            </div>
          </div>
        </div>
      ) : !displaySummary ? (
        <div className="flex flex-col h-full">
          {/* Empty state message */}
          <EmptyStateSummary
            onGenerate={() => { }}
            hasModel={true}
            isGenerating={isSummaryLoading}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          {summaryResponse && (
            <div className="fixed bottom-0 left-0 right-0 bg-background/95 shadow-lg p-4 max-h-1/3 overflow-y-auto border-t border-white/10">
              <h3 className="text-lg font-semibold mb-2">Meeting Summary</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-transparent p-4 rounded-lg shadow-sm border border-white/10">
                  <h4 className="font-medium mb-1">Key Points</h4>
                  <ul className="list-disc pl-4">
                    {summaryResponse.summary.key_points.blocks.map((block, i) => (
                      <li key={i} className="text-sm">{block.content}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-transparent p-4 rounded-lg shadow-sm mt-4 border border-white/10">
                  <h4 className="font-medium mb-1">Action Items</h4>
                  <ul className="list-disc pl-4">
                    {summaryResponse.summary.action_items.blocks.map((block, i) => (
                      <li key={i} className="text-sm">{block.content}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-transparent p-4 rounded-lg shadow-sm mt-4 border border-white/10">
                  <h4 className="font-medium mb-1">Decisions</h4>
                  <ul className="list-disc pl-4">
                    {summaryResponse.summary.decisions.blocks.map((block, i) => (
                      <li key={i} className="text-sm">{block.content}</li>
                    ))}
                  </ul>
                </div>
                <div className="bg-transparent p-4 rounded-lg shadow-sm mt-4 border border-white/10">
                  <h4 className="font-medium mb-1">Main Topics</h4>
                  <ul className="list-disc pl-4">
                    {summaryResponse.summary.main_topics.blocks.map((block, i) => (
                      <li key={i} className="text-sm">{block.content}</li>
                    ))}
                  </ul>
                </div>
              </div>
              {summaryResponse.raw_summary ? (
                <div className="mt-4">
                  <h4 className="font-medium mb-1">Full Summary</h4>
                  <p className="text-sm whitespace-pre-wrap break-words">{summaryResponse.raw_summary}</p>
                </div>
              ) : null}
            </div>
          )}
          <div className="px-4 lg:px-6 py-6 w-full summary-editor-surface">
            <BlockNoteSummaryView
              ref={summaryRef}
              summaryData={displaySummary}
              onSave={onSaveSummary}
              onSummaryChange={onSummaryChange}
              onDirtyChange={onDirtyChange}
              onParseStateChange={handleParseStateChange}
              status={summaryStatus}
              error={summaryError}
              onRegenerateSummary={handleRegenerateSummary}
              meeting={{
                id: meeting.id,
                title: meetingTitle,
                created_at: meeting.created_at
              }}
            />
          </div>
          {summaryStatus !== 'idle' && (
            <div className="mt-4 px-6 pb-4">
              <p className={`text-sm ${summaryStatus === 'error' ? 'text-amber-200' : 'text-foreground/70'}`}>
                {getSummaryStatusMessage(summaryStatus)}
              </p>
              {summaryRenderState === 'failed' && (
                <p className="text-xs mt-1 text-amber-200/90">
                  Structured render fell back to compatibility mode.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
