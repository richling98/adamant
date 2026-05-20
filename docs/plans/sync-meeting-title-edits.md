# Feature Implementation Plan: Sync Meeting Title Edits Across Sidebar and Meeting View

**Overall Progress:** `100%`

## TLDR
Make meeting title edits propagate consistently in both directions. Main meeting page edits already update the sidebar because `useMeetingData` saves the title and updates sidebar context. Sidebar pencil edits save the title and update sidebar context too, but the open meeting page keeps rendering its own local `meetingTitle` state, so it does not reflect the sidebar change. The fix is to make the meeting details title state sync from the shared sidebar/current-meeting state when the same meeting is renamed externally.

## End Result
When a user renames a meeting from either place:

- Main meeting notes title updates immediately.
- Left sidebar title updates immediately.
- The persisted backend title remains the source of truth after refresh/navigation.
- An in-progress edit in the main page title input is not overwritten unexpectedly.

## Current State

- `frontend/src/hooks/meeting-details/useMeetingData.ts`
  - Owns local `meetingTitle` state for the meeting details page.
  - Main page title edits call `api_save_meeting_title`, update `meetingTitle`, update `meetings`, and call `setCurrentMeeting`.
  - It reads `setCurrentMeeting`, `setMeetings`, and `meetings` from `useSidebar`, but does not read `currentMeeting`.

- `frontend/src/components/Sidebar/index.tsx`
  - Sidebar pencil edits call `api_save_meeting_title`.
  - They update `meetings`.
  - If the edited meeting is active, they call `setCurrentMeeting({ id: meetingId, title: newTitle })`.
  - This updates sidebar-owned state, but the meeting page's local `meetingTitle` does not react to it.

- `frontend/src/app/meeting-details/page-content.tsx`
  - Passes `meetingData.meetingTitle` into `NotesPanel` and `SummaryPanel`.
  - The visible meeting title is therefore controlled by `useMeetingData` local state.

## Critical Decisions

* **Use sidebar context as the cross-component synchronization signal** - The sidebar rename flow already updates `currentMeeting` for the active meeting. `useMeetingData` should subscribe to that same state instead of inventing a second event bus.
* **Only sync when the IDs match** - A title change for a different sidebar item must not affect the currently open meeting page.
* **Do not overwrite active local edits** - If the user is currently editing the main meeting title or has unsaved title changes, defer external synchronization to avoid replacing their typed draft.
* **Keep persistence behavior unchanged** - Both rename paths already call `api_save_meeting_title`; this feature should only fix frontend state propagation, not alter backend APIs.

## Tasks

- [x] 🟩 **Step 1: Wire `useMeetingData` to shared current-meeting state**
  - [x] 🟩 In `frontend/src/hooks/meeting-details/useMeetingData.ts`, destructure `currentMeeting` from `useSidebar()`.
  - [x] 🟩 Add a small effect that watches `currentMeeting?.id`, `currentMeeting?.title`, `meeting.id`, `isEditingTitle`, and `isTitleDirty`.
  - [x] 🟩 If `currentMeeting?.id === meeting.id`, the external title is non-empty, and the user is not actively editing/dirty locally, call `setMeetingTitle(currentMeeting.title)`.

- [x] 🟩 **Step 2: Keep prop-driven meeting changes correct**
  - [x] 🟩 Add or adjust an effect so `meetingTitle` resets from `meeting.title` when navigating to a different meeting ID.
  - [x] 🟩 Avoid syncing `meeting.title` for the same meeting while `isTitleDirty` is true, because `meeting.title` can be stale relative to local edits.

- [x] 🟩 **Step 3: Review sidebar rename flow for active-meeting consistency**
  - [x] 🟩 Confirm `handleEditConfirm` in `frontend/src/components/Sidebar/index.tsx` still calls `setCurrentMeeting` when `currentMeeting?.id === meetingId`.
  - [x] 🟩 Preserve the existing `setMeetings` update with object spread so folder/date metadata stays intact.
  - [x] 🟩 Do not add refetching as the primary sync path; immediate local state should handle the visible update.

- [x] 🟩 **Step 4: Add focused regression coverage where practical**
  - [x] 🟩 If the repo has an existing React hook/component test pattern available, add a focused test for `useMeetingData` syncing `meetingTitle` from `currentMeeting`.
  - [x] 🟩 If no practical frontend test harness exists, document the manual QA steps and rely on TypeScript plus browser verification for this small state-flow fix.

- [x] 🟩 **Step 5: Verify manually in the running app**
  - [x] 🟩 Open a meeting details page.
  - [x] 🟩 Rename the meeting from the sidebar pencil modal and confirm the main notes title updates immediately.
  - [x] 🟩 Rename the same meeting from the main notes title and confirm the sidebar updates immediately.
  - [x] 🟩 Navigate away and back, or refresh the app, and confirm the persisted title remains correct.
  - [x] 🟩 Start editing the main page title, leave it unsaved, then rename from the sidebar only after finishing/canceling the main edit to confirm there is no unexpected overwrite during active typing.

## Risk Notes

- The main risk is overwriting an unsaved title draft in the meeting page. Guarding on `isEditingTitle` and `isTitleDirty` should prevent that.
- `updateMeetingTitle` previously mapped sidebar meetings with `{ id, title }`, which could drop metadata such as `folder_id`. This implementation preserves existing meeting objects with `{ ...m, title: newTitle }`.
- The sidebar has multiple meeting render paths (folders, meeting notes, search, by-date). Because all use the shared `meetings` array/current meeting state, the planned fix should not require changing every row renderer.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
