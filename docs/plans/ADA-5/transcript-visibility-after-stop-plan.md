# Feature Implementation Plan

**Overall Progress:** `95%`

## TLDR
After recording ends, transcripts are saved correctly but do not appear immediately on the current meeting page because transcript data is loaded via `usePaginatedTranscripts` and is only fetched on meeting ID change. Since the meeting ID stays the same, the page keeps stale transcript state until the user navigates away/back.  
Fix: add explicit transcript cache invalidation/reload after successful recording save so the current meeting view refreshes immediately.

## Critical Decisions
* **Decision 1:** Use event-driven refresh (`window` custom event) from recording stop flow to meeting page transcript loader, instead of full page reload/router refresh - preserves UX continuity and avoids unnecessary remounts.
* **Decision 2:** Add a first-class `refetch` API to `usePaginatedTranscripts` and call it on matching meeting update events - reuses existing data-loading logic and minimizes duplicate fetch code.
* **Decision 3:** Emit refresh event only after successful DB save for both existing-meeting and new-meeting save paths - guarantees UI updates are tied to committed data.

## Root Cause Analysis
* `useRecordingStop` saves transcript segments to DB (`storageService.saveMeeting`) and updates sidebar meetings, but does not notify meeting-details transcript query state to reload.
* Meeting details transcript list is sourced from `usePaginatedTranscripts` in `frontend/src/app/meeting-details/page.tsx`.
* `usePaginatedTranscripts` initial load effect is gated by `meetingId` and `loadedMeetingIdRef`, so same-ID updates do not refetch.
* Result: transcript view remains stale until route navigation causes unmount/remount and a new fetch.

## Tasks

- [x] 🟩 **Step 1: Add explicit transcript refetch capability to `usePaginatedTranscripts`**
  - [x] 🟩 Add a `refetch` function that reloads metadata + first transcript page for the current `meetingId`.
  - [x] 🟩 Ensure `refetch` resets pagination state (`offset`, `hasMore`, `error`, loading flags) without requiring meeting ID change.
  - [x] 🟩 Return `refetch` from hook API and update type/interface definitions accordingly.

- [x] 🟩 **Step 2: Wire meeting-details page to refresh transcripts on recording-save event**
  - [x] 🟩 In `meeting-details/page.tsx`, consume new `refetch` from `usePaginatedTranscripts`.
  - [x] 🟩 Add listener for a new custom browser event (e.g., `meeting-transcripts-updated`) and trigger `refetch` when `detail.meetingId` matches current page meeting ID.
  - [x] 🟩 Keep listener lifecycle safe (register/unregister on mount/unmount; guard null/invalid IDs).

- [x] 🟩 **Step 3: Emit transcript-update event from stop flow after successful save**
  - [x] 🟩 In `useRecordingStop`, after successful `saveMeeting`, dispatch `window.dispatchEvent(new CustomEvent('meeting-transcripts-updated', { detail: { meetingId } }))`.
  - [x] 🟩 Emit in both existing-meeting and new-meeting success paths (before optional navigation).
  - [x] 🟩 Add defensive logging for event emission and meeting ID for observability.

- [x] 🟩 **Step 4: Keep existing behaviors stable**
  - [x] 🟩 Preserve pendingMeetingId semantics (recording attaches to active meeting).
  - [x] 🟩 Preserve no-navigation behavior for existing meetings after stop.
  - [x] 🟩 Preserve tray stop + backend event flow compatibility.

- [ ] 🟨 **Step 5: Verification and regression testing**
  - [x] 🟩 Run `pnpm tsc --noEmit`.
  - [ ] 🟥 Manual scenario: Start recording in existing meeting, end recording, verify transcript appears immediately without navigation.
  - [ ] 🟥 Manual scenario: Stop from tray while on same meeting page, verify transcript appears without manual navigation.
  - [ ] 🟥 Manual scenario: New meeting recording stop still behaves correctly and no duplicate transcript entries appear.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.

**Note on `request_user_input` Tool:**
- Use `request_user_input` for each clarification round; it pauses execution until the user responds.
- Ask 1-3 questions per round and continue until all ambiguities are resolved.
