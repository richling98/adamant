import React from 'react';
import { CheckCircle2, Loader2, XCircle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PermissionRowProps } from '@/types/onboarding';

export function PermissionRow({ icon, title, description, status, isPending = false, onAction }: PermissionRowProps) {
  const isAuthorized = status === 'authorized';
  const isDenied = status === 'denied';
  const isChecking = isPending;

  const getButtonText = () => {
    if (isChecking) return 'Checking...';
    if (isDenied) return 'Open Settings';
    return 'Enable';
  };

  return (
    <div
      className={cn(
        'relative flex items-center justify-between rounded-xl border px-5 py-5 transition-all duration-200 overflow-visible',
        // Same subtle green glass as transcription/summary cards
        'border-white/10 bg-white/[0.06] backdrop-blur-sm',
        isAuthorized && 'border-emerald-400/20 bg-emerald-400/[0.08]',
        isDenied && 'border-red-900/60 bg-red-950/30',
      )}
    >
      {/* Left: icon + text — always left-aligned */}
      <div className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-full flex-shrink-0 border',
            isAuthorized
              ? 'border-emerald-400/30 bg-emerald-400/15 text-emerald-100'
              : isDenied
                ? 'border-red-800 bg-red-900/40 text-red-300'
                : 'border-white/10 bg-white/5 text-zinc-300',
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="font-medium text-zinc-100 text-left">{title}</div>
          <div className="text-sm text-zinc-400 text-left">
            {isAuthorized ? (
              <span className="flex items-center gap-1 text-emerald-200">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Access Granted
              </span>
            ) : isDenied ? (
              <span className="flex items-center gap-1 text-red-400">
                <XCircle className="h-3.5 w-3.5" />
                Access Denied — grant in System Settings
              </span>
            ) : (
              <span>{description}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Enable button or check badge */}
      <div className="ml-3 flex items-center gap-2 flex-shrink-0">
        {!isAuthorized && (
          <button
            onClick={onAction}
            disabled={isChecking}
            className={cn(
              'inline-flex min-w-[92px] items-center justify-center gap-1.5 rounded-full border px-4 py-2 text-xs font-semibold transition-all',
              isDenied
                ? 'border-red-400/30 bg-red-950 text-red-200 hover:bg-red-900/50'
                : 'border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10 hover:border-white/25',
              isChecking && 'opacity-70 cursor-wait',
            )}
          >
            {isChecking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {getButtonText()}
          </button>
        )}
        {isAuthorized && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-lime-400/40 px-2.5 py-1 text-[11px] font-semibold text-lime-950"
            style={{
              background: 'hsl(84 85% 72%)',
              boxShadow: '0 0 14px hsl(80 80% 55% / 0.45), 0 2px 8px hsl(0 0% 0% / 0.35)',
            }}
          >
            <Check className="h-3.5 w-3.5" />
            Ready
          </span>
        )}
      </div>
    </div>
  );
}
