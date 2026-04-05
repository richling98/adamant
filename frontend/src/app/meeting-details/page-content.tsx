"use client";
import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse, Transcript } from '@/types';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { NotesPanel } from '@/components/NotesPanel';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Custom hooks
import { useMeetingData } from '@/hooks/meeting-details/useMeetingData';
import { useSummaryGeneration } from '@/hooks/meeting-details/useSummaryGeneration';
import { useCopyOperations } from '@/hooks/meeting-details/useCopyOperations';
import { useMeetingOperations } from '@/hooks/meeting-details/useMeetingOperations';
import { useConfig } from '@/contexts/ConfigContext';
import { useRecordingStart } from '@/hooks/useRecordingStart';
import { useRecordingStop } from '@/hooks/useRecordingStop';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { toast } from 'sonner';

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onSummaryUpdated,
  // New note mode props
  isNewNote = false,
  draftMeetingId = null,
  onMeetingCreated,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: Summary | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onSummaryUpdated?: () => Promise<void>;
  // New note mode props
  isNewNote?: boolean;
  draftMeetingId?: string | null;
  onMeetingCreated?: (actualMeetingId: string) => void;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  console.debug('📄 PAGE CONTENT: Initializing with data:', {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length,
  });

  // State
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('standard_meeting');
  const [isTemplateLoading, setIsTemplateLoading] = useState(true);
  // Snapshot of live transcripts captured when "End Recording" is pressed.
  // Holds the panel content stable while the API refetch completes (prevents flash).
  const [postRecordingSnapshot, setPostRecordingSnapshot] = useState<Transcript[]>([]);

  // Local recording state — tracks start/stop locally for useRecordingStart guard.
  // Global RecordingStateContext is the source of truth for all UI.
  const [isRecordingLocal, setIsRecordingLocal] = useState(false);
  const [, setIsRecordingDisabled] = useState(false);

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Get model config from ConfigContext
  const { modelConfig } = useConfig();

  // Global recording state (synced with backend via events)
  const recordingState = useRecordingState();
  const { isRecording } = recordingState;

  // Transcript context — live transcripts for real-time streaming + session management
  const { setPendingMeetingId, transcripts: liveTranscripts, clearTranscripts } = useTranscripts();

  // Recording hooks — start and stop are both owned here; the Transcript panel
  // header buttons call these callbacks directly (sidebar button has been removed).
  const { handleRecordingStart } = useRecordingStart(isRecordingLocal, setIsRecordingLocal);
  const { handleRecordingStop } = useRecordingStop(setIsRecordingLocal, setIsRecordingDisabled);

  // Custom hooks
  const meetingData = useMeetingData({ meeting, summaryData, onMeetingUpdated });
  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate,
    onMeetingUpdated,
    onSummaryUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  // Hide summary generation CTA whenever we already have persisted/loaded summary content.
  const hasExistingSummary = useMemo(() => {
    const summary = meetingData.aiSummary as any;
    if (!summary || typeof summary !== 'object') {
      return false;
    }

    if (typeof summary.markdown === 'string' && summary.markdown.trim().length > 0) {
      return true;
    }

    if (Array.isArray(summary.summary_json) && summary.summary_json.length > 0) {
      return true;
    }

    return Object.keys(summary).length > 0;
  }, [meetingData.aiSummary]);

  // Handle the "Start Recording" action on this page.
  // If the meeting hasn't been persisted yet (id==='new'), we create it first so
  // we have a real ID to attach the recording to. Titles are auto-named by timestamp
  // so the user doesn't need to name the meeting before recording.
  const handleStartRecordingOnPage = useCallback(async () => {
    let meetingIdToUse: string = meeting.id;

    if (meeting.id === 'new') {
      // Meeting not persisted yet — create it now with a timestamp-based title.
      // Format: "Meeting YYYY-MM-DD_HH-mm-ss" (matches home-page recording convention)
      const timestamp = new Date().toISOString().replace('T', '_').slice(0, 19).replace(/:/g, '-');
      const meetingData = await invoke('api_create_meeting', {
        title: `Meeting ${timestamp}`,
      }) as { id: string; title: string; created_at: string; updated_at: string };
      meetingIdToUse = meetingData.id;
      // Update the URL and sidebar so the page re-renders with the new ID
      onMeetingCreated?.(meetingIdToUse);
    }

    // Clear snapshot and stale live transcripts from any previous session
    setPostRecordingSnapshot([]);
    clearTranscripts();

    // Pre-seed the meeting ID: recording stop will attach transcripts here
    setPendingMeetingId(meetingIdToUse);
    await handleRecordingStart();
  }, [meeting.id, onMeetingCreated, setPendingMeetingId, clearTranscripts, handleRecordingStart]);

  // Stop recording — delegates to useRecordingStop (mirrors sidebar behaviour)
  const handleStopRecordingOnPage = useCallback(() => {
    // Capture snapshot before clearTranscripts() runs internally, so the panel
    // stays populated during the ~1s gap while the API refetches.
    setPostRecordingSnapshot([...liveTranscripts]);
    toast.loading('Saving transcript...', { id: 'transcript-save' });
    handleRecordingStop({ source: 'ui', callApi: true });
    Analytics.trackButtonClick('stop_recording', 'meeting_details_transcript_header');
  }, [handleRecordingStop, meetingData.transcripts, liveTranscripts]);

  // Pause / Resume — delegates directly to Tauri commands (backend already supports these)
  const handlePauseRecordingOnPage = useCallback(async () => {
    try {
      await invoke('pause_recording');
    } catch (error) {
      console.error('Failed to pause recording:', error);
    }
  }, []);

  const handleResumeRecordingOnPage = useCallback(async () => {
    try {
      await invoke('resume_recording');
    } catch (error) {
      console.error('Failed to resume recording:', error);
    }
  }, []);

  // Clear the post-recording snapshot once the API refetch has populated transcripts.
  useEffect(() => {
    if (meetingData.transcripts.length > 0 && postRecordingSnapshot.length > 0) {
      setPostRecordingSnapshot([]);
    }
  }, [meetingData.transcripts.length, postRecordingSnapshot.length]);

  // Dismiss the "Saving transcript..." loading toast once the stop flow completes.
  useEffect(() => {
    if (!recordingState.isStopping) {
      toast.dismiss('transcript-save');
    }
  }, [recordingState.isStopping]);

  // Track page view
  useEffect(() => {
    Analytics.trackPageView('meeting_details');
  }, []);

  // Silence auto-stop event handlers
  // These mirror the Rust `spawn_silence_monitor` events so the UI stays in sync.
  useEffect(() => {
    let unlistenWarning: (() => void) | null = null;
    let unlistenStopped: (() => void) | null = null;

    const setup = async () => {
      // 10-second pre-stop warning toast
      unlistenWarning = await listen<{ secondsRemaining: number }>(
        'recording-silence-warning',
        (event) => {
          const secs = event.payload.secondsRemaining;
          toast.warning(
            `No voice detected — recording will auto-stop in ${secs} second${secs !== 1 ? 's' : ''}`,
            {
              id: 'silence-warning',
              duration: 12000, // stays visible until auto-stop fires
            }
          );
        }
      );

      // Recording was stopped by the silence monitor — trigger the same
      // frontend teardown as a manual "End Recording" press.
      unlistenStopped = await listen('recording-auto-stopped', () => {
        toast.dismiss('silence-warning');
        toast.info('Recording automatically stopped after silence', {
          duration: 5000,
        });
        // Trigger the normal stop UI flow (snapshot, transcript save toast, etc.)
        handleStopRecordingOnPage();
      });
    };

    setup();

    return () => {
      unlistenWarning?.();
      unlistenStopped?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve a valid summary template ID at runtime.
  // Prefer standard_meeting; fall back to first available template from backend.
  useEffect(() => {
    let cancelled = false;

    const resolveTemplate = async () => {
      setIsTemplateLoading(true);
      try {
        const templates = await invoke('api_list_templates') as Array<{
          id: string;
          name: string;
          description: string;
        }>;

        if (cancelled) return;

        if (!templates || templates.length === 0) {
          setSelectedTemplate('standard_meeting');
          return;
        }

        const hasStandardMeeting = templates.some((template) => template.id === 'standard_meeting');
        setSelectedTemplate(hasStandardMeeting ? 'standard_meeting' : templates[0].id);
      } catch (error) {
        console.error('Failed to resolve summary template, falling back to standard_meeting:', error);
        if (!cancelled) {
          setSelectedTemplate('standard_meeting');
        }
      } finally {
        if (!cancelled) {
          setIsTemplateLoading(false);
        }
      }
    };

    resolveTemplate();

    return () => {
      cancelled = true;
    };
  }, []);

  // Accept an optional customPrompt to match SummaryGeneratorButtonGroup's call signature
  const handleGenerateSummary = useCallback(async (customPrompt: string = '') => {
    if (isTemplateLoading) {
      toast.info('Loading summary template, please try again in a moment.');
      return;
    }

    await summaryGeneration.handleGenerateSummary(customPrompt);
  }, [isTemplateLoading, summaryGeneration]);

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (shouldAutoGenerate && meetingData.transcripts.length > 0 && !cancelled && !isTemplateLoading) {
        console.debug(`🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`);
        await handleGenerateSummary();

        // Notify parent that auto-generation is complete (only if not cancelled)
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    // Cleanup: cancel if component unmounts or meeting changes
    return () => {
      cancelled = true;
    };
  }, [shouldAutoGenerate, meeting.id, isTemplateLoading, handleGenerateSummary]); // Re-run if meeting changes

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen min-h-0 bg-background text-foreground"
    >
      <div className="flex flex-1 min-h-0 overflow-y-hidden overflow-x-hidden flex-col xl:grid xl:grid-cols-3">
        {/* Three-panel layout: Notes | Transcripts | Summary */}
        <NotesPanel
          meetingId={meeting.id}
          isNewNote={isNewNote}
          draftMeetingId={draftMeetingId}
          onMeetingCreated={onMeetingCreated}
        />
        <TranscriptPanel
          transcripts={
            isRecording
              ? liveTranscripts
              : postRecordingSnapshot.length > 0
                ? postRecordingSnapshot
                : meetingData.transcripts
          }
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onStartRecording={handleStartRecordingOnPage}
          onStopRecording={handleStopRecordingOnPage}
          isRecording={isRecording}
          isStopping={recordingState.isStopping}
          isPaused={recordingState.isPaused}
          onPauseRecording={handlePauseRecordingOnPage}
          onResumeRecording={handleResumeRecordingOnPage}
          disableAutoScroll={!isRecording}
          // During recording or snapshot: bypass pagination and render directly.
          // After recording and API refetch: switch back to paginated data.
          usePagination={!isRecording && postRecordingSnapshot.length === 0}
          segments={(!isRecording && postRecordingSnapshot.length === 0) ? segments : undefined}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
        />
        <SummaryPanel
          meeting={meeting}
          meetingTitle={meetingData.meetingTitle}
          summaryRef={meetingData.blockNoteSummaryRef}
          aiSummary={meetingData.aiSummary}
          summaryStatus={summaryGeneration.summaryStatus}
          transcripts={meetingData.transcripts}
          summaryResponse={summaryResponse}
          onSaveSummary={meetingData.handleSaveSummary}
          onSummaryChange={meetingData.handleSummaryChange}
          onDirtyChange={meetingData.setIsSummaryDirty}
          summaryError={summaryGeneration.summaryError}
          onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
          getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
          // Header button props — Generate/Copy toggle + model check
          hasExistingSummary={hasExistingSummary}
          onCopySummary={copyOperations.handleCopySummary}
          modelConfig={modelConfig}
          onGenerateSummary={handleGenerateSummary}
          onStopGeneration={summaryGeneration.handleStopGeneration}
          customPrompt=""
        />
      </div>
    </motion.div>
  );
}
