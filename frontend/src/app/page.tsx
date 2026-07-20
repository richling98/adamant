'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { useSidebar } from '@/components/Sidebar/SidebarProvider';
import { useRecordingState, RecordingStatus } from '@/contexts/RecordingStateContext';
import { useConfig } from '@/contexts/ConfigContext';
import Analytics from '@/lib/analytics';
import { SettingsModals } from './_components/SettingsModal';
import { useModalState } from '@/hooks/useModalState';
import { useTranscriptRecovery } from '@/hooks/useTranscriptRecovery';
import { TranscriptRecovery } from '@/components/TranscriptRecovery';
import { indexedDBService } from '@/services/indexedDBService';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const PILL_BACKGROUND_BY_THEME: Record<string, string> = {
  rune: 'linear-gradient(120deg, rgba(22, 28, 47, 0.98) 0%, rgba(33, 43, 68, 0.98) 100%)',
  mithril: 'linear-gradient(120deg, rgba(23, 22, 39, 0.98) 0%, rgba(41, 38, 61, 0.98) 100%)',
  bronze: 'linear-gradient(120deg, rgba(39, 25, 14, 0.98) 0%, rgba(60, 42, 22, 0.98) 100%)',
  adamant: 'linear-gradient(120deg, rgba(10, 28, 20, 0.98) 0%, rgba(18, 50, 37, 0.98) 100%)',
};
const PILL_SHADOW_BY_THEME: Record<string, string> = {
  rune: '0 1px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
  mithril: '0 1px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
  bronze: '0 1px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
  adamant: '0 1px 12px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
};

export default function Home() {
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [hoverStartBtn, setHoverStartBtn] = useState(false);
  const [hoverTodosBtn, setHoverTodosBtn] = useState(false);
  const [hoverChatBtn, setHoverChatBtn] = useState(false);
  const [isCreatingMeeting, setIsCreatingMeeting] = useState(false);

  const { transcriptModelConfig, uiTheme } = useConfig();
  const recordingState = useRecordingState();
  const { status } = recordingState;

  const { setIsMeetingActive, refetchMeetings } = useSidebar();
  const { modals, messages, hideModal } = useModalState(transcriptModelConfig);

  const {
    recoverableMeetings,
    checkForRecoverableTranscripts,
    recoverMeeting,
    loadMeetingTranscripts,
    deleteRecoverableMeeting,
  } = useTranscriptRecovery();

  const router = useRouter();

  useEffect(() => {
    Analytics.trackPageView('home');
  }, []);

  // Startup recovery check
  useEffect(() => {
    const performStartupChecks = async () => {
      try {
        if (
          recordingState.isRecording ||
          status === RecordingStatus.STOPPING ||
          status === RecordingStatus.PROCESSING_TRANSCRIPTS ||
          status === RecordingStatus.SAVING
        ) {
          console.debug('Skipping recovery check - recording in progress or processing');
          return;
        }

        try {
          await indexedDBService.deleteOldMeetings(7);
        } catch (error) {
          console.warn('⚠️ Failed to clean up old meetings:', error);
        }

        try {
          await indexedDBService.deleteSavedMeetings(24);
        } catch (error) {
          console.warn('⚠️ Failed to clean up saved meetings:', error);
        }

        await checkForRecoverableTranscripts();
      } catch (error) {
        console.error('Failed to perform startup checks:', error);
      }
    };

    performStartupChecks();
  }, [checkForRecoverableTranscripts, recordingState.isRecording, status]);

  // Show recovery dialog once per session when recoverable meetings are found
  useEffect(() => {
    if (recoverableMeetings.length > 0) {
      const shownThisSession = sessionStorage.getItem('recovery_dialog_shown');
      if (!shownThisSession) {
        setShowRecoveryDialog(true);
        sessionStorage.setItem('recovery_dialog_shown', 'true');
      }
    }
  }, [recoverableMeetings]);

  const handleRecovery = async (meetingId: string) => {
    try {
      const result = await recoverMeeting(meetingId);

      if (result.success) {
        toast.success('Meeting recovered successfully!', {
          description: 'Transcripts recovered successfully',
          action: result.meetingId
            ? {
                label: 'View Meeting',
                onClick: () => router.push(`/meeting-details?id=${result.meetingId}`),
              }
            : undefined,
          duration: 10000,
        });

        await refetchMeetings();

        if (recoverableMeetings.length === 0) {
          sessionStorage.removeItem('recovery_dialog_shown');
        }

        if (result.meetingId) {
          setTimeout(() => {
            router.push(`/meeting-details?id=${result.meetingId}`);
          }, 2000);
        }
      }
    } catch (error) {
      toast.error('Failed to recover meeting', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
      throw error;
    }
  };

  const handleDialogClose = () => {
    setShowRecoveryDialog(false);
    if (recoverableMeetings.length === 0) {
      sessionStorage.removeItem('recovery_dialog_shown');
    }
  };

  const pillBackground = PILL_BACKGROUND_BY_THEME[uiTheme] ?? PILL_BACKGROUND_BY_THEME.rune;
  const pillShadow = PILL_SHADOW_BY_THEME[uiTheme] ?? PILL_SHADOW_BY_THEME.rune;

  // Clean 3D pill body like Logo pill, with light-green (primary) outline retained
  const getHomeButtonStyle = (isHovered: boolean): React.CSSProperties => ({
    backgroundImage: pillBackground,
    backgroundRepeat: 'no-repeat',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1.5px solid ${isHovered ? 'hsl(var(--primary) / 0.95)' : 'hsl(var(--primary) / 0.65)'}`,
    color: 'rgba(255,255,255,0.92)',
    fontWeight: 600,
    letterSpacing: '0.02em',
    boxShadow: isHovered
      ? `${pillShadow}, 0 0 48px hsl(var(--primary) / 0.32), 0 12px 32px rgba(0,0,0,0.35)`
      : `${pillShadow}, 0 0 32px hsl(var(--primary) / 0.18), 0 6px 18px rgba(0,0,0,0.22)`,
    transform: isHovered ? 'translateY(-2px) scale(1.04)' : 'translateY(0) scale(1)',
  } as React.CSSProperties);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col h-screen bg-background text-foreground"
    >
      <SettingsModals modals={modals} messages={messages} onClose={hideModal} />

      <TranscriptRecovery
        isOpen={showRecoveryDialog}
        onClose={handleDialogClose}
        recoverableMeetings={recoverableMeetings}
        onRecover={handleRecovery}
        onDelete={deleteRecoverableMeeting}
        onLoadPreview={loadMeetingTranscripts}
      />

      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-3">
            <Image src="/logo.png" alt="Adamant" width={72} height={72} className="object-contain" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Welcome to Adamant</h1>
          <p className="text-sm text-zinc-400">Your second brain for everyday work.</p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={async () => {
              if (isCreatingMeeting) return;
              setIsCreatingMeeting(true);
              setIsMeetingActive(true);
              Analytics.trackButtonClick('start_new_meeting', 'home_page');
              try {
                const timestamp = new Date().toISOString().replace('T', '_').slice(0, 19).replace(/:/g, '-');
                const meeting = await invoke<{ id: string }>('api_create_meeting', {
                  title: `Meeting ${timestamp}`,
                });
                await refetchMeetings();
                router.push(`/meeting-details?id=${meeting.id}`);
              } catch (err) {
                console.error('Failed to create meeting note:', err);
                setIsMeetingActive(false);
              } finally {
                setIsCreatingMeeting(false);
              }
            }}
            disabled={isCreatingMeeting}
            onMouseEnter={() => setHoverStartBtn(true)}
            onMouseLeave={() => setHoverStartBtn(false)}
            className="min-w-[220px] px-6 py-3 rounded-2xl font-medium text-base transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed"
            style={getHomeButtonStyle(hoverStartBtn)}
          >
            Meet
          </button>

          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/todos')}
              onMouseEnter={() => setHoverTodosBtn(true)}
              onMouseLeave={() => setHoverTodosBtn(false)}
              className="min-w-[150px] px-6 py-3 rounded-2xl font-medium text-base transition-all duration-300"
              style={getHomeButtonStyle(hoverTodosBtn)}
            >
              Tasks
            </button>

            <button
              onClick={() => {
                Analytics.trackButtonClick('open_chat', 'home_page');
                router.push('/memory');
              }}
              onMouseEnter={() => setHoverChatBtn(true)}
              onMouseLeave={() => setHoverChatBtn(false)}
              className="min-w-[150px] px-6 py-3 rounded-2xl font-medium text-base transition-all duration-300"
              style={getHomeButtonStyle(hoverChatBtn)}
            >
              Chat
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
