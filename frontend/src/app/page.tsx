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
import Link from 'next/link';
import { getTodosByDate, toggleTodo as apiToggleTodo } from '@/lib/todoApi';
import { localDateKey } from '@/lib/dateKey';
import type { Todo } from '@/types';

export default function Home() {
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [hoverStartBtn, setHoverStartBtn] = useState(false);
  const [todayTodos, setTodayTodos] = useState<Todo[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);

  const { transcriptModelConfig } = useConfig();
  const recordingState = useRecordingState();
  const { status } = recordingState;

  const { setIsMeetingActive, refetchMeetings, todoRefreshVersion, fetchTodoDates } = useSidebar();

  useEffect(() => {
    setTodosLoading(true);
    getTodosByDate(localDateKey()).then(setTodayTodos).finally(() => setTodosLoading(false));
  }, [todoRefreshVersion]);

  const handleTodoToggle = async (id: string, checked: boolean) => {
    setTodayTodos(prev => prev.map(t => t.id === id ? { ...t, is_checked: checked } : t));
    try {
      await apiToggleTodo(id, checked);
      fetchTodoDates();
    } catch (e) {
      setTodayTodos(prev => prev.map(t => t.id === id ? { ...t, is_checked: !checked } : t));
    }
  };
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

        {/* Today's To-Dos quick view */}
        <div className="w-full max-w-md mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-zinc-300">Today&apos;s To-Dos</h2>
            <Link href="/todos" className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors">
              View all →
            </Link>
          </div>

          {todosLoading ? (
            <div className="space-y-2 animate-pulse">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-zinc-800 rounded w-3/4" />
              ))}
            </div>
          ) : todayTodos.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No to-dos for today. Run AI cleanup on a meeting to get started.
            </p>
          ) : (
            <div className="space-y-1.5">
              {todayTodos.slice(0, 5).map((todo) => (
                <div key={todo.id} className="flex items-center gap-2 text-sm group">
                  <input
                    type="checkbox"
                    checked={todo.is_checked}
                    onChange={() => handleTodoToggle(todo.id, !todo.is_checked)}
                    className="accent-emerald-500 cursor-pointer shrink-0"
                  />
                  <span
                    className={`truncate ${
                      todo.is_checked ? "line-through text-zinc-500" : "text-zinc-300"
                    }`}
                  >
                    {todo.content_markdown || todo.source_text || "Untitled"}
                  </span>
                  {todo.meeting_id && (
                    <Link
                      href={`/meeting-details?id=${todo.meeting_id}`}
                      className="text-xs text-zinc-600 hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    >
                      ↗
                    </Link>
                  )}
                </div>
              ))}
              {todayTodos.length > 5 && (
                <p className="text-xs text-zinc-500">+{todayTodos.length - 5} more</p>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
