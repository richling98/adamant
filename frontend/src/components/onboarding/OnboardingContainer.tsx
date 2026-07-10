import React, { useCallback } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressIndicator } from './shared/ProgressIndicator';
import { useOnboarding } from '@/contexts/OnboardingContext';
import type { OnboardingContainerProps } from '@/types/onboarding';

export function OnboardingContainer({
  title,
  description,
  children,
  step,
  totalSteps = 5,
  stepOffset = 0,
  hideProgress = false,
  className,
  showNavigation = false,
  onNext,
  onPrevious,
  canGoNext = true,
  canGoPrevious = true,
}: OnboardingContainerProps) {
  const { goToStep, goPrevious, goNext } = useOnboarding();

  const handlePrevious = useCallback(() => {
    if (onPrevious) onPrevious();
    else goPrevious();
  }, [onPrevious, goPrevious]);

  const handleNext = useCallback(() => {
    if (onNext) onNext();
    else goNext();
  }, [onNext, goNext]);

  const handleStepClick = useCallback(
    (s: number) => {
      goToStep(s + stepOffset);
    },
    [goToStep, stepOffset],
  );

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50 overflow-hidden"
      style={{ background: 'hsl(150 28% 7%)' }}
    >
      {/* Subtle premium depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 90% 65% at 38% 12%, hsl(151 20% 14% / 0.85) 0%, transparent 58%), radial-gradient(ellipse 70% 55% at 82% 88%, hsl(150 16% 9% / 0.6) 0%, transparent 60%), repeating-linear-gradient(90deg, transparent 0px, transparent 2px, hsl(0 0% 100% / 0.018) 2px, hsl(0 0% 100% / 0.018) 2.5px)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 100% 80% at 50% 40%, transparent 35%, hsl(150 30% 4% / 0.42) 100%)',
        }}
      />

      <div className={cn('relative w-full max-w-2xl h-full max-h-screen flex flex-col px-6 py-6', className)}>
        {/* Progress Indicator — dot navigation in header */}
        {step && !hideProgress && (
          <div className="mb-2 relative flex-shrink-0">
            <ProgressIndicator current={step} total={totalSteps} onStepClick={handleStepClick} />
          </div>
        )}

        {/* Header — fully centered */}
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-3 min-h-0">
          <h1 className="text-4xl font-semibold text-zinc-100 animate-fade-in-up">{title}</h1>
          {description && (
            <p className="text-base text-zinc-300/90 max-w-lg mx-auto animate-fade-in-up delay-75 text-center leading-relaxed">
              {description}
            </p>
          )}
          <div className="w-full flex flex-col items-center pt-4">
            <div className="w-full flex flex-col items-center space-y-6">{children}</div>
          </div>
        </div>

        {/* Bottom back/forth arrows — always visible when step is known and > 1, or forward when navigation allowed */}
        {step && step > 1 && (
          <div className="flex-shrink-0 pt-4 flex items-center justify-center gap-4">
            <button
              onClick={handlePrevious}
              aria-label="Go back"
              className="w-10 h-10 rounded-full border border-white/15 bg-white/5 backdrop-blur-sm flex items-center justify-center text-zinc-200 hover:bg-white/10 hover:border-white/25 hover:scale-105 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            {showNavigation && canGoNext && step < totalSteps && (
              <button
                onClick={handleNext}
                aria-label="Go forward"
                className="w-10 h-10 rounded-full border border-white/15 bg-white/5 backdrop-blur-sm flex items-center justify-center text-zinc-200 hover:bg-white/10 hover:border-white/25 hover:scale-105 transition-all"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
