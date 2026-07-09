"use client";

import { Transcript, TranscriptSegmentData } from '@/types';
import { VirtualizedTranscriptView } from '@/components/VirtualizedTranscriptView';
import { TranscriptButtonGroup } from './TranscriptButtonGroup';
import { useMemo } from 'react';
import {
  MEETING_PANE_HEADER_CLASS,
  MEETING_PANE_HEADER_ROW_CLASS,
  MEETING_PANE_TITLE_CLASS,
} from './paneHeaderStyles';

interface TranscriptPanelProps {
  transcripts: Transcript[];
  onCopyTranscript: () => void;
  /** Passed to the Record button in the header */
  onStartRecording: () => void;
  onStopRecording: () => void;
  isRecording: boolean;
  /** True while the stop sequence is in flight; disables the button */
  isStopping: boolean;
  /** Whether the recording is currently paused */
  isPaused?: boolean;
  /** Called when the user clicks Pause */
  onPauseRecording?: () => void;
  /** Called when the user clicks Resume */
  onResumeRecording?: () => void;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}

export function TranscriptPanel({
  transcripts,
  onCopyTranscript,
  onStartRecording,
  onStopRecording,
  isRecording,
  isStopping,
  isPaused = false,
  onPauseRecording,
  onResumeRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: TranscriptPanelProps) {
  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments;
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map(t => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
    }));
  }, [transcripts, usePagination, segments]);

  const transcriptCount = usePagination
    ? (totalCount ?? convertedSegments.length)
    : (transcripts?.length || 0);

  return (
    <div className="flex w-full flex-1 min-w-0 min-h-0 border-b border-white/10 xl:border-b-0 bg-background flex-col relative">
      {/* Title area */}
      <div className={MEETING_PANE_HEADER_CLASS}>
        <div className={MEETING_PANE_HEADER_ROW_CLASS}>
          <h2 className={MEETING_PANE_TITLE_CLASS}>Transcript</h2>
          <TranscriptButtonGroup
            className="shrink-0 max-w-full overflow-x-auto"
            transcriptCount={transcriptCount}
            onCopyTranscript={onCopyTranscript}
            isRecording={isRecording}
            isStopping={isStopping}
            isPaused={isPaused}
            onStartRecording={onStartRecording}
            onStopRecording={onStopRecording}
            onPauseRecording={onPauseRecording}
            onResumeRecording={onResumeRecording}
          />
        </div>
      </div>

      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 min-h-0 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={isPaused}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
        />
      </div>
    </div>
  );
}
