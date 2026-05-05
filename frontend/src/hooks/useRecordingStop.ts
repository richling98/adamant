import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { toast } from 'sonner';
import { useTranscripts } from '@/contexts/TranscriptContext';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { storageService } from '@/services/storageService';
import { transcriptService } from '@/services/transcriptService';
import Analytics from '@/lib/analytics';

type SummaryStatus = 'idle' | 'processing' | 'summarizing' | 'regenerating' | 'completed' | 'error';
type StopRecordingSource = 'ui' | 'backend_event';

interface StopRecordingOptions {
  source?: StopRecordingSource;
  callApi?: boolean;
}

function normalizeStopOptions(
  options: boolean | StopRecordingOptions | undefined
): Required<StopRecordingOptions> {
  if (typeof options === 'boolean') {
    return { source: 'ui', callApi: options };
  }

  return {
    source: options?.source ?? 'ui',
    callApi: options?.callApi ?? true,
  };
}

interface UseRecordingStopReturn {
  handleRecordingStop: (options?: boolean | StopRecordingOptions) => Promise<void>;
  isStopping: boolean;
  isProcessingTranscript: boolean;
  isSavingTranscript: boolean;
  summaryStatus: SummaryStatus;
  setIsStopping: (value: boolean) => void;
}

/**
 * Custom hook for managing recording stop lifecycle.
 * Handles the complex stop sequence: transcription wait → buffer flush → SQLite save → navigation.
 *
 * Features:
 * - Transcription completion polling (60s max, 500ms interval)
 * - Transcript buffer flush coordination
 * - SQLite meeting save with folder_path from sessionStorage
 * - Comprehensive analytics tracking (duration, word count, activation)
 * - Auto-navigation to meeting details
 * - Toast notifications for success/error
 * - Window exposure for Rust callbacks
 */
export function useRecordingStop(
  setIsRecording: (value: boolean) => void,
  setIsRecordingDisabled: (value: boolean) => void
): UseRecordingStopReturn {
  // USE global state instead
  const recordingState = useRecordingState();
  const {
    status,
    setStatus,
    isStopping,
    isProcessing: isProcessingTranscript,
    isSaving: isSavingTranscript
  } = recordingState;

  const {
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
    pendingMeetingId,
    setPendingMeetingId,
  } = useTranscripts();

  const {
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
    pendingFolderId,
    setPendingFolderId,
  } = useSidebar();

  const router = useRouter();

  // Guard to prevent duplicate/concurrent stop calls (e.g., from UI and tray simultaneously)
  const stopInProgressRef = useRef(false);

  // Promise to track recording-stopped event data (fixes race condition with recording-stop-complete)
  const recordingStoppedDataRef = useRef<Promise<void> | null>(null);

  // Set up recording-stopped listener for meeting navigation
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;

    const setupRecordingStoppedListener = async () => {
      try {
        console.debug('Setting up recording-stopped listener for navigation...');
        unlistenFn = await listen<{
          message: string;
          folder_path?: string;
          meeting_name?: string;
        }>('recording-stopped', async (event) => {
          // Create promise that resolves when sessionStorage is set (prevents race condition)
          recordingStoppedDataRef.current = (async () => {
            const { folder_path, meeting_name } = event.payload;

            // Store folder_path and meeting_name for later use in handleRecordingStop
            if (folder_path) {
              sessionStorage.setItem('last_recording_folder_path', folder_path);
            }
            if (meeting_name) {
              sessionStorage.setItem('last_recording_meeting_name', meeting_name);
            }
          })();

        });
        console.debug('Recording stopped listener setup complete');
      } catch (error) {
        console.error('Failed to setup recording stopped listener:', error);
      }
    };

    setupRecordingStoppedListener();

    return () => {
      console.debug('Cleaning up recording stopped listener...');
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, [router]);

  // Main recording stop handler
  const handleRecordingStop = useCallback(async (options?: boolean | StopRecordingOptions) => {
    const { source, callApi } = normalizeStopOptions(options);
    // Guard: prevent duplicate/concurrent stop calls
    if (stopInProgressRef.current) {
      console.debug('Ignoring duplicate stop request while stop is already in progress');
      return;
    }
    stopInProgressRef.current = true;

    // Set status to STOPPING immediately
    setStatus(RecordingStatus.STOPPING, source === 'ui' ? 'Stopping recording...' : 'Processing stopped recording...');
    setIsRecordingDisabled(true);
    const stopStartTime = Date.now();

    try {
      console.debug('Stop flow initiated', {
        source,
        callApi,
        stop_initiated_at: new Date(stopStartTime).toISOString(),
        current_transcript_count: transcriptsRef.current.length
      });

      if (source === 'ui') {
        // Reset previous metadata promise so we only use data from this stop request.
        recordingStoppedDataRef.current = null;

        const dataDir = await appDataDir();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const savePath = `${dataDir}/recording-${timestamp}.wav`;

        let stopError: unknown = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            console.debug(`Calling backend stop_recording (attempt ${attempt}/2)...`, { savePath });
            await invoke('stop_recording', {
              args: {
                save_path: savePath,
              },
            });
            console.debug('Backend stop_recording succeeded');
            stopError = null;
            break;
          } catch (error) {
            stopError = error;
            console.error(`Backend stop_recording failed (attempt ${attempt}/2):`, error);

            if (attempt < 2) {
              console.debug('Retrying backend stop_recording once...');
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
        }

        if (stopError) {
          const message = stopError instanceof Error ? stopError.message : 'Failed to stop recording';
          setStatus(RecordingStatus.ERROR, message);
          toast.error('Failed to stop recording', { description: message });
          window.dispatchEvent(new CustomEvent('recording-save-failed', {
            detail: {
              meetingId: pendingMeetingId ?? undefined,
              error: message,
            },
          }));
          return;
        }

        // Wait briefly for "recording-stopped" metadata emitted by backend stop.
        let waitedMs = 0;
        const waitStepMs = 100;
        const waitLimitMs = 3000;
        while (!recordingStoppedDataRef.current && waitedMs < waitLimitMs) {
          await new Promise(resolve => setTimeout(resolve, waitStepMs));
          waitedMs += waitStepMs;
        }

        if (recordingStoppedDataRef.current) {
          await recordingStoppedDataRef.current;
        } else {
          console.warn('Timed out waiting for recording-stopped metadata; proceeding without folder metadata');
        }
      } else {
        // Backend-owned stops (tray, shortcuts, silence auto-stop) emit
        // recording-stopped before recording-stop-complete. Wait briefly for
        // that metadata so folder/name data is available to the save path.
        let waitedMs = 0;
        const waitStepMs = 100;
        const waitLimitMs = 3000;
        while (!recordingStoppedDataRef.current && waitedMs < waitLimitMs) {
          await new Promise(resolve => setTimeout(resolve, waitStepMs));
          waitedMs += waitStepMs;
        }

        if (recordingStoppedDataRef.current) {
          await recordingStoppedDataRef.current;
        } else {
          console.warn('Timed out waiting for backend stop metadata; proceeding without folder metadata');
        }
      }

      // Wait for transcription to complete
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Waiting for transcription...');
      console.debug('Waiting for transcription to complete...');

      const MAX_WAIT_TIME = 60000; // 60 seconds maximum wait (increased for longer processing)
      const POLL_INTERVAL = 500; // Check every 500ms
      let elapsedTime = 0;
      let transcriptionComplete = false;

      // Listen for transcription-complete event
      const unlistenComplete = await listen('transcription-complete', () => {
        console.debug('Received transcription-complete event');
        transcriptionComplete = true;
      });

      // Poll for transcription status
      while (elapsedTime < MAX_WAIT_TIME && !transcriptionComplete) {
        try {
          const status = await transcriptService.getTranscriptionStatus();
          console.debug('Transcription status:', status);

          // Check if transcription is complete
          if (!status.is_processing && status.chunks_in_queue === 0) {
            console.debug('Transcription complete - no active processing and no chunks in queue');
            transcriptionComplete = true;
            break;
          }

          // If no activity for more than 8 seconds and no chunks in queue, consider it done (increased from 5s to 8s)
          if (status.last_activity_ms > 8000 && status.chunks_in_queue === 0) {
            console.debug('Transcription likely complete - no recent activity and empty queue');
            transcriptionComplete = true;
            break;
          }

          // Update user with current status
          if (status.chunks_in_queue > 0) {
            console.debug(`Processing ${status.chunks_in_queue} remaining audio chunks...`);
            setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, `Processing ${status.chunks_in_queue} remaining chunks...`);
          }

          // Wait before next check
          await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
          elapsedTime += POLL_INTERVAL;
        } catch (error) {
          console.error('Error checking transcription status:', error);
          break;
        }
      }

      // Clean up listener
      console.debug('🧹 CLEANUP: Cleaning up transcription-complete listener');
      unlistenComplete();

      if (!transcriptionComplete && elapsedTime >= MAX_WAIT_TIME) {
        console.warn('⏰ Transcription wait timeout reached after', elapsedTime, 'ms');
      } else {
        console.debug('✅ Transcription completed after', elapsedTime, 'ms');
        // Wait longer for any late transcript segments (increased from 1s to 4s)
        console.debug('⏳ Waiting for late transcript segments...');
        await new Promise(resolve => setTimeout(resolve, 4000));
      }

      // Final buffer flush: process ALL remaining transcripts regardless of timing
      const flushStartTime = Date.now();
      console.debug('🔄 Final buffer flush: forcing processing of any remaining transcripts...', {
        flush_started_at: new Date(flushStartTime).toISOString(),
        time_since_stop: flushStartTime - stopStartTime,
        current_transcript_count: transcriptsRef.current.length
      });
      setStatus(RecordingStatus.PROCESSING_TRANSCRIPTS, 'Flushing transcript buffer...');
      flushBuffer();
      const flushEndTime = Date.now();
      console.debug('✅ Final buffer flush completed', {
        flush_duration: flushEndTime - flushStartTime,
        total_time_since_stop: flushEndTime - stopStartTime,
        final_transcript_count: transcriptsRef.current.length
      });

      // NOTE: Status remains PROCESSING_TRANSCRIPTS until we start saving

      // Wait a bit more to ensure all transcript state updates have been processed
      console.debug('Waiting for transcript state updates to complete...');
      await new Promise(resolve => setTimeout(resolve, 500));

      // Save to SQLite
      // NOTE: enabled to save COMPLETE transcripts after frontend receives all updates
      // This ensures user sees all transcripts streaming in before database save
      if (callApi && transcriptionComplete == true) {

        setStatus(RecordingStatus.SAVING, 'Saving meeting to database...');

        // Get fresh transcript state (ALL transcripts including late ones)
        const freshTranscripts = [...transcriptsRef.current];

        // Get folder_path and meeting_name from recording-stopped event
        const folderPath = sessionStorage.getItem('last_recording_folder_path');
        const savedMeetingName = sessionStorage.getItem('last_recording_meeting_name');

        console.debug('💾 Saving COMPLETE transcripts to database...', {
          transcript_count: freshTranscripts.length,
          meeting_name: savedMeetingName || meetingTitle,
          folder_path: folderPath,
          sample_text: freshTranscripts.length > 0 ? freshTranscripts[0].text.substring(0, 50) + '...' : 'none',
          last_transcript: freshTranscripts.length > 0 ? freshTranscripts[freshTranscripts.length - 1].text.substring(0, 30) + '...' : 'none',
        });

        // Capture pendingMeetingId at save time — this is the existing meeting ID
        // set by the notes-page "Start Recording" button (unified notes + recording flow).
        const existingMeetingId = pendingMeetingId ?? undefined;

        try {
          const responseData = await storageService.saveMeeting(
            savedMeetingName || meetingTitle || 'New Meeting',  // PREFER savedMeetingName (backend source)
            freshTranscripts,
            folderPath,
            existingMeetingId
          );

          const meetingId = responseData.meeting_id;
          if (!meetingId) {
            console.error('No meeting_id in response:', responseData);
            throw new Error('No meeting ID received from save operation');
          }

          console.debug('✅ Successfully saved COMPLETE meeting with ID:', meetingId, existingMeetingId ? '(attached to existing meeting)' : '(new meeting)');
          console.debug('   Transcripts:', freshTranscripts.length);
          console.debug('   folder_path:', folderPath);

          // Assign meeting to pending folder if one was set (user clicked "+" on a folder before recording)
          if (pendingFolderId) {
            try {
              await invoke('api_move_meeting_to_folder', { meetingId, folderId: pendingFolderId });
              console.debug('✅ Assigned new meeting to folder:', pendingFolderId);
            } catch (folderError) {
              console.warn('Could not assign meeting to folder:', folderError);
            } finally {
              setPendingFolderId(null);
            }
          }

          console.debug('Dispatching meeting-transcripts-updated event for meeting:', meetingId);
          window.dispatchEvent(new CustomEvent('meeting-transcripts-updated', {
            detail: { meetingId },
          }));

          // Mark meeting as saved in IndexedDB (for recovery system)
          await markMeetingAsSaved();

          // Clean up session storage
          sessionStorage.removeItem('last_recording_folder_path');
          sessionStorage.removeItem('last_recording_meeting_name');
          // Clean up IndexedDB meeting ID (redundant with markMeetingAsSaved cleanup, but ensures cleanup)
          sessionStorage.removeItem('indexeddb_current_meeting_id');

          // Clear the pending meeting ID now that save is complete
          setPendingMeetingId(null);

          // Refetch meetings and set current meeting
          await refetchMeetings();

          try {
            const meetingData = await storageService.getMeeting(meetingId);
            if (meetingData) {
              setCurrentMeeting({
                id: meetingId,
                title: meetingData.title
              });
              console.debug('✅ Current meeting set:', meetingData.title);
            }
          } catch (error) {
            console.warn('Could not fetch meeting details, using ID only:', error);
            setCurrentMeeting({ id: meetingId, title: savedMeetingName || meetingTitle || 'New Meeting' });
          }

          // Mark as completed
          setStatus(RecordingStatus.COMPLETED);

          if (existingMeetingId) {
            // Already on the meeting-details page — just show a toast and stay in place.
            toast.success('Recording saved!', {
              description: `${freshTranscripts.length} transcript segments added to this meeting.`,
              duration: 5000,
            });
            window.dispatchEvent(new CustomEvent('recording-save-complete', {
              detail: {
                meetingId,
                transcriptCount: freshTranscripts.length,
              },
            }));
            clearTranscripts();
            setStatus(RecordingStatus.IDLE);
          } else {
            // Classic home-page recording flow: navigate to the new meeting.
            // Show success toast with navigation option
            toast.success('Recording saved successfully!', {
              description: `${freshTranscripts.length} transcript segments saved.`,
              action: {
                label: 'View Meeting',
                onClick: () => {
                  router.push(`/meeting-details?id=${meetingId}`);
                  Analytics.trackButtonClick('view_meeting_from_toast', 'recording_complete');
                }
              },
              duration: 10000,
            });
            window.dispatchEvent(new CustomEvent('recording-save-complete', {
              detail: {
                meetingId,
                transcriptCount: freshTranscripts.length,
              },
            }));

            // Auto-navigate after a short delay with source parameter
            setTimeout(() => {
              router.push(`/meeting-details?id=${meetingId}&source=recording`);
              clearTranscripts();
              Analytics.trackPageView('meeting_details');

              // Reset to IDLE after navigation
              setStatus(RecordingStatus.IDLE);
            }, 2000);
          }
          // Track meeting completion analytics
          try {
            // Calculate meeting duration from transcript timestamps
            let durationSeconds = 0;
            if (freshTranscripts.length > 0 && freshTranscripts[0].audio_start_time !== undefined) {
              // Use audio_end_time of last transcript if available
              const lastTranscript = freshTranscripts[freshTranscripts.length - 1];
              durationSeconds = lastTranscript.audio_end_time || lastTranscript.audio_start_time || 0;
            }

            // Calculate word count
            const transcriptWordCount = freshTranscripts
              .map(t => t.text.split(/\s+/).length)
              .reduce((a, b) => a + b, 0);

            // Calculate words per minute
            const wordsPerMinute = durationSeconds > 0 ? transcriptWordCount / (durationSeconds / 60) : 0;

            // Get meetings count today
            const meetingsToday = await Analytics.getMeetingsCountToday();

            // Track meeting completed
            await Analytics.trackMeetingCompleted(meetingId, {
              duration_seconds: durationSeconds,
              transcript_segments: freshTranscripts.length,
              transcript_word_count: transcriptWordCount,
              words_per_minute: wordsPerMinute,
              meetings_today: meetingsToday
            });

            // Update meeting count in analytics.json
            await Analytics.updateMeetingCount();

            // Check for activation (first meeting)
            const { Store } = await import('@tauri-apps/plugin-store');
            const store = await Store.load('analytics.json');
            const totalMeetings = await store.get<number>('total_meetings');

            if (totalMeetings === 1) {
              const daysSinceInstall = await Analytics.calculateDaysSince('first_launch_date');
              await Analytics.track('user_activated', {
                meetings_count: '1',
                days_since_install: daysSinceInstall?.toString() || 'null',
                first_meeting_duration_seconds: durationSeconds.toString()
              });
            }
          } catch (analyticsError) {
            console.error('Failed to track meeting completion analytics:', analyticsError);
            // Don't block user flow on analytics errors
          }

        } catch (saveError) {
          console.error('Failed to save meeting to database:', saveError);
          // Clear pending folder assignment — don't leave stale state on failure
          if (pendingFolderId) {
            setPendingFolderId(null);
          }
          const errorMessage = saveError instanceof Error ? saveError.message : 'Unknown error';
          setStatus(RecordingStatus.ERROR, errorMessage);
          window.dispatchEvent(new CustomEvent('recording-save-failed', {
            detail: {
              meetingId: existingMeetingId,
              error: errorMessage,
            },
          }));
          toast.error('Failed to save meeting', {
            description: errorMessage
          });
          throw saveError;
        }
      } else {
        // No save needed, go back to IDLE
        setStatus(RecordingStatus.IDLE);
      }

      setIsMeetingActive(false);
      setIsRecording(false);
    } catch (error) {
      console.error('Error in handleRecordingStop:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatus(RecordingStatus.ERROR, errorMessage);
      window.dispatchEvent(new CustomEvent('recording-save-failed', {
        detail: {
          meetingId: pendingMeetingId ?? undefined,
          error: errorMessage,
        },
      }));
    } finally {
      // Always reset the guard flag when done
      setIsRecordingDisabled(false);
      stopInProgressRef.current = false;
    }
  }, [
    setIsRecording,
    setIsRecordingDisabled,
    setStatus,
    transcriptsRef,
    flushBuffer,
    clearTranscripts,
    meetingTitle,
    markMeetingAsSaved,
    pendingMeetingId,
    setPendingMeetingId,
    pendingFolderId,
    setPendingFolderId,
    refetchMeetings,
    setCurrentMeeting,
    setMeetings,
    meetings,
    setIsMeetingActive,
    router,
  ]);

  // Expose handleRecordingStop function to window for Rust callbacks
  const handleRecordingStopRef = useRef(handleRecordingStop);
  useEffect(() => {
    handleRecordingStopRef.current = handleRecordingStop;
  });

  useEffect(() => {
    (window as any).handleRecordingStop = (options: boolean | StopRecordingOptions = { source: 'ui', callApi: true }) => {
      handleRecordingStopRef.current(options);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).handleRecordingStop;
    };
  }, []);

  // Derive summaryStatus from RecordingStatus for backward compatibility
  const summaryStatus: SummaryStatus = status === RecordingStatus.PROCESSING_TRANSCRIPTS ? 'processing' : 'idle';

  return {
    handleRecordingStop,
    isStopping,
    isProcessingTranscript,
    isSavingTranscript,
    summaryStatus,
    setIsStopping: (value: boolean) => {
      setStatus(value ? RecordingStatus.STOPPING : RecordingStatus.IDLE);
    },
  };
}
