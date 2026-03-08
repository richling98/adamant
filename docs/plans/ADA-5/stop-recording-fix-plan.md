# ADA-5B: Fix Sidebar "End Recording" to Actually Stop Backend Recording

**Overall Progress:** `92%`

## TLDR

The current sidebar **End Recording** path runs transcript post-processing but does **not** call backend `stop_recording`, so recording continues.

We will make stop behavior source-aware and explicit:

- **UI stop (sidebar button):** call backend `stop_recording` first (with one retry), then run transcript finalization/save.
- **Backend-originated stop (tray/shortcut):** skip backend stop call and run only post-processing.

This guarantees "End Recording" fully stops capture and preserves all transcript content up to that point, while keeping the user on the same meeting page for notes + AI summary.

## Codebase Recon (Current State)

- Sidebar button calls `handleRecordingStop(true)` in `frontend/src/components/Sidebar/index.tsx`.
- `useRecordingStop` currently assumes backend stop already happened ("called by RecordingControls"), which is no longer true for sidebar flow:
  - `frontend/src/hooks/useRecordingStop.ts` comment near stop sequence.
- Backend `recording-stop-complete` event is emitted only from tray paths in `frontend/src-tauri/src/tray.rs`, not from normal frontend `stop_recording` command in `frontend/src-tauri/src/lib.rs`.
- Result: sidebar stop path performs save/wait logic without stopping recorder process.

## Critical Decisions

- **Decision 1:** Make stop API invocation part of `useRecordingStop` for UI-initiated stops.
  - Rationale: one authoritative stop lifecycle owner avoids "UI says stopped, backend still recording" regressions.
- **Decision 2:** Keep source-aware behavior: `ui` vs `backend_event`.
  - Rationale: avoids double-stop when tray already stopped recording.
- **Decision 3:** On backend stop failure, **auto-retry once**.
  - Rationale: improves resilience without hiding failures.
- **Decision 4:** Preserve existing transcript completion/wait/flush/save pipeline and existing-meeting attachment (`pendingMeetingId`).
  - Rationale: keeps desired meeting-first behavior unchanged.

## Public APIs / Interfaces / Types Changes

1. **`useRecordingStop` input contract**
- Current: `handleRecordingStop(callApi: boolean)`
- New:
  - `handleRecordingStop(options?: { source?: 'ui' | 'backend_event'; callApi?: boolean })`
  - Defaults: `{ source: 'ui', callApi: true }`

2. **`window.handleRecordingStop` contract**
- Current: `(callApi?: boolean)`
- New: `(options?: { source?: 'ui' | 'backend_event'; callApi?: boolean })`

3. **Callsite updates**
- Sidebar button call becomes:
  - `handleRecordingStop({ source: 'ui', callApi: true })`
- `RecordingPostProcessingProvider` event call becomes:
  - `handleRecordingStop({ source: 'backend_event', callApi: event.payload })`

## Tasks

- [x] 🟩 **Step 1: Refactor stop lifecycle API to be source-aware**
  - [x] 🟩 Update `useRecordingStop` signature and internal flow to use structured options (`source`, `callApi`).
  - [x] 🟩 Remove/replace stale assumption that backend stop was already performed by `RecordingControls`.
  - [x] 🟩 Keep transcript wait/flush/save steps unchanged after stop confirmation.

- [x] 🟩 **Step 2: Add backend stop execution for UI stop path**
  - [x] 🟩 In `source === 'ui'`, generate save path and call backend `stop_recording` before transcription completion polling.
  - [x] 🟩 Implement one automatic retry if backend stop fails.
  - [x] 🟩 If both attempts fail: set error status, show toast, and avoid entering save flow.

- [x] 🟩 **Step 3: Preserve backend-event post-processing path**
  - [x] 🟩 In `source === 'backend_event'`, skip backend stop call and continue directly to transcript completion/flush/save.
  - [x] 🟩 Keep compatibility with tray `recording-stop-complete` events.

- [x] 🟩 **Step 4: Update callsites**
  - [x] 🟩 Update sidebar button handler in `Sidebar/index.tsx` to pass `{ source: 'ui', callApi: true }`.
  - [x] 🟩 Update `RecordingPostProcessingProvider` listener to pass `{ source: 'backend_event', callApi: event.payload }`.
  - [x] 🟩 Update any remaining legacy callers (`window.handleRecordingStop`, tests/mocks).

- [x] 🟩 **Step 5: Guardrails and UX state correctness**
  - [x] 🟩 Ensure `stopInProgressRef` prevents duplicate stop initiation from rapid clicks.
  - [x] 🟩 Disable end button during active stop sequence (`STOPPING`/`PROCESSING_TRANSCRIPTS`/`SAVING`) to prevent re-entry.
  - [x] 🟩 Ensure final state transitions are coherent (`RECORDING -> STOPPING -> PROCESSING -> SAVING -> IDLE|ERROR`).

- [ ] 🟨 **Step 6: Verification and regression checks**
  - [x] 🟩 Add targeted logging around stop-source, stop attempt count, and backend stop result.
  - [x] 🟩 Run `pnpm tsc --noEmit`.
  - [ ] 🟥 Execute manual E2E validation scenarios (below) and document outcomes.

## Test Cases and Scenarios

1. **Primary bug scenario (must pass)**
- Start recording from sidebar in new meeting.
- Speak for 10-20s; verify live transcript updates.
- Click **End Recording**.
- Expected:
  - backend recording actually stops (no further transcript events),
  - all transcript segments up to click point are finalized/saved,
  - user remains on same meeting page with notes + transcript available.

2. **Retry scenario**
- Simulate first `stop_recording` failure (mock/injected error), second success.
- Expected:
  - one automatic retry,
  - success path continues normally,
  - no duplicate saves.

3. **Hard failure scenario**
- Both stop attempts fail.
- Expected:
  - clear error toast/status,
  - no false "saved successfully" state,
  - recording state reflects backend truth (still active unless backend confirmed stop).

4. **Tray stop compatibility**
- Start recording, stop via tray.
- Expected:
  - `recording-stop-complete` triggers post-processing only,
  - no additional backend stop call from frontend,
  - save and UI updates complete normally.

5. **Existing meeting attachment**
- Start recording on persisted meeting with notes.
- Stop recording via sidebar.
- Expected:
  - `pendingMeetingId` path used,
  - transcript appended to same meeting,
  - no unexpected navigation.

6. **Double-click/end-spam**
- Click End Recording rapidly multiple times.
- Expected:
  - single effective stop flow,
  - no duplicate backend calls/saves.

## Non-Goals

- Re-architecting recording start flow.
- Replacing transcript post-processing algorithm.
- Large backend protocol changes beyond stop-path reliability.

## Assumptions and Defaults

- Existing Rust `stop_recording` command remains authoritative for ending capture.
- Tray still emits `recording-stop-complete`; frontend must support it.
- We keep current meeting-first behavior: stay on current meeting after stop.
- Default failure policy is **auto-retry once** for UI stop command.
- Plan document target path for implementation artifact: `docs/plans/ADA-5/stop-recording-fix-plan.md`.

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
