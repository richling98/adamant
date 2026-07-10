import Image from 'next/image';
import { Lock, Sparkles, Cpu } from 'lucide-react';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';

export function WelcomeStep() {
  const { goNext } = useOnboarding();

  const features = [
    { icon: Lock, title: 'Your data never leaves your device' },
    { icon: Sparkles, title: 'Intelligent summaries & insights' },
    { icon: Cpu, title: 'Works offline, no cloud required' },
  ];

  return (
    <OnboardingContainer
      title="Welcome to Adamant"
      description="Record. Summarize. Chat. 100% local."
      step={1}
      hideProgress={true}
    >
      {/* Everything fully centered */}
      <div className="flex w-full flex-col items-center justify-center space-y-8 text-center">
        {/* Logo */}
        <Image src="/logo.png" alt="Adamant" width={140} height={40} className="opacity-90" />

        {/* Features — centered */}
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-sm shadow-lg p-6">
          <div className="flex flex-col items-center space-y-4">
            {features.map((feature, index) => {
              const Icon = feature.icon;
              return (
                <div key={index} className="flex w-full items-center justify-center gap-3 text-center">
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/10">
                    <Icon className="h-3.5 w-3.5 text-emerald-200" />
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-200 text-center">{feature.title}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* CTA — shiny lime-green outlined button matching dark green bg */}
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          <style>{`
            @keyframes lime-shine {
              0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; }
              45% { opacity: 0.9; }
              100% { transform: translateX(220%) skewX(-18deg); opacity: 0; }
            }
          `}</style>
          <button
            onClick={goNext}
            className="group relative w-full overflow-hidden rounded-xl border-[1.5px] border-lime-300/80 bg-lime-400/10 px-6 py-3 text-sm font-semibold tracking-wide text-lime-100 backdrop-blur-sm transition-all duration-200 hover:border-lime-200 hover:bg-lime-400/20 hover:text-white hover:shadow-[0_0_28px_hsl(80_80%_52%_/_0.35),inset_0_1px_0_hsl(0_0%_100%_/_0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-300/50"
            style={{
              boxShadow:
                '0 0 0 1px hsl(80 70% 60% / 0.15), 0 0 18px hsl(80 75% 55% / 0.22), inset 0 1px 0 hsl(0 0% 100% / 0.08)',
            }}
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              Get Started
              <span aria-hidden className="transition-transform group-hover:translate-x-0.5">→</span>
            </span>
            {/* Shine sweep */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-lime-100/45 to-transparent"
              style={{ animation: 'lime-shine 2.8s ease-in-out infinite' }}
            />
          </button>
          <p className="text-xs text-zinc-400/80">Takes less than 3 minutes</p>
        </div>
      </div>
    </OnboardingContainer>
  );
}
