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
          console.log('Skipping recovery check - recording in progress or processing');
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
        <button
          onClick={() => {
            setIsMeetingActive(true);
            Analytics.trackButtonClick('start_new_meeting', 'home_page');
            router.push('/meeting-details?id=new');
          }}
          onMouseEnter={() => setHoverStartBtn(true)}
          onMouseLeave={() => setHoverStartBtn(false)}
          className="px-6 py-3 rounded-2xl font-medium text-base transition-all duration-300"
          style={{
            background: hoverStartBtn ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.07)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: `1px solid ${hoverStartBtn ? 'rgba(34, 197, 94, 0.75)' : 'rgba(34, 197, 94, 0.5)'}`,
            color: hoverStartBtn ? '#86efac' : '#4ade80',
            boxShadow: hoverStartBtn
              ? '0 0 40px rgba(34, 197, 94, 0.22), 0 8px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12)'
              : '0 0 28px rgba(34, 197, 94, 0.1), inset 0 1px 0 rgba(255,255,255,0.08)',
            transform: hoverStartBtn ? 'translateY(-2px) scale(1.03)' : 'translateY(0) scale(1)',
          }}
        >
          Start New Meeting
        </button>
      </div>
    </motion.div>
  );
}
