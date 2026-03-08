"use client";

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Copy, Mic, Square } from 'lucide-react';
import Analytics from '@/lib/analytics';


interface TranscriptButtonGroupProps {
  transcriptCount: number;
  onCopyTranscript: () => void;
  /** Whether a recording is currently active */
  isRecording: boolean;
  /** Whether the recording stop sequence is in progress (disable button while busy) */
  isStopping: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  className?: string;
}


export function TranscriptButtonGroup({
  transcriptCount,
  onCopyTranscript,
  isRecording,
  isStopping,
  onStartRecording,
  onStopRecording,
  className = '',
}: TranscriptButtonGroupProps) {
  return (
    <div className={className}>
      <ButtonGroup>
        {/* Copy transcript to clipboard */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            Analytics.trackButtonClick('copy_transcript', 'meeting_details');
            onCopyTranscript();
          }}
          disabled={transcriptCount === 0}
          title={transcriptCount === 0 ? 'No transcript available' : 'Copy Transcript'}
        >
          <Copy />
          <span className="hidden lg:inline">Copy</span>
        </Button>

        {/* Record / End Recording — visible when no transcript exists yet, or while
            recording is active (live transcripts must not hide the stop button). */}
        {(transcriptCount === 0 || isRecording) && (
          <Button
            size="sm"
            variant="outline"
            className={
              isRecording
                ? 'bg-red-500 hover:bg-red-600 border-red-400/40 text-white font-semibold'
                : ''
            }
            onClick={() => {
              if (isRecording) {
                Analytics.trackButtonClick('stop_recording', 'meeting_details_transcript_header');
                onStopRecording();
              } else {
                Analytics.trackButtonClick('start_recording', 'meeting_details_transcript_header');
                onStartRecording();
              }
            }}
            disabled={isStopping}
            title={isStopping ? 'Stopping recording…' : isRecording ? 'End recording' : 'Start recording'}
          >
            {isRecording ? (
              <>
                <Square className="lg:mr-2" size={16} fill="currentColor" />
                <span className="hidden lg:inline">End Recording</span>
              </>
            ) : (
              <>
                <Mic className="lg:mr-2" size={16} />
                <span className="hidden lg:inline">Record</span>
              </>
            )}
          </Button>
        )}
      </ButtonGroup>
    </div>
  );
}
