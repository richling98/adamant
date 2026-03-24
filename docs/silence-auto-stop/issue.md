# Silence auto-stop

**Product:** Auto-stop recording after configurable silence (VAD-based), with warning toast and pause to freeze the timer.

**Bug:** Silence auto-stop could fail to stop the recording because the silence monitor called `stop_recording().await` from its own task, which aborted the monitor before recording state was cleared (self-cancel).

The feature specification and bugfix plan are combined in `plan.md` (two sections).
