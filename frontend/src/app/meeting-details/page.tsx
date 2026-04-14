"use client"
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { Transcript, Summary } from "@/types";
import PageContent from "./page-content";
import { useRouter, useSearchParams } from "next/navigation";
import Analytics from "@/lib/analytics";
import { invoke } from "@tauri-apps/api/core";
import { LoaderIcon } from "lucide-react";
import { useConfig } from "@/contexts/ConfigContext";
import { usePaginatedTranscripts } from "@/hooks/usePaginatedTranscripts";

interface MeetingDetailsResponse {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  transcripts: Transcript[];
}

function MeetingDetailsContent() {
  const searchParams = useSearchParams();
  const meetingId = searchParams.get('id');
  const source = searchParams.get('source'); // Check if navigated from recording
  const { setCurrentMeeting, refetchMeetings, stopSummaryPolling, setNoteSessionActive, setIsMeetingActive, pendingFolderId, setPendingFolderId } = useSidebar();
  const { isAutoSummary } = useConfig(); // Get auto-summary toggle state
  const router = useRouter();
  const [meetingDetails, setMeetingDetails] = useState<MeetingDetailsResponse | null>(null);
  const [meetingSummary, setMeetingSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [shouldAutoGenerate, setShouldAutoGenerate] = useState<boolean>(false);
  const [hasCheckedAutoGen, setHasCheckedAutoGen] = useState<boolean>(false);

  // New note mode state
  const [isNewNote, setIsNewNote] = useState<boolean>(false);
  const [draftMeetingId, setDraftMeetingId] = useState<string | null>(null);

  // Recording bar visibility: latches true when the user opens a new note and stays
  // true even after autosave changes the URL from ?id=new to ?id=<actual-uuid>.
  // Only resets when the user navigates to a completely different meeting.
  const [showRecordingControls, setShowRecordingControls] = useState(false);
  // Tracks the meeting ID that was just created by autosave so we can distinguish
  // "autosave URL change" (keep bar visible) from "user navigated away" (hide bar).
  const justCreatedMeetingIdRef = useRef<string | null>(null);

  // Detect new note mode
  useEffect(() => {
    if (meetingId === 'new') {
      setIsNewNote(true);
      setShowRecordingControls(true);
      setIsMeetingActive(true);
      setIsLoading(false);
      // Initialize empty meeting object for new note
      setMeetingDetails({
        id: 'new',
        title: 'Untitled Note',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        transcripts: []
      });
    } else {
      setIsNewNote(false);
      setDraftMeetingId(null);
      // Keep the recording bar visible if the URL changed because autosave just created
      // this meeting (new → actual UUID). Hide it only when navigating to a different meeting.
      if (meetingId !== justCreatedMeetingIdRef.current) {
        setShowRecordingControls(false);
        setIsMeetingActive(false);
        justCreatedMeetingIdRef.current = null;
      }
    }
  }, [meetingId, setIsMeetingActive]);

  // Clear the active-meeting flag when the user navigates away from this page.
  // This ensures the sidebar "Start Recording" button disappears on old meetings
  // and on the home page after leaving an active session.
  useEffect(() => {
    return () => {
      setIsMeetingActive(false);
    };
  }, [setIsMeetingActive]);

  // Use pagination hook for efficient transcript loading (skip for new notes)
  const {
    metadata,
    segments,
    transcripts,
    isLoading: isLoadingTranscripts,
    // isRefetching is true only during a background refresh (data already on screen).
    // It must NOT be used to show a full-page spinner — panels must stay mounted.
    isRefetching: isRefetchingTranscripts,
    isLoadingMore,
    hasMore,
    totalCount,
    loadedCount,
    loadMore,
    refetch: refetchTranscripts,
    error: transcriptError,
  } = usePaginatedTranscripts({ meetingId: meetingId === 'new' ? '' : (meetingId || '') });

  // Check if gemma3:1b model is available in Ollama
  const checkForGemmaModel = useCallback(async (): Promise<boolean> => {
    try {
      const models = await invoke('get_ollama_models', { endpoint: null }) as any[];
      const hasGemma = models.some((m: any) => m.name === 'gemma3:1b');
      console.debug('🔍 Checked for gemma3:1b:', hasGemma);
      return hasGemma;
    } catch (error) {
      console.error('❌ Failed to check Ollama models:', error);
      return false;
    }
  }, []);

  // Set up auto-generation - respects DB as source of truth
  const setupAutoGeneration = useCallback(async () => {
    if (hasCheckedAutoGen) return; // Only check once

    // Only auto-generate if navigated from recording
    if (source !== 'recording') {
      console.debug('Not from recording navigation, skipping auto-generation');
      setHasCheckedAutoGen(true);
      return;
    }

    // Respect user's auto-summary toggle preference
    if (!isAutoSummary) {
      console.debug('Auto-summary is disabled in settings');
      setHasCheckedAutoGen(true);
      return;
    }

    try {
      // Check what's currently in database
      const currentConfig = await invoke('api_get_model_config') as any;

      // If DB already has a model, use it (never override!)
      if (currentConfig && currentConfig.model) {
        console.debug('Using existing model from DB:', currentConfig.model);
        setShouldAutoGenerate(true);
        setHasCheckedAutoGen(true);
        return;
      }

      // DB is empty - check if gemma3:1b exists as fallback
      const hasGemma = await checkForGemmaModel();

      if (hasGemma) {
        console.debug('💾 DB empty, using gemma3:1b as initial default');

        await invoke('api_save_model_config', {
          provider: 'ollama',
          model: '',
          whisperModel: 'large-v3',
          apiKey: null,
          ollamaEndpoint: null,
        });

        setShouldAutoGenerate(true);
      } else {
        console.debug('⚠️ No model configured and gemma3:1b not found');
      }
    } catch (error) {
      console.error('❌ Failed to setup auto-generation:', error);
    }

    setHasCheckedAutoGen(true);
  }, [hasCheckedAutoGen, checkForGemmaModel, source, isAutoSummary]);

  // Sync meeting metadata from pagination hook to meeting details state
  useEffect(() => {
    if (metadata && (!meetingId || meetingId === 'intro-call')) {
      // If invalid meeting ID, don't sync
      return;
    }

    if (metadata) {
      console.debug('Meeting metadata loaded:', metadata);

      // Build meeting details from metadata and paginated transcripts
      setMeetingDetails({
        id: metadata.id,
        title: metadata.title,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
        transcripts: transcripts, // Paginated transcripts from hook
      });

      // Sync with sidebar context
      setCurrentMeeting({ id: metadata.id, title: metadata.title });
    }
  }, [metadata, transcripts, meetingId, setCurrentMeeting]);

  // Handle transcript loading errors (skip for new note mode)
  useEffect(() => {
    if (transcriptError && !isNewNote) {
      console.error('Error loading transcripts:', transcriptError);
      setError(transcriptError);
    }
  }, [transcriptError, isNewNote]);

  // Refresh transcript list in-place when recording stop flow saves new segments
  // to this same meeting (no route change).
  useEffect(() => {
    const handleMeetingTranscriptsUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ meetingId?: string }>;
      const updatedMeetingId = customEvent.detail?.meetingId;

      if (!updatedMeetingId || !meetingId || meetingId === 'new') {
        return;
      }

      if (updatedMeetingId === meetingId) {
        console.debug('Detected transcript update for current meeting; refetching paginated transcripts...');
        refetchTranscripts();
      }
    };

    window.addEventListener('meeting-transcripts-updated', handleMeetingTranscriptsUpdated);
    return () => {
      window.removeEventListener('meeting-transcripts-updated', handleMeetingTranscriptsUpdated);
    };
  }, [meetingId, refetchTranscripts]);

  // Extract fetchMeetingDetails for use in child components (now refetches via hook)
  const fetchMeetingDetails = useCallback(async () => {
    if (!meetingId || meetingId === 'intro-call') {
      return;
    }

    await refetchTranscripts();
  }, [meetingId, refetchTranscripts]);

  // Refetch summary data for the active meeting and update parent summary state.
  // Used both on initial load and after summary generation completes.
  const refetchSummaryForMeeting = useCallback(async (targetMeetingId?: string) => {
    const effectiveMeetingId = targetMeetingId || meetingId;
    if (!effectiveMeetingId || effectiveMeetingId === 'intro-call' || effectiveMeetingId === 'new') {
      return;
    }

    try {
      const summary = await invoke('api_get_summary', {
        meetingId: effectiveMeetingId,
      }) as any;

      console.debug(
        'FETCH SUMMARY: status=%s hasData=%s hasError=%s',
        summary.status,
        Boolean(summary.data),
        Boolean(summary.error)
      );

      if (summary.status === 'idle' || (!summary.data && summary.status === 'error')) {
        console.warn('Meeting summary not found or no summary generated yet:', summary.error || 'idle');
        setMeetingSummary(null);
        return;
      }

      const summaryData = summary.data || {};

      let parsedData = summaryData;
      if (typeof summaryData === 'string') {
        try {
          parsedData = JSON.parse(summaryData);
        } catch (e) {
          parsedData = {};
        }
      }

      console.debug(
        'FETCH SUMMARY: parsed data keys=%s',
        Object.keys(parsedData || {}).join(',')
      );

      if (parsedData.summary_json) {
        setMeetingSummary(parsedData as any);
        return;
      }

      if (parsedData.markdown) {
        setMeetingSummary(parsedData as any);
        return;
      }

      console.debug('LEGACY FORMAT: Detected legacy format, applying section formatting');

      const { MeetingName, _section_order, ...restSummaryData } = parsedData;
      const formattedSummary: Summary = {};
      const sectionKeys = _section_order || Object.keys(restSummaryData);

      console.debug('LEGACY FORMAT: Processing sections:', sectionKeys);

      for (const key of sectionKeys) {
        try {
          const section = restSummaryData[key];
          if (section &&
            typeof section === 'object' &&
            'title' in section &&
            'blocks' in section) {
            const typedSection = section as { title?: string; blocks?: any[] };

            if (Array.isArray(typedSection.blocks)) {
              formattedSummary[key] = {
                title: typedSection.title || key,
                blocks: typedSection.blocks.map((block: any) => ({
                  ...block,
                  color: 'default',
                  content: block?.content?.trim() || ''
                }))
              };
            } else {
              console.warn(`LEGACY FORMAT: Section ${key} has invalid blocks:`, typedSection.blocks);
              formattedSummary[key] = {
                title: typedSection.title || key,
                blocks: []
              };
            }
          } else {
            console.warn(`LEGACY FORMAT: Skipping invalid section ${key}:`, section);
          }
        } catch (error) {
          console.warn(`LEGACY FORMAT: Error processing section ${key}:`, error);
        }
      }

      console.debug(
        'LEGACY FORMAT: Formatted summary sections=%s',
        Object.keys(formattedSummary).length
      );
      setMeetingSummary(formattedSummary);
    } catch (error) {
      console.error('FETCH SUMMARY: Error fetching meeting summary:', error);
      setMeetingSummary(null);
    }
  }, [meetingId]);

  // Reset states when meetingId changes (prevent race conditions)
  useEffect(() => {
    // For new note mode: clear any stale summary/state from the previous meeting,
    // but don't touch meetingDetails (already re-initialized by the detect effect).
    if (meetingId === 'new') {
      setMeetingSummary(null);
      setShouldAutoGenerate(false);
      setHasCheckedAutoGen(false);
      return;
    }
    // Skip reset when URL changes from ?id=new to ?id=<uuid> due to autosave
    if (meetingId === justCreatedMeetingIdRef.current) {
      return;
    }

    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setIsLoading(true);
    // Reset auto-generation state to allow new meeting to be checked
    setHasCheckedAutoGen(false);
    setShouldAutoGenerate(false);
  }, [meetingId]);

  // Cleanup: Stop polling when navigating away from a meeting
  useEffect(() => {
    return () => {
      if (meetingId) {
        console.debug('Cleaning up: Stopping summary polling for meeting:', meetingId);
        stopSummaryPolling(meetingId);
      }
    };
  }, [meetingId, stopSummaryPolling]);

  useEffect(() => {
    console.debug('MeetingDetails useEffect triggered - meetingId:', meetingId);

    // Skip data fetching for new note mode (check meetingId directly to avoid race conditions)
    if (meetingId === 'new') {
      console.debug('New note mode detected, skipping data fetch');
      setIsLoading(false); // Important: Set loading to false for new notes
      Analytics.trackPageView('meeting_details_new_note');
      return;
    }

    // Skip data fetch when URL changes from ?id=new to ?id=<uuid> due to autosave
    if (meetingId === justCreatedMeetingIdRef.current) {
      return;
    }

    if (!meetingId || meetingId === 'intro-call') {
      console.warn('No valid meeting ID in URL - meetingId:', meetingId);
      setError("No meeting selected");
      setIsLoading(false);
      Analytics.trackPageView('meeting_details');
      return;
    }

    console.debug('Valid meeting ID found, fetching details for:', meetingId);

    setMeetingDetails(null);
    setMeetingSummary(null);
    setError(null);
    setIsLoading(true);

    const loadData = async () => {
      try {
        await refetchSummaryForMeeting(meetingId);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
  }, [meetingId, isNewNote, refetchSummaryForMeeting]);

  // Auto-generation check: runs when meeting is loaded with no summary
  useEffect(() => {
    const checkAutoGen = async () => {
      // Only auto-generate if:
      // 1. We have meeting details
      // 2. No summary exists
      // 3. Meeting has transcripts
      // 4. Haven't checked yet
      if (
        meetingDetails &&
        meetingSummary === null &&
        meetingDetails.transcripts &&
        meetingDetails.transcripts.length > 0 &&
        !hasCheckedAutoGen
      ) {
        console.debug('No summary found, checking for auto-generation...');
        await setupAutoGeneration();
      }
    };

    checkAutoGen();
  }, [meetingDetails, meetingSummary, hasCheckedAutoGen, setupAutoGeneration]);

  // Inform the sidebar whether a note-taking session is currently open so the
  // sidebar "Start Recording" button can append to it instead of creating a new session.
  // Clears on unmount so the flag doesn't persist after the user navigates away.
  useEffect(() => {
    setNoteSessionActive(showRecordingControls);
    return () => {
      setNoteSessionActive(false);
    };
  }, [showRecordingControls, setNoteSessionActive]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Show loading spinner while initial data loads (skip transcript loading check for new notes)
  const isNewNoteTransition = meetingId === justCreatedMeetingIdRef.current && meetingDetails !== null;
  // Only block rendering on isLoadingTranscripts during the true initial load
  // (when the hook has not yet delivered data for this meeting). Background
  // refetches are indicated by isRefetchingTranscripts, which must never cause
  // a spinner — doing so would unmount NotesPanel and wipe unsaved user edits.
  if (!isNewNoteTransition && ((isLoading || (!isNewNote && isLoadingTranscripts && !isRefetchingTranscripts)) || !meetingDetails)) {
    return <div className="flex items-center justify-center h-screen">
      <LoaderIcon className="animate-spin size-6 " />
    </div>;
  }

  return <PageContent
    meeting={meetingDetails}
    summaryData={meetingSummary}
    shouldAutoGenerate={shouldAutoGenerate}
    onAutoGenerateComplete={() => setShouldAutoGenerate(false)}
    onMeetingUpdated={async () => {
      // Refetch meeting details to get updated title from backend
      await fetchMeetingDetails();
      // Refetch meetings list to update sidebar
      await refetchMeetings();
    }}
    onSummaryUpdated={async () => {
      await refetchSummaryForMeeting(meetingId || undefined);
    }}
    // New note mode props
    isNewNote={isNewNote}
    draftMeetingId={draftMeetingId}
    onMeetingCreated={async (actualMeetingId: string) => {
      // Mark this ID as a new-note autosave transition so the recording bar
      // stays visible when the URL changes from ?id=new to ?id=<actualMeetingId>.
      justCreatedMeetingIdRef.current = actualMeetingId;
      // Update URL to actual meeting ID
      router.replace(`/meeting-details?id=${actualMeetingId}`);

      // Assign the new meeting to a folder if the user clicked "+" on one
      if (pendingFolderId) {
        try {
          await invoke('api_move_meeting_to_folder', { meetingId: actualMeetingId, folderId: pendingFolderId });
          console.debug('✅ New note assigned to folder:', pendingFolderId);
        } catch (err) {
          console.warn('Could not assign new note to folder:', err);
        } finally {
          setPendingFolderId(null);
        }
      }

      // Refresh sidebar to show newly created note (in the correct folder if applicable)
      await refetchMeetings();
      console.debug('✅ Sidebar refreshed with new note:', actualMeetingId);
    }}
    // Pagination props for efficient transcript loading
    segments={segments}
    hasMore={hasMore}
    isLoadingMore={isLoadingMore}
    totalCount={totalCount}
    loadedCount={loadedCount}
    onLoadMore={loadMore}
  />;
}

export default function MeetingDetails() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-screen">
        <LoaderIcon className="animate-spin size-6" />
      </div>
    }>
      <MeetingDetailsContent />
    </Suspense>
  );
}
