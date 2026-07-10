import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Mic, Sparkles, Check, Loader2, Download, ChevronDown } from 'lucide-react';
import { OnboardingContainer } from '../OnboardingContainer';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';

type DownloadStatus = 'waiting' | 'downloading' | 'completed' | 'error';

interface DownloadState {
  status: DownloadStatus;
  progress: number;
  downloadedMb: number;
  totalMb: number;
  speedMbps: number;
  error?: string;
}

// ---- Model catalogs for onboarding selector ----
// Recommendation logic (you asked for speed/quality/size/accuracy balance):
// Parakeet v3 int8 ~670MB, 25 languages, real-time, High accuracy. Fastest.
// Parakeet v2 int8 ~661MB, best English-only accuracy, very fast. Second best but English-only.
// Whisper small ~466MB Good accuracy, medium speed, but weaker than Parakeet.
// Whisper base ~142MB tiny, good but lower accuracy.
// Whisper small-q5_0 ~280MB quantized fast good.
// Recommendation: parakeet-tdt-0.6b-v3-int8 (best overall) for new users.
// Reasoning in code comment below.
type TranscriptionOption = {
  id: string;
  label: string;
  engine: 'parakeet' | 'whisper';
  size: string;
  sizeMb: number;
  tier: string;
};

// Ordered by recommended priority (best first)
const TRANSCRIPTION_OPTIONS: TranscriptionOption[] = [
  // Recommended — best balance of speed, quality, size, accuracy for new users
  { id: 'parakeet-tdt-0.6b-v3-int8', label: 'Parakeet v3 int8 (Recommended)', engine: 'parakeet', size: '~670 MB', sizeMb: 670, tier: 'Best overall • 25 languages • Real-time • High accuracy' },
  { id: 'parakeet-tdt-0.6b-v2-int8', label: 'Parakeet v2 int8', engine: 'parakeet', size: '~661 MB', sizeMb: 661, tier: 'Best English accuracy • Very fast' },
  { id: 'small', label: 'Whisper Small', engine: 'whisper', size: '~466 MB', sizeMb: 466, tier: 'Good accuracy • Medium speed' },
  { id: 'small-q5_0', label: 'Whisper Small Q5_0', engine: 'whisper', size: '~280 MB', sizeMb: 280, tier: 'Quantized • Faster • Good accuracy' },
  { id: 'base', label: 'Whisper Base', engine: 'whisper', size: '~142 MB', sizeMb: 142, tier: 'Very fast • Decent accuracy' },
  { id: 'base-q5_0', label: 'Whisper Base Q5_0', engine: 'whisper', size: '~85 MB', sizeMb: 85, tier: 'Fastest • Low accuracy' },
  { id: 'medium-q5_0', label: 'Whisper Medium Q5_0', engine: 'whisper', size: '~852 MB', sizeMb: 852, tier: 'High accuracy • Medium speed' },
  { id: 'large-v3-turbo', label: 'Whisper Large v3 Turbo', engine: 'whisper', size: '~809 MB', sizeMb: 809, tier: 'Highest accuracy • Medium speed' },
];

const DEFAULT_TRANSCRIPTION_ID = 'parakeet-tdt-0.6b-v3-int8';

type SummaryOption = {
  id: string;
  label: string;
  size: string;
  sizeMb: number;
  desc: string;
  badge?: string;
  recommended?: boolean;
};
const SUMMARY_OPTIONS: SummaryOption[] = [
  {
    id: 'gemma3:1b',
    label: 'Gemma 3 1B',
    size: '~1.0 GB',
    sizeMb: 1019,
    desc: '⚡ Fastest • Quickest download • Any laptop • Good for quick summaries',
    badge: 'Recommended',
    recommended: true,
  },
  {
    id: 'qwen3:1.7b',
    label: 'Qwen3 1.7B',
    size: '~1.2 GB',
    sizeMb: 1223,
    desc: '🧠 Smartest in size • Thinking mode • 119 languages • Apache 2.0 • Best value',
    badge: 'Best Value',
  },
  {
    id: 'deepseek-r1:1.5b',
    label: 'DeepSeek R1 Distill 1.5B',
    size: '~1.1 GB',
    sizeMb: 1065,
    desc: '🔬 Deep reasoning • Chain-of-thought • Best for complex meetings & decisions',
    badge: 'Reasoning',
  },
  {
    id: 'gemma3:4b',
    label: 'Gemma 3 4B',
    size: '~2.4 GB',
    sizeMb: 2374,
    desc: '💎 Highest quality • Most detailed summaries • Needs ~3.5 GB RAM',
    badge: 'Balanced',
  },
];

interface DownloadProgressStepProps {
  footerOverride?: React.ReactNode;
}

export function DownloadProgressStep() {
  const {
    goNext,
    selectedSummaryModel,
    setSelectedSummaryModel,
    parakeetDownloaded,
    setParakeetDownloaded,
    summaryModelDownloaded,
    setSummaryModelDownloaded,
    startBackgroundDownloads,
    completeOnboarding,
  } = useOnboarding();

  const [isMac, setIsMac] = useState(false);

  // User-selectable transcription model
  const [selectedTranscriptionId, setSelectedTranscriptionId] = useState<string>(DEFAULT_TRANSCRIPTION_ID);
  const [showTranscriptionDropdown, setShowTranscriptionDropdown] = useState(false);
  const [showSummaryDropdown, setShowSummaryDropdown] = useState(false);
  const [transcriptionEngine, setTranscriptionEngine] = useState<'parakeet' | 'whisper'>('parakeet');

  const selectedTranscription = useMemo(
    () => TRANSCRIPTION_OPTIONS.find((o) => o.id === selectedTranscriptionId) ?? TRANSCRIPTION_OPTIONS[0],
    [selectedTranscriptionId],
  );

  const selectedSummary = useMemo(
    () => SUMMARY_OPTIONS.find((o) => o.id === selectedSummaryModel) ?? SUMMARY_OPTIONS[0],
    [selectedSummaryModel],
  );

  const [transcriptionDownloadState, setTranscriptionDownloadState] = useState<DownloadState>({
    status: parakeetDownloaded ? 'completed' : 'waiting',
    progress: parakeetDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: selectedTranscription.sizeMb,
    speedMbps: 0,
  });

  const [summaryDownloadState, setSummaryDownloadState] = useState<DownloadState>({
    status: summaryModelDownloaded ? 'completed' : 'waiting',
    progress: summaryModelDownloaded ? 100 : 0,
    downloadedMb: 0,
    totalMb: selectedSummary.sizeMb,
    speedMbps: 0,
  });

  const [isCompleting, setIsCompleting] = useState(false);
  const downloadStartedRef = useRef(false);
  const retryingRef = useRef(false);
  const retryingSummaryRef = useRef(false);
  const transcriptionDropdownRef = useRef<HTMLDivElement>(null);
  const summaryDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (transcriptionDropdownRef.current && !transcriptionDropdownRef.current.contains(e.target as Node)) {
        setShowTranscriptionDropdown(false);
      }
      if (summaryDropdownRef.current && !summaryDropdownRef.current.contains(e.target as Node)) {
        setShowSummaryDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const triggerTranscriptionDownload = useCallback(async () => {
    setTranscriptionDownloadState((p) => ({ ...p, status: 'downloading', error: undefined, progress: 0, downloadedMb: 0, speedMbps: 0 }));
    try {
      if (transcriptionEngine === 'parakeet') {
        await invoke('parakeet_download_model', { modelName: selectedTranscriptionId });
      } else {
        await invoke('whisper_init');
        await invoke('whisper_download_model', { modelName: selectedTranscriptionId });
      }
    } catch (e) {
      setTranscriptionDownloadState((p) => ({ ...p, status: 'error', error: String(e) }));
      toast.error('Transcription download failed');
    }
  }, [selectedTranscriptionId, transcriptionEngine]);

  const triggerSummaryDownload = useCallback(async () => {
    setSummaryDownloadState((p) => ({ ...p, status: 'downloading', error: undefined, progress: 0, downloadedMb: 0, speedMbps: 0 }));
    try {
      await invoke('builtin_ai_download_model', { modelName: selectedSummaryModel });
    } catch (e) {
      setSummaryDownloadState((p) => ({ ...p, status: 'error', error: String(e) }));
      toast.error('Summary model download failed');
    }
  }, [selectedSummaryModel]);

  const handleRetryTranscription = async () => {
    if (retryingRef.current) return;
    retryingRef.current = true;
    setTranscriptionDownloadState((p) => ({ ...p, status: 'waiting', error: undefined, progress: 0, downloadedMb: 0, speedMbps: 0 }));
    try {
      if (transcriptionEngine === 'parakeet') {
        await invoke('parakeet_retry_download', { modelName: selectedTranscriptionId });
      } else {
        await triggerTranscriptionDownload();
      }
    } catch (e) {
      setTranscriptionDownloadState((p) => ({ ...p, status: 'error', error: String(e) }));
      toast.error('Transcription download retry failed');
    } finally {
      setTimeout(() => { retryingRef.current = false; }, 2000);
    }
  };

  const handleRetrySummary = async () => {
    if (retryingSummaryRef.current) return;
    retryingSummaryRef.current = true;
    await triggerSummaryDownload();
    setTimeout(() => { retryingSummaryRef.current = false; }, 2000);
  };

  useEffect(() => {
    const fetchRecommendation = async () => {
      try {
        const model = await invoke<string>('builtin_ai_get_recommended_model');
        setSelectedSummaryModel(model);
      } catch {}
    };
    const checkPlatform = async () => {
      try {
        const isTauri = typeof window !== 'undefined' && '__TAURI__' in (window as unknown as Record<string, unknown>);
        if (isTauri) {
          const { platform } = await import('@tauri-apps/plugin-os');
          setIsMac(platform() === 'macos');
          return;
        }
      } catch {}
      setIsMac(navigator.userAgent.includes('Mac'));
    };
    fetchRecommendation();
    checkPlatform();
  }, [setSelectedSummaryModel]);

  // Do NOT auto-start downloads — user must pick model and press Download.
  // We only check if models already exist on disk (completed state handled by initial state).
  useEffect(() => {
    // No-op: previously auto-downloaded here. Now user-initiated only.
    // Keep ref true to prevent double effects elsewhere if needed.
    downloadStartedRef.current = true;
  }, []);

  // Listen to Parakeet download progress (for any selected parakeet model)
  useEffect(() => {
    const unlistenProgress = listen<{
      modelName: string; progress: number; downloaded_mb?: number; total_mb?: number; speed_mbps?: number; status?: string;
    }>('parakeet-model-download-progress', (event) => {
      const { modelName, progress, downloaded_mb, total_mb, speed_mbps, status } = event.payload;
      // Track selected parakeet model
      if (modelName === selectedTranscriptionId) {
        setTranscriptionDownloadState((prev) => ({
          ...prev,
          status: status === 'completed' ? 'completed' : 'downloading',
          progress, downloadedMb: downloaded_mb ?? prev.downloadedMb,
          totalMb: total_mb ?? prev.totalMb, speedMbps: speed_mbps ?? prev.speedMbps,
        }));
        if (status === 'completed' || progress >= 100) setParakeetDownloaded(true);
      }
    });
    const unlistenComplete = listen<{ modelName: string }>('parakeet-model-download-complete', (event) => {
      if (event.payload.modelName === selectedTranscriptionId) {
        setTranscriptionDownloadState((p) => ({ ...p, status: 'completed' as const, progress: 100 }));
        setParakeetDownloaded(true);
      }
    });
    const unlistenError = listen<{ modelName: string; error: string }>('parakeet-model-download-error', (event) => {
      if (event.payload.modelName === selectedTranscriptionId) {
        setTranscriptionDownloadState((p) => ({ ...p, status: 'error' as const, error: event.payload.error }));
      }
    });
    return () => {
      unlistenProgress.then((fn) => fn());
      unlistenComplete.then((fn) => fn());
      unlistenError.then((fn) => fn());
    };
  }, [selectedTranscriptionId, setParakeetDownloaded]);

  // Whisper download progress — many installations may only use Parakeet, but support both
  useEffect(() => {
    const unlisten = listen<{ modelName: string; progress: number }>('model-download-progress', (event) => {
      if (event.payload.modelName === selectedTranscriptionId) {
        setTranscriptionDownloadState((p) => ({ ...p, status: 'downloading' as const, progress: event.payload.progress }));
        if (event.payload.progress >= 100) setParakeetDownloaded(true);
      }
    });
    const unlistenErr = listen<{ modelName: string; error: string }>('model-download-error', (event) => {
      if (event.payload.modelName === selectedTranscriptionId) {
        setTranscriptionDownloadState((p) => ({ ...p, status: 'error' as const, error: event.payload.error }));
      }
    });
    const unlistenDone = listen<{ modelName: string }>('model-download-complete', (event) => {
      if (event.payload.modelName === selectedTranscriptionId) {
        setTranscriptionDownloadState((p) => ({ ...p, status: 'completed' as const, progress: 100 }));
        setParakeetDownloaded(true);
      }
    });
    return () => {
      unlisten.then((f) => f());
      unlistenErr.then((f) => f());
      unlistenDone.then((f) => f());
    };
  }, [selectedTranscriptionId, setParakeetDownloaded]);

  // Summary progress — handle all summary model ids including qwen3 and deepseek
  const SUMMARY_MODEL_IDS = useMemo(() => ['gemma3:1b', 'gemma3:4b', 'qwen3:1.7b', 'deepseek-r1:1.5b'], []);
  useEffect(() => {
    const unlisten = listen<{
      model: string; progress: number; downloaded_mb?: number; total_mb?: number; speed_mbps?: number; status: string; error?: string;
    }>('builtin-ai-download-progress', (event) => {
      const { model, progress, downloaded_mb, total_mb, speed_mbps, status, error } = event.payload;
      // Always update if it's the currently selected model, or if it's completing (for Ready badge)
      const isRelevant = model === selectedSummaryModel || SUMMARY_MODEL_IDS.includes(model);
      if (!isRelevant) return;
      // Only update the card state if it's the selected model or a background completion
      if (model !== selectedSummaryModel && status !== 'completed') return;
      setSummaryDownloadState((prev) => ({
        ...prev,
        status: status === 'completed' ? 'completed' : status === 'error' ? 'error' : 'downloading',
        progress, downloadedMb: downloaded_mb ?? prev.downloadedMb,
        totalMb: total_mb ?? prev.totalMb, speedMbps: speed_mbps ?? prev.speedMbps,
        error: status === 'error' ? error : undefined,
      }));
      if (status === 'completed' || progress >= 100) setSummaryModelDownloaded(true);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [selectedSummaryModel, setSummaryModelDownloaded, SUMMARY_MODEL_IDS]);

  // Only change selection, don't auto-start download. Download button handles it.
  const handleTranscriptionChange = useCallback((id: string) => {
    const opt = TRANSCRIPTION_OPTIONS.find((o) => o.id === id);
    if (!opt) return;
    setSelectedTranscriptionId(id);
    setTranscriptionEngine(opt.engine);
    setTranscriptionDownloadState({
      status: 'waiting', progress: 0, downloadedMb: 0, totalMb: opt.sizeMb, speedMbps: 0,
    });
    setShowTranscriptionDropdown(false);
  }, []);

  // Only change selection, don't auto-download. User clicks Download button.
  const handleSummaryChange = useCallback((id: string) => {
    setSelectedSummaryModel(id);
    const opt = SUMMARY_OPTIONS.find((o) => o.id === id);
    setSummaryDownloadState({
      status: 'waiting', progress: 0, downloadedMb: 0, totalMb: opt?.sizeMb ?? 1019, speedMbps: 0,
    });
    setShowSummaryDropdown(false);
  }, [setSelectedSummaryModel]);

  const handleContinue = async () => {
    try {
      await invoke('parakeet_init');
      const actuallyAvailable = await invoke<boolean>('parakeet_has_available_models');
      if (actuallyAvailable && (transcriptionDownloadState.status === 'waiting' || transcriptionDownloadState.status === 'error')) {
        setParakeetDownloaded(true);
        setTranscriptionDownloadState((p) => ({ ...p, status: 'completed' as const, progress: 100 }));
      } else if (!actuallyAvailable && transcriptionDownloadState.status === 'error') {
        // If user picked Whisper, check Whisper availability instead
        if (transcriptionEngine === 'whisper') {
          try {
            await invoke('whisper_init');
            const whisperAvail = await invoke<boolean>('whisper_has_available_models');
            if (!whisperAvail) {
              toast.error('Transcription engine required', { description: 'Please retry the download before continuing.' });
              return;
            }
          } catch {}
        } else {
          toast.error('Transcription engine required', { description: 'Please retry the download before continuing.' });
          return;
        }
      }
    } catch (e) { console.warn('verify failed', e); }

    const downloadsComplete = transcriptionDownloadState.status === 'completed' && summaryDownloadState.status === 'completed';
    if (!downloadsComplete) {
      toast.info('Downloads will continue in the background', { description: 'Recording will be available once speech recognition is ready.', duration: 5000 });
    }
    if (isMac) {
      goNext();
    } else {
      setIsCompleting(true);
      try { await completeOnboarding(); await new Promise((r) => setTimeout(r, 100)); window.location.reload(); }
      catch (e) { console.error(e); toast.error('Failed to complete setup'); setIsCompleting(false); }
    }
  };

  const renderModelCard = (
    icon: React.ReactNode,
    title: string,
    selectedLabel: string,
    size: string,
    state: DownloadState,
    dropdownRef: React.RefObject<HTMLDivElement>,
    isDropdownOpen: boolean,
    setDropdownOpen: (v: boolean) => void,
    options: SummaryOption[] | TranscriptionOption[],
    onSelect: (id: string) => void,
    onRetry: () => void,
    onDownload: () => void,
  ) => {
    return (
      <div className="relative rounded-xl border border-white/10 bg-white/[0.06] backdrop-blur-sm p-4 sm:p-5 overflow-visible w-full">
        {/* Status badge — top-right opaque */}
        <div className="absolute -top-3 -right-3 z-20">
          {state.status === 'waiting' && <span className="inline-flex rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-400">Ready to download</span>}
          {state.status === 'downloading' && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[11px] font-medium text-zinc-300">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />Downloading
            </span>
          )}
          {state.status === 'completed' && (
            <span className="inline-flex items-center gap-1 rounded-full border border-lime-400/40 px-2.5 py-1 text-[11px] font-semibold text-lime-950" style={{ background: 'hsl(84 85% 72%)', boxShadow: '0 0 14px hsl(80 80% 55% / 0.45), 0 2px 8px hsl(0 0% 0% / 0.35)' }}>
              <Check className="h-3.5 w-3.5" />Ready
            </span>
          )}
          {state.status === 'error' && <span className="inline-flex rounded-full border border-red-800 bg-red-950 px-2.5 py-1 text-[11px] font-medium text-red-300">Failed</span>}
        </div>

        <div className="flex items-start gap-3 text-left pr-12 sm:pr-16">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5">{icon}</div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-zinc-100 text-left text-sm sm:text-base">{title}</h3>
            <div className="mt-2 relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-left text-sm text-zinc-100 hover:bg-white/10 transition-colors w-full"
              >
                <span className="flex-1 truncate font-medium">{selectedLabel}</span>
                <span className="text-xs text-zinc-400 hidden sm:inline">{size}</span>
                <ChevronDown className={`h-4 w-4 flex-shrink-0 text-zinc-400 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} />
              </button>
              {isDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-xl border border-white/15 bg-zinc-900 shadow-2xl divide-y divide-white/5">
                  {options.map((opt) => {
                    const isSelected = opt.id === (title.includes('Summary') ? selectedSummary.id : selectedTranscription.id);
                    const hasBadge = (opt as any).badge;
                    const tagline = (opt as any).desc ?? (opt as any).tier ?? '';
                    const isRecommended = (opt as any).recommended;
                    return (
                      <button
                        key={opt.id}
                        onClick={() => onSelect(opt.id)}
                        className={`flex w-full flex-col gap-1 px-3.5 py-3 text-left text-sm transition-colors hover:bg-white/[0.07] ${isSelected ? 'bg-white/10' : ''}`}
                      >
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className={`font-medium ${isSelected ? 'text-lime-100' : 'text-zinc-100'}`}>{opt.label}</span>
                          <span className="text-xs text-zinc-500">{opt.size}</span>
                          {hasBadge && (
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${
                                isRecommended
                                  ? 'bg-lime-400/20 text-lime-200 border border-lime-300/30'
                                  : (opt as any).badge === 'Best Value'
                                    ? 'bg-violet-400/15 text-violet-200 border border-violet-300/25'
                                    : (opt as any).badge === 'Reasoning'
                                      ? 'bg-amber-400/15 text-amber-200 border border-amber-300/25'
                                      : 'bg-white/10 text-zinc-300 border border-white/10'
                              }`}
                            >
                              {hasBadge}
                              {isRecommended ? ' ⭐' : ''}
                            </span>
                          )}
                        </span>
                        {tagline && (
                          <span className={`text-xs leading-relaxed ${isSelected ? 'text-zinc-300' : 'text-zinc-500'}`}>
                            {tagline}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {(() => {
              const current = options.find((o) => o.id === (title.includes('Summary') ? selectedSummary.id : selectedTranscription.id));
              const desc = (current as any)?.desc ?? (current as any)?.tier;
              return desc ? <p className="mt-2 text-xs text-zinc-400 leading-relaxed">{desc}</p> : null;
            })()}
          </div>
        </div>

        {/* Waiting: show Download button — user must click to start */}
        {state.status === 'waiting' && (
          <div className="mt-4">
            <button
              onClick={onDownload}
              className="inline-flex items-center gap-2 rounded-lg border border-lime-300/40 bg-lime-400/10 px-4 py-2 text-sm font-medium text-lime-100 hover:bg-lime-400/20 hover:border-lime-300/60 transition-colors"
            >
              <Download className="h-4 w-4" />Download {size}
            </button>
          </div>
        )}

        {state.status === 'downloading' && (
          <div className="mt-4 space-y-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-gradient-to-r from-lime-300 to-lime-100 transition-all duration-300" style={{ width: `${state.progress}%` }} />
            </div>
            <div className="flex items-center justify-between text-xs sm:text-sm text-zinc-400">
              <span>{state.downloadedMb.toFixed(1)} MB / {state.totalMb.toFixed(1)} MB</span>
              <span className="flex items-center gap-2">
                {state.speedMbps > 0 && <span className="text-zinc-500">{state.speedMbps.toFixed(1)} MB/s</span>}
                <span className="font-semibold text-zinc-100">{Math.round(state.progress)}%</span>
              </span>
            </div>
          </div>
        )}
        {state.status === 'error' && state.error && (
          <div className="mt-4 rounded-lg border border-red-900 bg-red-950/60 p-3">
            <p className="text-sm font-medium text-red-300">Download Error</p>
            <p className="mt-1 text-xs text-red-400/80 break-all">{state.error}</p>
            <button onClick={onRetry} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-white">Try Again</button>
          </div>
        )}
      </div>
    );
  };

  const handleSkipForNow = async () => {
    // User wants to skip model selection for now — allow them to proceed
    // Persist that they skipped summary selection so onboarding continues
    // Downloads will continue in background if already started, else they can set up cloud models in settings
    if (isMac) {
      goNext();
    } else {
      setIsCompleting(true);
      try {
        await completeOnboarding();
        await new Promise((r) => setTimeout(r, 100));
        window.location.reload();
      } catch (e) {
        console.error(e);
        toast.error('Failed to complete setup');
        setIsCompleting(false);
      }
    }
  };

  const continueFooter = (
    <div className="w-full max-w-xs flex flex-col items-center gap-3">
      <style>{`@keyframes lime-shine-continue { 0% { transform: translateX(-120%) skewX(-18deg); opacity: 0; } 45% { opacity: 0.85; } 100% { transform: translateX(220%) skewX(-18deg); opacity: 0; } }`}</style>
      <button
        onClick={handleContinue}
        disabled={(transcriptionDownloadState.status !== 'completed' || isCompleting)}
        className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl border-[1.5px] border-lime-300/80 bg-lime-400/10 px-6 py-3 text-sm font-semibold text-lime-100 backdrop-blur-sm transition-all hover:border-lime-200 hover:bg-lime-400/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        style={{ boxShadow: '0 0 0 1px hsl(80 70% 60% / 0.12), 0 0 18px hsl(80 75% 55% / 0.18), inset 0 1px 0 hsl(0 0% 100% / 0.06)' }}
      >
        <span className="relative z-10 flex items-center gap-2">
          {isCompleting || transcriptionDownloadState.status !== 'completed' ? <><Loader2 className="h-4 w-4 animate-spin" />Loading</> : 'Continue'}
        </span>
        <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-[55%] bg-gradient-to-r from-transparent via-lime-100/40 to-transparent group-[&:not(:disabled)]:animate-[lime-shine-continue_2.8s_ease-in-out_infinite]" />
      </button>
      <button
        type="button"
        onClick={handleSkipForNow}
        disabled={isCompleting}
        className="text-sm text-zinc-400 hover:text-lime-200 transition-colors disabled:opacity-40"
      >
        I&apos;ll do this later
      </button>
      <p className="text-[11px] text-zinc-500 text-center leading-relaxed max-w-[280px]">
        Use cloud models or finish downloading later in Settings.
      </p>
    </div>
  );

  // Inline hint shown directly under cards (not as floating bottom-left toast)
  const inlineDownloadHint = parakeetDownloaded && summaryDownloadState.status === 'downloading' ? (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-lg flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-zinc-300"
    >
      <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-zinc-400" />
      <span>Summary download continues in background — you can Continue.</span>
    </motion.div>
  ) : null;

  const footerWithBackground = (
    <div className="flex w-full flex-col items-center gap-3">
      {inlineDownloadHint}
      {continueFooter}
    </div>
  );

  return (
    <OnboardingContainer
      title="Your AI models"
      description="You can start using Adamant after downloading your AI models."
      step={3}
      totalSteps={isMac ? 4 : 3}
      showNavigation
      footer={footerWithBackground}
    >
      <div className="flex flex-col items-center w-full space-y-5">
        <div className="w-full max-w-lg space-y-5">
          {renderModelCard(
            <Mic className="h-5 w-5 text-zinc-300" />,
            'Transcription Engine',
            selectedTranscription.label,
            selectedTranscription.size,
            transcriptionDownloadState,
            transcriptionDropdownRef,
            showTranscriptionDropdown,
            setShowTranscriptionDropdown,
            TRANSCRIPTION_OPTIONS,
            handleTranscriptionChange,
            handleRetryTranscription,
            triggerTranscriptionDownload,
          )}
          {renderModelCard(
            <Sparkles className="h-5 w-5 text-zinc-300" />,
            'Summary Engine',
            selectedSummary.label,
            selectedSummary.size,
            summaryDownloadState,
            summaryDropdownRef,
            showSummaryDropdown,
            setShowSummaryDropdown,
            SUMMARY_OPTIONS as any,
            handleSummaryChange,
            handleRetrySummary,
            triggerSummaryDownload,
          )}
        </div>
      </div>
    </OnboardingContainer>
  );
}
