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
  hideBottomNav,
  footer,
}: OnboardingContainerProps) {
  const { goToStep, goPrevious: ctxGoPrev, goNext: ctxGoNext } = useOnboarding();

  const handlePrevious = useCallback(() => {
    if (onPrevious) onPrevious();
    else ctxGoPrev();
  }, [onPrevious, ctxGoPrev]);

  const handleNext = useCallback(() => {
    if (onNext) onNext();
    else ctxGoNext();
  }, [onNext, ctxGoNext]);

  const handleStepClick = useCallback(
    (s: number) => {
      goToStep(s + stepOffset);
    },
    [goToStep, stepOffset],
  );

  const isWelcome = hideProgress && (!step || step === 1);

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden flex flex-col"
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
          background: 'radial-gradient(ellipse 100% 80% at 50% 40%, transparent 35%, hsl(150 30% 4% / 0.42) 100%)',
        }}
      />

      {isWelcome ? (
        /* ── Welcome: everything centered as a single scrollable block ── */
        <div className={cn('relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar', className)}>
          <div className="min-h-full w-full max-w-2xl mx-auto px-6 py-10 sm:py-12 flex flex-col items-center justify-center">
            <div className="w-full flex flex-col items-center text-center space-y-3">
              <h1 className="text-3xl sm:text-4xl font-semibold text-zinc-100 animate-fade-in-up leading-tight">
                {title}
              </h1>
              {description && (
                <p className="text-sm sm:text-base text-zinc-300/90 max-w-lg mx-auto animate-fade-in-up delay-75 leading-relaxed">
                  {description}
                </p>
              )}
              <div className="w-full flex flex-col items-center pt-6">
                <div className="w-full flex flex-col items-center space-y-6">{children}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── Steps 2-4: structured layout — dots top, title top, scrollable content, footer bottom ── */
        <>
          {/* Top progress dots */}
          {step && !hideProgress && (
            <div className="relative flex-shrink-0 pt-6 pb-3 px-6 flex justify-center max-w-2xl w-full mx-auto">
              <ProgressIndicator current={step} total={totalSteps} onStepClick={handleStepClick} />
            </div>
          )}

          {/* Title area */}
          <div className="relative flex-shrink-0 px-6 pt-2 pb-3 text-center max-w-2xl w-full mx-auto">
            <h1 className="text-2xl sm:text-3xl font-semibold text-zinc-100 animate-fade-in-up leading-tight">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-xs sm:text-sm text-zinc-300/90 max-w-lg mx-auto animate-fade-in-up delay-75 leading-relaxed">
                {description}
              </p>
            )}
          </div>

          {/* Scrollable middle */}
          <div className={cn('relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar', className)}>
            <div className="w-full max-w-2xl mx-auto px-6 py-5 flex flex-col items-center">
              <div className="w-full flex flex-col items-center space-y-5">{children}</div>
            </div>
          </div>

          {/* Fixed footer */}
          <div className="relative flex-shrink-0 border-t border-white/5 bg-[hsl(150_28%_7%_/_0.88)] backdrop-blur-sm">
            {footer && (
              <div className="w-full max-w-2xl mx-auto px-6 pt-4 pb-3 flex justify-center">{footer}</div>
            )}
            {!hideBottomNav && step && step > 1 && (
              <div className="w-full max-w-2xl mx-auto px-6 py-3 flex items-center justify-center gap-4">
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
        </>
      )}
    </div>
  );
}
