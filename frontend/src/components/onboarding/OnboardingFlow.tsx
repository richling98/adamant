import React, { useEffect } from 'react';
import { useOnboarding } from '@/contexts/OnboardingContext';
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

  useEffect(() => {
    const checkPlatform = async () => {
      // In Next.js dev without Tauri, window.__TAURI__ / OS plugin internals are undefined.
      // Guard against that to avoid crashing the onboarding overlay.
      try {
        // Only attempt Tauri import when actually running inside Tauri webview
        const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;
        if (isTauri) {
          const { platform } = await import('@tauri-apps/plugin-os');
          setIsMac(platform() === 'macos');
          return;
        }
      } catch {
        // fall through to UA fallback
      }
      try {
        setIsMac(typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac'));
      } catch {
        setIsMac(false);
      }
    };
    checkPlatform();
  }, []);

  // 4-Step Onboarding Flow (System-Recommended Models):
  // Step 1: Welcome - Introduce Adamant features
  // Step 2: Setup Overview - Database initialization + show recommended downloads
  // Step 3: Download Progress - Download Parakeet + Gemma (auto-selected based on RAM)
  // Step 4: Permissions - Request mic + system audio (macOS only)

  return (
    <div className="onboarding-flow">
      {currentStep === 1 && <WelcomeStep />}
      {currentStep === 2 && <SetupOverviewStep />}
      {currentStep === 3 && <DownloadProgressStep />}
      {currentStep === 4 && isMac && <PermissionsStep />}
    </div>
  );
}
