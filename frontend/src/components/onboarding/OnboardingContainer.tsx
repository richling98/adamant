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

  return (
    <div
      className="fixed inset-0 flex flex-col z-50 overflow-hidden"
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

      {/* Top progress dots — always top, flex-shrink-0 */}
      {step && !hideProgress && (
        <div className="relative flex-shrink-0 pt-6 pb-3 px-6 flex justify-center max-w-2xl w-full mx-auto">
          <ProgressIndicator current={step} total={totalSteps} onStepClick={handleStepClick} />
        </div>
      )}

      {/* Title area — flex-shrink-0, never overlaps */}
      <div className="relative flex-shrink-0 px-6 pt-2 pb-2 text-center max-w-2xl w-full mx-auto">
        <h1 className="text-3xl sm:text-4xl font-semibold text-zinc-100 animate-fade-in-up leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-2 text-sm sm:text-base text-zinc-300/90 max-w-lg mx-auto animate-fade-in-up delay-75 leading-relaxed">
            {description}
          </p>
        )}
      </div>

      {/* Scrollable middle content — grows, scrolls when window small */}
      <div className={cn('relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden', className)}>
        <div className="w-full max-w-2xl mx-auto px-6 py-6 flex flex-col items-center">
          <div className="w-full flex flex-col items-center space-y-6">{children}</div>
        </div>
      </div>

      {/* Fixed footer — always bottom, contains Continue/footer + bottom nav arrows */}
      <div className="relative flex-shrink-0 border-t border-white/5 bg-[hsl(150_28%_7%_/_0.85)] backdrop-blur-sm">
        {footer && (
          <div className="w-full max-w-2xl mx-auto px-6 pt-4 pb-2 flex justify-center">{footer}</div>
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
    </div>
  );
}
