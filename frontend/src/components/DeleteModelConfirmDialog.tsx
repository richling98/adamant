'use client';

import { AlertTriangle, Trash2 } from 'lucide-react';

interface DeleteModelConfirmDialogProps {
  isOpen: boolean;
  modelName: string;
  modelDisplayName?: string;
  sizeLabel?: string;
  directoryPath?: string | null;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteModelConfirmDialog({
  isOpen,
  modelName,
  modelDisplayName,
  sizeLabel,
  directoryPath,
  isDeleting,
  onCancel,
  onConfirm,
}: DeleteModelConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="mx-4 w-full max-w-md rounded-xl border border-white/10 bg-zinc-900 p-5 shadow-2xl animate-in zoom-in-95">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-zinc-100">Delete model?</h3>
            <p className="mt-1 text-sm text-zinc-300 font-medium">
              {modelDisplayName ?? modelName}
              {sizeLabel ? ` (${sizeLabel})` : ''}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">
              This will permanently remove the model from your local storage
              {directoryPath ? ` at` : ''}. You can re-download it anytime.
            </p>
            {directoryPath && (
              <p className="mt-1 text-[11px] font-mono text-zinc-500 break-all" title={directoryPath}>
                {directoryPath}
              </p>
            )}
            <p className="mt-3 text-xs font-medium text-red-300/80">
              This cannot be undone and may free up significant disk space.
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium text-zinc-300 hover:bg-white/10 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isDeleting ? 'Deleting...' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}
