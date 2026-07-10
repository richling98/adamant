'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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

export default function Home() {
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [hoverStartBtn, setHoverStartBtn] = useState(false);
  const [hoverTodosBtn, setHoverTodosBtn] = useState(false);
  const [hoverChatBtn, setHoverChatBtn] = useState(false);

  const { transcriptModelConfig } = useConfig();
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

  const getHomeButtonStyle = (isHovered: boolean): React.CSSProperties => ({
    background: isHovered
      ? 'hsl(var(--primary) / 0.22)'
      : 'linear-gradient(135deg, hsl(var(--primary) / 0.18) 0%, hsl(var(--primary) / 0.10) 100%)',
    backdropFilter: 'blur(24px)',
    WebkitBackdropFilter: 'blur(24px)',
    border: `1.5px solid ${isHovered ? 'hsl(var(--primary) / 0.95)' : 'hsl(var(--primary) / 0.65)'}`,
    color: isHovered
      ? 'hsl(0 0% 98%)'
      : 'hsl(var(--primary-foreground))',
    fontWeight: 600,
    letterSpacing: '0.02em',
    boxShadow: isHovered
      ? '0 0 48px hsl(var(--primary) / 0.38), 0 0 0 1px hsl(var(--primary) / 0.18), 0 12px 32px rgba(0,0,0,0.28), inset 0 1px 0 hsl(0 0% 100% / 0.18)'
      : '0 0 32px hsl(var(--primary) / 0.20), 0 0 0 1px hsl(var(--primary) / 0.12), 0 6px 18px rgba(0,0,0,0.18), inset 0 1px 0 hsl(0 0% 100% / 0.12)',
    transform: isHovered ? 'translateY(-2px) scale(1.04)' : 'translateY(0) scale(1)',
    textShadow: isHovered ? '0 0 18px hsl(var(--primary) / 0.6)' : '0 1px 2px rgba(0,0,0,0.2)',
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
          <p className="text-sm text-zinc-400">The private and secure AI meeting notetaker.</p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <button
            onClick={() => {
              setIsMeetingActive(true);
              Analytics.trackButtonClick('start_new_meeting', 'home_page');
              router.push('/meeting-details?id=new');
            }}
            onMouseEnter={() => setHoverStartBtn(true)}
            onMouseLeave={() => setHoverStartBtn(false)}
            className="min-w-[220px] px-6 py-3 rounded-2xl font-medium text-base transition-all duration-300"
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
              Actions
            </button>

            <button
              onClick={() => {
                Analytics.trackButtonClick('open_chat', 'home_page');
                window.dispatchEvent(new CustomEvent('open-floating-chat'));
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
