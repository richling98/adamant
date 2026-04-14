'use client';

import { motion } from 'framer-motion';
import { FileQuestion } from 'lucide-react';

interface EmptyStateSummaryProps {
  onGenerate: () => void;
  hasModel: boolean;
  isGenerating?: boolean;
}

export function EmptyStateSummary({ onGenerate, hasModel, isGenerating = false }: EmptyStateSummaryProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-full p-8 text-center"
    >
      <FileQuestion className="w-16 h-16 text-foreground/30 mb-4" />
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No AI Cleanup Yet
      </h3>
      <p className="text-sm text-foreground/60 mb-6 max-w-md">
        Generate an AI cleanup from your transcript and notes to get a complete, cohesive writeup of the meeting.
      </p>

      {!hasModel && (
        <p className="text-xs text-amber-300 mt-3">
          Please select a model in Settings first
        </p>
      )}
    </motion.div>
  );
}
