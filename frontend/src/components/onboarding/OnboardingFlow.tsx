import React, { useEffect } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useOnboardingAmbientAudio } from '@/hooks/useOnboardingAmbientAudio';
import {
  WelcomeStep,
  PermissionsStep,
  DownloadProgressStep,
  SetupOverviewStep,
} from './steps';

interface OnboardingFlowProps {
  onComplete: () => void;
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { currentStep } = useOnboarding();
  const [isMac, setIsMac] = React.useState(false);
  const { isMuted, startAudio, toggleMute } = useOnboardingAmbientAudio();

  // Audio lives here — this component persists across steps, so no cut on navigate
  useEffect(() => {
    // Respect persisted mute
    try {
      if (localStorage.getItem('adamant-onboarding-audio-muted') === 'true') return;
    } catch {}
    startAudio();
    const tryStart = () => startAudio();
    window.addEventListener('click', tryStart, { once: true });
    window.addEventListener('keydown', tryStart, { once: true });
    return () => {
      window.removeEventListener('click', tryStart);
      window.removeEventListener('keydown', tryStart);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
        if (isTauri) {
          const { platform } = await import('@tauri-apps/plugin-os');
          setIsMac(platform() === 'macos');
          return;
        }
      } catch {}
      try {
        setIsMac(typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac'));
      } catch {
        setIsMac(false);
      }
    };
    checkPlatform();
  }, []);

  return (
    <div className="onboarding-flow relative">
      {/* Persistent mute toggle — lives on OnboardingFlow so it never remounts across steps */}
      <button
        type="button"
        onClick={toggleMute}
        aria-label={isMuted ? 'Unmute ambient sound' : 'Mute ambient sound'}
        title={isMuted ? 'Unmute' : 'Mute'}
        className="fixed top-4 right-4 z-[60] w-8 h-8 rounded-full border border-white/15 bg-white/5 backdrop-blur-md flex items-center justify-center text-zinc-300 hover:bg-white/10 hover:text-white hover:border-white/25 transition-all"
      >
        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
      </button>

      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <SetupOverviewStep />}
      {currentStep === 3 && <DownloadProgressStep />}
      {currentStep === 4 && isMac && <PermissionsStep />}
    </div>
  );
}
