"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { Summary, SummaryResponse, Transcript } from '@/types';
import { Block } from '@blocknote/core';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import Analytics from '@/lib/analytics';
import { TranscriptPanel } from '@/components/MeetingDetails/TranscriptPanel';
import { SummaryPanel } from '@/components/MeetingDetails/SummaryPanel';
import { NotesPanel, type NotesPanelRef } from '@/components/NotesPanel';
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
  const [hasNotesContent, setHasNotesContent] = useState(false);
  const [liveNotesMarkdown, setLiveNotesMarkdown] = useState('');
  const [liveNotesBlocks, setLiveNotesBlocks] = useState<Block[] | null>(null);
  // Snapshot of live transcripts captured when "End Recording" is pressed.
  // Holds the panel content stable while the API refetch completes (prevents flash).
  const [postRecordingSnapshot, setPostRecordingSnapshot] = useState<Transcript[]>([]);
  const [isTranscriptFinalizing, setIsTranscriptFinalizing] = useState(false);
  const notesPanelRef = useRef<NotesPanelRef>(null);

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
  const { isRecording, setRecordingMeetingId } = recordingState;

  // True only when a recording is active AND it belongs to this specific meeting.
  // isRecording (global) stays true for "is anything recording?" checks elsewhere.
  const isRecordingForThisMeeting =
    isRecording && recordingState.recordingMeetingId === meeting.id;
  const isStoppingForThisMeeting =
    recordingState.isStopping && recordingState.recordingMeetingId === meeting.id;

  // Always-current ref to recording ownership — readable inside stale closures
  const recordingMeetingIdRef = useRef<string | null>(recordingState.recordingMeetingId);
  useEffect(() => {
    recordingMeetingIdRef.current = recordingState.recordingMeetingId;
  }, [recordingState.recordingMeetingId]);

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
    liveNotesMarkdown,
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

  const hasTranscriptContent = useMemo(() => {
    const transcriptSource = isRecordingForThisMeeting
      ? liveTranscripts
      : postRecordingSnapshot.length > 0
        ? postRecordingSnapshot
        : meetingData.transcripts;

    return transcriptSource.some(
      (segment: Transcript) => typeof segment.text === 'string' && segment.text.trim().length > 0
    );
  }, [isRecordingForThisMeeting, liveTranscripts, postRecordingSnapshot, meetingData.transcripts]);

  const hasCleanupSourceContent = hasTranscriptContent || hasNotesContent;

  const persistLiveNotesToMeeting = useCallback(async (targetMeetingId: string) => {
    if (!liveNotesBlocks || !hasNotesContent) {
      return;
    }

    await invoke('api_save_note', {
      meetingId: targetMeetingId,
      contentJson: JSON.stringify(liveNotesBlocks),
      contentMarkdown: liveNotesMarkdown,
      version: null,
    });
  }, [hasNotesContent, liveNotesBlocks, liveNotesMarkdown]);

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
      if (notesPanelRef.current) {
        await notesPanelRef.current.flushNotes(meetingIdToUse);
      } else {
        await persistLiveNotesToMeeting(meetingIdToUse);
      }
      // Update the URL and sidebar so the page re-renders with the new ID
      onMeetingCreated?.(meetingIdToUse);
    }

    // Clear snapshot and stale live transcripts from any previous session
    setPostRecordingSnapshot([]);
    clearTranscripts();

    // Pre-seed the meeting ID: recording stop will attach transcripts here
    setPendingMeetingId(meetingIdToUse);

    // Claim ownership of this recording for this meeting BEFORE starting
    setRecordingMeetingId(meetingIdToUse);

    await handleRecordingStart();
  }, [meeting.id, onMeetingCreated, persistLiveNotesToMeeting, setPendingMeetingId, clearTranscripts, handleRecordingStart, setRecordingMeetingId]);

  // Stop recording — delegates to useRecordingStop (mirrors sidebar behaviour)
  const handleStopRecordingOnPage = useCallback(async () => {
    // Guard: only the meeting that owns the recording can stop it.
    if (recordingState.recordingMeetingId !== meeting.id) {
      console.warn(
        '[Recording] Ignoring stop request: recording belongs to meeting %s, currently viewing %s',
        recordingState.recordingMeetingId,
        meeting.id,
      );
      return;
    }

    // Capture snapshot before clearTranscripts() runs internally, so the panel
    // stays populated during the ~1s gap while the API refetches.
    await notesPanelRef.current?.flushNotes(recordingState.recordingMeetingId || meeting.id);
    setPostRecordingSnapshot([...liveTranscripts]);
    setIsTranscriptFinalizing(true);
    toast.loading('Saving transcript...', { id: 'transcript-save' });
    Analytics.trackButtonClick('stop_recording', 'meeting_details_transcript_header');
    handleRecordingStop({ source: 'ui', callApi: true }).catch((error) => {
      console.error('Failed to stop recording:', error);
      setIsTranscriptFinalizing(false);
      toast.dismiss('transcript-save');
    });
  }, [handleRecordingStop, liveTranscripts, recordingState.recordingMeetingId, meeting.id]);

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
    if (!isTranscriptFinalizing) {
      toast.dismiss('transcript-save');
    }
  }, [isTranscriptFinalizing]);

  useEffect(() => {
    const handleRecordingSaveComplete = (event: Event) => {
      const customEvent = event as CustomEvent<{ meetingId?: string }>;

      if (customEvent.detail?.meetingId !== meeting.id) {
        return;
      }

      setIsTranscriptFinalizing(false);
      toast.dismiss('transcript-save');
    };
    const handleRecordingSaveFailed = (event: Event) => {
      const customEvent = event as CustomEvent<{ meetingId?: string }>;

      if (customEvent.detail?.meetingId && customEvent.detail.meetingId !== meeting.id) {
        return;
      }

      setIsTranscriptFinalizing(false);
      toast.dismiss('transcript-save');
    };

    window.addEventListener('recording-save-complete', handleRecordingSaveComplete);
    window.addEventListener('recording-save-failed', handleRecordingSaveFailed);
    return () => {
      window.removeEventListener('recording-save-complete', handleRecordingSaveComplete);
      window.removeEventListener('recording-save-failed', handleRecordingSaveFailed);
    };
  }, [meeting.id]);

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
      // 10-second pre-stop warning toast — only show on the meeting that owns the recording
      unlistenWarning = await listen<{ secondsRemaining: number }>(
        'recording-silence-warning',
        (event) => {
          if (recordingMeetingIdRef.current !== meeting.id) return;
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
        // Guard: only handle auto-stop if this page owns the recording
        if (recordingMeetingIdRef.current !== meeting.id) {
          console.warn(
            '[Auto-stop] Ignoring: recording belongs to meeting %s, currently viewing %s',
            recordingMeetingIdRef.current,
            meeting.id,
          );
          return;
        }
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
    if (isTranscriptFinalizing) {
      toast.info('Transcript is still saving. AI Cleanup will be available shortly.');
      return;
    }

    if (isTemplateLoading) {
      toast.info('Loading summary template, please try again in a moment.');
      return;
    }

    await notesPanelRef.current?.flushNotes(meeting.id);
    await summaryGeneration.handleGenerateSummary(customPrompt);
  }, [isTemplateLoading, isTranscriptFinalizing, meeting.id, summaryGeneration]);

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
          ref={notesPanelRef}
          meetingId={meeting.id}
          isNewNote={isNewNote}
          draftMeetingId={draftMeetingId}
          onMeetingCreated={onMeetingCreated}
          onContentPresenceChange={setHasNotesContent}
          onMarkdownChange={setLiveNotesMarkdown}
          onBlocksChange={setLiveNotesBlocks}
        />
        <TranscriptPanel
          transcripts={
            isRecordingForThisMeeting
              ? liveTranscripts
              : postRecordingSnapshot.length > 0
                ? postRecordingSnapshot
                : meetingData.transcripts
          }
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onStartRecording={handleStartRecordingOnPage}
          onStopRecording={handleStopRecordingOnPage}
          isRecording={isRecordingForThisMeeting}
          isStopping={isStoppingForThisMeeting}
          isPaused={recordingState.isPaused}
          onPauseRecording={handlePauseRecordingOnPage}
          onResumeRecording={handleResumeRecordingOnPage}
          disableAutoScroll={!isRecordingForThisMeeting}
          // During recording or snapshot: bypass pagination and render directly.
          // After recording and API refetch: switch back to paginated data.
          usePagination={!isRecordingForThisMeeting && postRecordingSnapshot.length === 0}
          segments={(!isRecordingForThisMeeting && postRecordingSnapshot.length === 0) ? segments : undefined}
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
          hasCleanupSourceContent={hasCleanupSourceContent}
          isTranscriptFinalizing={isTranscriptFinalizing}
        />
      </div>
    </motion.div>
  );
}
