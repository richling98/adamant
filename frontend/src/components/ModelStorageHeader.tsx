'use client';

import { FolderOpen, RefreshCw } from 'lucide-react';

interface ModelStorageHeaderProps {
  title: string;
  directoryPath: string | null;
  onOpenFolder: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
  totalSizeLabel?: string;
}

function truncateMiddle(path: string, maxLen = 48): string {
  if (path.length <= maxLen) return path;
  const half = Math.floor((maxLen - 3) / 2);
  return path.slice(0, half) + '...' + path.slice(-half);
}

export function ModelStorageHeader({
  title,
  directoryPath,
  onOpenFolder,
  onRefresh,
  isRefreshing,
  totalSizeLabel,
}: ModelStorageHeaderProps) {
  return (
    <div className="space-y-1.5 mb-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h4 className="text-sm font-semibold text-zinc-200 flex-shrink-0">{title}</h4>
          {totalSizeLabel && (
            <span className="text-[11px] text-zinc-500 flex-shrink-0 hidden sm:inline">• {totalSizeLabel}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Refresh (detects manual deletion)"
            className="inline-flex items-center justify-center rounded-md border border-white/10 bg-white/[0.04] p-1.5 text-zinc-400 hover:bg-white/10 hover:text-zinc-100 disabled:opacity-40 transition-colors"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={onOpenFolder}
            title={directoryPath ? `Open: ${directoryPath}` : 'Open models folder'}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-zinc-300 hover:bg-white/10 hover:text-zinc-100 transition-colors"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Open Folder</span>
            <span className="sm:hidden">Folder</span>
          </button>
        </div>
      </div>
      {directoryPath && (
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono overflow-hidden" title={directoryPath}>
          <span className="truncate">{truncateMiddle(directoryPath, 64)}</span>
          {totalSizeLabel && <span className="sm:hidden flex-shrink-0">• {totalSizeLabel}</span>}
        </div>
      )}
    </div>
  );
}
