# Plans: silence auto-stop (consolidated)

## Part A — Feature specification (auto-stop on silence)

# Feature Implementation Plan: Auto-Stop Recording on Silence

**Overall Progress:** `50%`

---

## TLDR

When a recording is active and no human voice is detected for a configurable duration (30s / 1min / 2min / 5min), the recording automatically stops — exactly as if the user had clicked "End Recording." The Silero VAD already running in the audio pipeline is used as the sole voice detector (it distinguishes human speech from typing, ambient noise, etc.). A 10-second toast warning precedes the auto-stop. The timeout is configurable (on by default at 1 min) in Settings → Recordings. A Pause button is also added to the meeting notes header so users can freeze the silence timer mid-session.

---

## Critical Decisions

- **VAD as sole voice detector:** Silero VAD is a neural speech model — it natively ignores keyboard typing, background noise, and non-speech audio. No separate energy threshold is needed.
- **Timer starts after first speech:** The silence counter does not begin until at least one VAD speech segment has been detected. This prevents a race condition where starting a recording in a quiet room immediately triggers auto-stop.
- **Pause freezes the timer:** When the user pauses the recording, the accumulated silence counter stops incrementing. It resumes from the same count when they unpause.
- **`silence_timeout_secs: Option<u64>` passed from frontend to Rust:** The frontend reads silence prefs from `preferences.json` (Tauri plugin-store) and passes the resolved timeout to the `start_recording` Tauri command. `None` = disabled; `Some(n)` = enabled with `n` second threshold. This keeps the Rust backend free of any plugin-store dependency for this feature.
- **Monitoring task lives in `recording_commands.rs`:** A dedicated `SILENCE_MONITOR_TASK` global (parallel to `TRANSCRIPTION_TASK`) runs a 1-second polling loop that is spawned after recording starts and aborted when recording stops.
- **Voice activity tracked via `RecordingState`:** Two new atomics are added — `voice_ever_detected: AtomicBool` and `last_voice_activity_ms: AtomicU64` (millis since UNIX epoch). The pipeline updates these when VAD fires. The monitoring task reads them.
- **Pause button is frontend-only wiring:** The Rust `pause_recording` / `resume_recording` commands already exist. Only `TranscriptButtonGroup.tsx` and its call-site in `page-content.tsx` need updating.

---

## End Result

After this feature ships:

- If no human voice is detected for the configured duration (default: 1 minute), the recording automatically stops. A toast warning appears 10 seconds before the cutoff: *"Recording will auto-stop in 10 seconds — no voice detected."* For example: with the default 1-minute threshold, the warning toast appears after 50 seconds of silence, and the recording stops 10 seconds after that (at the 60-second mark).
- Tapping "Keep recording" on the toast (or speaking into the mic) resets the timer.
- In Settings → Recordings, users see a new **"Auto-stop on silence"** toggle (on by default) and a duration selector: 30 seconds, 1 minute, 2 minutes, 5 minutes.
- During an active recording on the meeting notes page, a **Pause** button sits next to the "End Recording" button. Clicking it pauses both the recording and the silence timer. Clicking again resumes both.

---

## Tasks

- [ ] 🟥 **Step 1: Add voice activity tracking to `RecordingState`**
  - [ ] 🟥 Add `last_voice_activity_ms: std::sync::atomic::AtomicU64` field (UNIX millis; `0` = no voice yet) to the `RecordingState` struct in [recording_state.rs](frontend/src-tauri/src/audio/recording_state.rs)
  - [ ] 🟥 Add `voice_ever_detected: AtomicBool` field to `RecordingState`
  - [ ] 🟥 Initialize both fields to `0` / `false` in `RecordingState::new()`
  - [ ] 🟥 Reset both fields to `0` / `false` in `start_recording()` (so each new session starts clean)
  - [ ] 🟥 Add public methods: `update_voice_activity()` (sets `voice_ever_detected = true` and `last_voice_activity_ms = now_unix_millis`), `last_voice_activity_ms() -> u64`, `voice_ever_detected() -> bool`

- [ ] 🟥 **Step 2: Update `AudioPipeline` to mark voice activity on VAD events**
  - [ ] 🟥 In `AudioPipeline::run()` in [pipeline.rs](frontend/src-tauri/src/audio/pipeline.rs), after `vad_processor.process_audio()` returns **non-empty** `speech_segments`, call `self.state.update_voice_activity()`
  - [ ] 🟥 Confirm the call is inside the `Ok(speech_segments)` arm and guarded by `!speech_segments.is_empty()`

- [ ] 🟥 **Step 3: Add `silence_timeout_secs` parameter to all `start_recording` variants**
  - [ ] 🟥 Add `silence_timeout_secs: Option<u64>` param to `start_recording_with_meeting_name()` in [recording_commands.rs](frontend/src-tauri/src/audio/recording_commands.rs)
  - [ ] 🟥 Add same param to `start_recording_with_devices_and_meeting()` in `recording_commands.rs`
  - [ ] 🟥 Update the `start_recording` Tauri command in [lib.rs](frontend/src-tauri/src/lib.rs) to accept and forward `silence_timeout_secs: Option<u64>`
  - [ ] 🟥 Update the `start_recording_with_devices_and_meeting` Tauri command in `lib.rs` similarly

- [ ] 🟥 **Step 4: Implement the silence monitoring task in `recording_commands.rs`**
  - [ ] 🟥 Add `static SILENCE_MONITOR_TASK: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);` global
  - [ ] 🟥 Write `fn spawn_silence_monitor<R: Runtime>(app: AppHandle<R>, state: Arc<RecordingState>, timeout_secs: u64) -> JoinHandle<()>` as a free function in `recording_commands.rs` with this logic:
    - Loop every 1 second; exit immediately if `!IS_RECORDING.load()`
    - Skip tick if `!state.voice_ever_detected()` (haven't heard speech yet)
    - Skip tick if `state.is_paused()` (timer frozen)
    - Compute `silence_elapsed_secs = (now_unix_millis - state.last_voice_activity_ms()) / 1000`
    - At `silence_elapsed_secs >= timeout_secs - 10` (and not yet warned): emit `recording-silence-warning` event with payload `{ seconds_remaining: 10 }`
    - At `silence_elapsed_secs >= timeout_secs`: emit `recording-auto-stopped` event, then call `stop_recording(app.clone(), RecordingArgs { save_path: String::new() }).await` and break
  - [ ] 🟥 After `IS_RECORDING.store(true, ...)` in both `start_recording_with_meeting_name` and `start_recording_with_devices_and_meeting`: if `silence_timeout_secs.is_some()`, spawn the task and store in `SILENCE_MONITOR_TASK`
  - [ ] 🟥 At the top of `stop_recording()`, abort and clear `SILENCE_MONITOR_TASK` (before other cleanup) to prevent the monitor from re-triggering stop

- [ ] 🟥 **Step 5: Add silence auto-stop controls to `RecordingSettings.tsx`**
  - [ ] 🟥 Add `silence_auto_stop_enabled: boolean` state (default `true`) loaded from `preferences.json` key `silence_auto_stop_enabled`
  - [ ] 🟥 Add `silence_auto_stop_duration_secs: number` state (default `60`) loaded from `preferences.json` key `silence_auto_stop_duration_secs`
  - [ ] 🟥 Render a toggle row **"Auto-stop on silence"** (same visual pattern as the existing `Recording Start Notification` toggle) — uses `<Switch>` component
  - [ ] 🟥 Render a duration selector row (visible only when enabled) with four options: 30s, 1 min, 2 min, 5 min — use `<Select>` / `<ToggleGroup>` (match existing UI patterns in the settings page)
  - [ ] 🟥 Persist both values to `preferences.json` on change via `@tauri-apps/plugin-store`

- [ ] 🟥 **Step 6: Pass silence timeout from frontend at recording start**
  - [ ] 🟥 In [page-content.tsx](frontend/src/app/meeting-details/page-content.tsx), locate `handleStartRecordingOnPage` (and trace where `invoke('start_recording', ...)` is ultimately called)
  - [ ] 🟥 Before calling `invoke('start_recording', ...)`, read `silence_auto_stop_enabled` and `silence_auto_stop_duration_secs` from `preferences.json`
  - [ ] 🟥 Pass `silence_timeout_secs: enabled ? duration_secs : null` in the invoke payload
  - [ ] 🟥 Do the same for any other code paths that call `invoke('start_recording', ...)` (search codebase — may also be in `RecordingControls.tsx` or a shared hook)

- [ ] 🟥 **Step 7: Handle auto-stop events in the frontend**
  - [ ] 🟥 In `page-content.tsx`, add a `useEffect` that listens for the `recording-silence-warning` Tauri event and shows a toast: *"No voice detected — recording will auto-stop in 10 seconds"* with a **"Keep Recording"** action button that, when clicked, calls `invoke('reset_silence_timer')` (see Step 7 note below) OR simply emits a voice-detected reset; alternatively keep it simple — the warning is purely informational and the recording stops when the timeout expires regardless
  - [ ] 🟥 Add a listener for the `recording-auto-stopped` event that calls `handleStopRecordingOnPage()` (same handler as the manual stop button) to update frontend state and show toast: *"Recording automatically stopped after silence"*
  - [ ] 🟥 Clean up both listeners in the `useEffect` teardown

  > **Note on "Keep Recording" action:** For simplicity in V1, the warning toast is informational only (no dismiss action). If the user speaks, the Rust monitoring task will see new VAD activity, reset `silence_elapsed`, and continue recording — no frontend interaction needed.

- [ ] 🟥 **Step 8: Add Pause/Resume button to `TranscriptButtonGroup`**
  - [ ] 🟥 Add props to `TranscriptButtonGroupProps` in [TranscriptButtonGroup.tsx](frontend/src/components/MeetingDetails/TranscriptButtonGroup.tsx): `isPaused: boolean`, `onPauseRecording: () => void`, `onResumeRecording: () => void`
  - [ ] 🟥 Render a Pause/Resume `<Button>` (using `<Pause>` / `<Play>` from lucide-react) between the Copy button and End Recording button — visible only when `isRecording === true`
  - [ ] 🟥 Button calls `onPauseRecording()` when active (not paused) and `onResumeRecording()` when paused; disabled during `isStopping`
  - [ ] 🟥 In [page-content.tsx](frontend/src/app/meeting-details/page-content.tsx), use `useRecordingState()` (already imported, provides `isPaused`) and add `handlePauseRecording` / `handleResumeRecording` callbacks that call `invoke('pause_recording')` / `invoke('resume_recording')`
  - [ ] 🟥 Pass all four new props (`isPaused`, `onPauseRecording`, `onResumeRecording`, and the existing wiring) to the `<TranscriptButtonGroup>` render site

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do


---

## Part B — Fix: silence monitor self-abort (implementation)

# Feature Implementation Plan: Fix Silence Auto-Stop

**Overall Progress:** `100%`

## TLDR

The silence auto-stop feature was broken due to one critical bug in `recording_commands.rs`. The monitor task called `stop_recording()` directly with `.await`, which caused the task to abort itself before the recording ever stopped. The self-abort fix has been applied; doc-comment cleanup and a compile check remain.

## Root Cause

**Self-abort (critical):** The silence monitor called `stop_recording()` directly with `.await` from within the monitor task. `stop_recording()` immediately calls `abort()` on the silence monitor's own `JoinHandle`. Since the monitor was suspended at `.await` inside `stop_recording()`, the abort cancelled the monitor task at its first async yield point (`manager.stop_streams_and_force_flush().await`) — before `IS_RECORDING` was ever set to `false`. The recording never stopped.

## End Result

After the fix, when a user starts a recording and has the silence auto-stop enabled:
- The silence timer begins counting only after the user speaks for the first time in the session
- Any subsequent detected speech resets the counter back to zero
- After the configured duration (e.g. 1 minute) of continuous silence following first speech, the user sees a 10-second warning toast, then the recording stops automatically and saves normally
- Pausing the recording freezes the silence counter; resuming resumes counting
- If no speech is ever detected, the recording continues indefinitely (user must stop manually)
- Manual "End Recording" still works exactly as before

## Critical Decisions

* **Keep voice-gate guard** — The `if !state.voice_ever_detected() { continue; }` guard is preserved. The timer only starts after the first VAD-confirmed speech segment. This prevents false triggers on quiet rooms or sessions where the mic never picks up speech.
* **Spawn separate task for stop_recording in monitor** — The monitor spawns `tokio::spawn(stop_recording(...))` and immediately `break`s from its loop, so the monitor task exits cleanly before `stop_recording` runs its `abort()` call on the (now-finished) monitor handle. No self-cancellation.
* **Keep `voice_ever_detected` field in `RecordingState`** — It is set by the pipeline on each `SpeechEnd` event and read by the silence monitor to gate the timer. Both the field and the guard remain in place.

## Tasks

- [x] 🟩 **Step 1: Fix self-abort bug in silence monitor**
  - [x] 🟩 Replace direct `stop_recording(...).await` call inside the monitor loop with `tokio::spawn(async move { stop_recording(...).await })` followed by `break`
  - [x] 🟩 Add explanatory comment describing why the separate spawn is necessary

- [x] 🟩 **Step 2: Restore voice-gate guard**
  - [x] 🟩 Re-add `if !state.voice_ever_detected() { continue; }` to the monitor loop (after pause check)
  - [x] 🟩 Update comment to clarify timer starts only after first speech, not from recording start

- [x] 🟩 **Step 3: Update stale doc comments**
  - [x] 🟩 `start_recording_with_meeting_name` docstring (line 81) already correctly says "starting only after the first speech segment" — no change needed
  - [x] 🟩 `spawn_silence_monitor` docstring (line 531) already correctly says "Does nothing until VAD has confirmed at least one speech segment" — no change needed
  - [x] 🟩 Removed inline comment that incorrectly stated silence counting starts from recording start

- [x] 🟩 **Step 4: Verify clean compilation**
  - [x] 🟩 `cargo check` passes with zero errors (8 pre-existing warnings only)

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
