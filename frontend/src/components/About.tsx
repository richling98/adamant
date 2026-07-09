import React, { useState, useEffect } from "react";
import { getVersion } from '@tauri-apps/api/app';
import Image from 'next/image';
import { toast } from 'sonner';
import { CheckCircle2, Download, Loader2, RefreshCw, Shield, Cpu, CircleDollarSign, Globe } from 'lucide-react';
import { Button } from './ui/button';
import { useUpdateCheckContext } from './UpdateCheckProvider';
import { updateService, UpdateProgress } from '@/services/updateService';

export function About() {
  const { updateInfo, isChecking, hasChecked, checkError, checkForUpdates } = useUpdateCheckContext();
  const [currentVersion, setCurrentVersion] = useState<string>('0.5.2');
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    // Get current version on mount
    getVersion().then(setCurrentVersion).catch(console.error);
  }, []);

  const features = [
    { icon: Shield, title: 'Privacy-first', description: 'Everything stays on your machine. No cloud uploads, no data leaks.' },
    { icon: Cpu, title: 'Local AI models', description: 'Open-source models run entirely on your hardware. You own it.' },
    { icon: CircleDollarSign, title: 'No token costs', description: 'No subscriptions, no API bills. Run it forever for free.' },
    { icon: Globe, title: 'Works everywhere', description: 'Google Meet, Zoom, Teams — online or offline.' },
  ];

  const isUpdateAvailable = Boolean(updateInfo?.available);
  const isInitialCheckPending = !hasChecked && !isChecking && !checkError;
  const buttonLabel = isUpdating
    ? `Updating...${updateProgress?.percentage != null ? ` ${updateProgress.percentage}%` : ''}`
    : checkError
      ? 'Retry update check'
      : isInitialCheckPending || isChecking
        ? 'Checking...'
        : isUpdateAvailable
          ? 'Update and relaunch app'
          : 'No updates!';

  const handleUpdateAction = async () => {
    if (isUpdating || isChecking) {
      return;
    }

    if (checkError) {
      await checkForUpdates(true);
      return;
    }

    if (!isUpdateAvailable) {
      return;
    }

    setIsUpdating(true);
    setUpdateError(null);
    setUpdateProgress({ downloaded: 0, total: 0, percentage: 0 });

    try {
      await updateService.installAvailableUpdate(true, setUpdateProgress);
      toast.success('Update installed successfully. The app will restart...');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download or install update';
      console.error('Failed to install update:', error);
      setUpdateError(message);
      toast.error(`Update failed: ${message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="py-6 space-y-8 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-5">
        <Image
          src="/logo.png"
          alt="Adamant Logo"
          width={52}
          height={52}
          className="object-contain flex-shrink-0"
        />
        <div>
          <p className="text-white font-semibold text-base leading-snug">Real-time notes and summaries<br />that never leave your machine.</p>
          <span className="text-xs text-zinc-500 mt-1 block">v{currentVersion}</span>
        </div>
      </div>

      {/* Update button */}
      <div className="space-y-2">
        <Button
          onClick={handleUpdateAction}
          variant="outline"
          size="sm"
          className="text-xs w-full justify-center"
          disabled={isUpdating || isChecking || (!isUpdateAvailable && !checkError)}
        >
          {isUpdating ? (
            <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
          ) : checkError ? (
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
          ) : isUpdateAvailable ? (
            <Download className="h-3.5 w-3.5 mr-2" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
          )}
          {buttonLabel}
        </Button>

        {isUpdating && updateProgress && (
          <p className="text-xs text-zinc-500 text-center">
            {updateProgress.percentage}% complete
            {updateProgress.total > 0 ? ` · ${formatBytes(updateProgress.downloaded)} / ${formatBytes(updateProgress.total)}` : ''}
          </p>
        )}

        {checkError && (
          <p className="text-xs text-red-400 text-center">
            {checkError}
          </p>
        )}

        {updateError && (
          <p className="text-xs text-red-400 text-center">
            {updateError}
          </p>
        )}
      </div>

      {/* Features list */}
      <div className="space-y-1">
        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">What makes Adamant different</p>
        {features.map(({ icon: Icon, title, description }) => (
          <div key={title} className="flex items-start gap-4 py-3 border-b border-white/5 last:border-0">
            <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-md bg-white/5 flex items-center justify-center">
              <Icon className="w-3.5 h-3.5 text-zinc-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">{title}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}
