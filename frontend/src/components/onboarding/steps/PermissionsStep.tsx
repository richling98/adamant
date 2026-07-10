import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mic, Volume2 } from 'lucide-react';
import { OnboardingContainer } from '../OnboardingContainer';
import { PermissionRow } from '../shared';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function PermissionsStep() {
  const { setPermissionStatus, setPermissionsSkipped, permissions, completeOnboarding } = useOnboarding();
  const [isPending, setIsPending] = useState(false);

  // Check permissions - only logs current state, doesn't auto-authorize
  // Actual permission checks are done via explicit user actions (clicking Enable)
  const checkPermissions = useCallback(async () => {
    console.debug('[PermissionsStep] Current permission states:');
    console.debug(`  - Microphone: ${permissions.microphone}`);
    console.debug(`  - System Audio: ${permissions.systemAudio}`);
    // Don't auto-set permissions based on device availability
    // Permissions should only be set after explicit user action via Enable button
  }, [permissions.microphone, permissions.systemAudio]);

  // Check permissions on mount
  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  // Open System Settings helper — Tauri command requires preferencePane arg
  const openSettings = async (pane: string) => {
    try {
      await invoke('open_system_settings', { preferencePane: pane });
    } catch (e) {
      console.error('[PermissionsStep] open_system_settings failed:', e);
      try {
        const { message } = await import('@tauri-apps/plugin-dialog');
        await message(`Please enable access in System Settings → Privacy & Security → ${pane === 'Privacy_Microphone' ? 'Microphone' : 'Audio Capture'}`, {
          title: 'Permission Required',
          kind: 'info',
        });
      } catch {
        console.debug('[PermissionsStep] Fallback: could not show dialog, check console');
      }
    }
  };

  // Request microphone permission
  const handleMicrophoneAction = async () => {
    if (permissions.microphone === 'denied') {
      await openSettings('Privacy_Microphone');
      return;
    }

    setIsPending(true);
    try {
      console.debug('[PermissionsStep] Triggering microphone permission...');
      const granted = await invoke<boolean>('trigger_microphone_permission');
      console.debug('[PermissionsStep] Microphone permission result:', granted);
      setPermissionStatus('microphone', granted ? 'authorized' : 'denied');
    } catch (err) {
      console.error('[PermissionsStep] Failed to request microphone permission:', err);
      setPermissionStatus('microphone', 'denied');
    } finally {
      setIsPending(false);
    }
  };

  // Request system audio permission
  const handleSystemAudioAction = async () => {
    if (permissions.systemAudio === 'denied') {
      await openSettings('Privacy_AudioCapture');
      return;
    }

    setIsPending(true);
    try {
      console.debug('[PermissionsStep] Triggering Audio Capture permission...');
      const granted = await invoke<boolean>('trigger_system_audio_permission_command');
      console.debug('[PermissionsStep] System audio permission result:', granted);
      setPermissionStatus('systemAudio', granted ? 'authorized' : 'denied');
      if (granted) {
        console.debug('[PermissionsStep] Audio Capture verified — not silence');
      } else {
        console.debug('[PermissionsStep] Audio Capture denied — silence');
      }
    } catch (err) {
      console.error('[PermissionsStep] Failed to request system audio permission:', err);
      setPermissionStatus('systemAudio', 'denied');
    } finally {
      setIsPending(false);
    }
  };

  const handleFinish = async () => {
    try {
      await completeOnboarding();
      window.location.reload();
    } catch (error) {
      console.error('Failed to complete onboarding:', error);
    }
  };

  const handleSkip = async () => {
    setPermissionsSkipped(true);
    await handleFinish();
  };

  const allPermissionsGranted =
    permissions.microphone === 'authorized' &&
    permissions.systemAudio === 'authorized';

  return (
    <OnboardingContainer
      title="Grant Permissions"
      description="Adamant needs access to your microphone and system audio to record meetings"
      step={4}
      hideProgress={false}
      showNavigation
    >
      <div className="max-w-lg mx-auto space-y-6">
        {/* Permission Rows */}
        <div className="space-y-4">
          {/* Microphone */}
          <PermissionRow
            icon={<Mic className="w-5 h-5" />}
            title="Microphone"
            description="Required to capture your voice during meetings"
            status={permissions.microphone}
            isPending={isPending}
            onAction={handleMicrophoneAction}
          />

          {/* System Audio */}
          <PermissionRow
            icon={<Volume2 className="w-5 h-5" />}
            title="System Audio"
            description="Click Enable to grant Audio Capture permission"
            status={permissions.systemAudio}
            isPending={isPending}
            onAction={handleSystemAudioAction}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col items-center gap-3 pt-2">
          <style>{`
            @keyframes lime-shine-finish {
              0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
              45% { opacity: 0.85; }
              100% { transform: translateX(220%) skewX(-18deg); opacity: 0; }
            }
          `}</style>
          <button
            onClick={handleFinish}
            disabled={!allPermissionsGranted}
            className="group relative flex w-full max-w-xs items-center justify-center gap-2 overflow-hidden rounded-xl border-[1.5px] border-lime-300/80 bg-lime-400/10 px-6 py-3 text-sm font-semibold text-lime-100 backdrop-blur-sm transition-all hover:border-lime-200 hover:bg-lime-400/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ boxShadow: '0 0 0 1px hsl(80 70% 60% / 0.12), 0 0 18px hsl(80 75% 55% / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.06)' }}
          >
            <span className="relative z-10">Finish Setup</span>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-lime-100/40 to-transparent group-[&:not(:disabled)]:animate-[lime-shine-finish_2.8s_ease-in-out_infinite]"
            />
          </button>

          <button
            onClick={handleSkip}
            className="text-sm text-zinc-400 transition-colors hover:text-lime-200 hover:brightness-[1.35]"
          >
            I&apos;ll do this later
          </button>

          {!allPermissionsGranted && (
            <p className="max-w-md text-center text-xs text-zinc-500">
              Recording won&apos;t work without permissions. You can grant them later in settings.
            </p>
          )}
        </div>
      </div>
    </OnboardingContainer>
  );
}
