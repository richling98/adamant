import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Button } from '@/components/ui/button';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function SetupOverviewStep() {
  const { goNext } = useOnboarding();
  const [isMac, setIsMac] = useState(false);

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
        setIsMac(navigator.userAgent.includes('Mac'));
      } catch {
        setIsMac(false);
      }
    };
    checkPlatform();
  }, []);

  const steps = [
    { number: 1, title: 'Download Transcription Engine' },
    { number: 2, title: 'Download Summarization Engine' },
  ];

  const letsGoFooter = (
    <div className="w-full max-w-xs">
      <Button
        onClick={goNext}
        className="w-full h-11 rounded-xl border-[1.5px] border-lime-300/80 bg-lime-400/10 text-lime-100 hover:border-lime-200 hover:bg-lime-400/20 hover:text-white shadow-[0_0_18px_hsl(80_75%_55%_/_0.22)]"
      >
        Let&apos;s Go
      </Button>
    </div>
  );

  return (
    <OnboardingContainer
      title="Setup Overview"
      description="Adamant requires that you download the Transcription & Summarization AI models for the software to work. We provide fully local LLMs that run comfortably on your local laptop."
      step={2}
      totalSteps={isMac ? 4 : 3}
      showNavigation
      canGoPrevious
      footer={letsGoFooter}
    >
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-sm p-5">
        <div className="space-y-4">
          {steps.map((st) => (
            <div key={st.number} className="flex items-center gap-4 p-1">
              <h3 className="font-medium text-zinc-100">
                Step {st.number}: {st.title}
              </h3>
            </div>
          ))}
        </div>
      </div>
    </OnboardingContainer>
  );
}
