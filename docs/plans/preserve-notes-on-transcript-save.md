# Feature Implementation Plan: Preserve My Notes on Transcript Save / Refresh

**Overall Progress:** `100%`

## TLDR

When a recording stops, transcripts are saved, or AI Cleanup runs, the UI can cross several async boundaries while `My Notes` still has in-editor content that has not reached the database yet. The fix now has layered protection: transcript refetches stay non-destructive, `NotesPanel` exposes an explicit `flushNotes()` method, critical workflows flush notes before continuing, stale note loads are ignored, and the Tauri note API refuses to overwrite existing non-empty notes with an empty payload.

---

## Root Cause

### The exact failure chain

1. Recording stops → `handleStopRecordingOnPage()` fires a `meeting-transcripts-updated` DOM event.
2. `page.tsx` receives that event and calls `refetchTranscripts()` (which is `refetch` from `usePaginatedTranscripts`).
3. Inside `refetch()`, the very first line is **`setIsLoading(true)`**. This sets `isLoadingTranscripts = true` in `page.tsx`.
4. The page's loading guard evaluates:
   ```tsx
   if (!isNewNoteTransition && ((isLoading || (!isNewNote && isLoadingTranscripts)) || !meetingDetails)) {
     return <LoaderIcon ... />;
   }
   ```
   Because `isLoadingTranscripts` is `true`, the spinner is returned — **`PageContent` and `NotesPanel` are unmounted**.
5. The pending debounced autosave in `NotesPanel` is silently cancelled (the component is gone). Any content typed in the last <= 2 seconds is lost.
6. When the refetch completes, `isLoadingTranscripts` returns to `false`, `PageContent` remounts, and `NotesPanel` fetches fresh content from the DB — without the last few seconds of typing.

### Why `isLoading` is the wrong flag for refetch

`isLoading` in `usePaginatedTranscripts` was designed for the **initial load** (no data yet, must show spinner). Using the same flag for a background **refetch** (data already on screen, just refreshing) is the design flaw. Background refreshes should never tear down the UI.

---

## End Result

After this fix:

- **The user's notes are never wiped by a transcript save.** Whatever they have typed — even content that hasn't yet hit the 2-second autosave — stays in the editor.
- **Transcript refreshes are invisible.** The transcript panel updates in the background; no spinner appears, no panels flash.
- **The editor does not remount** on transcript save, recording stop, or any `onMeetingUpdated` callback.
- **Recording and AI Cleanup workflows flush notes first.** Starting a recording after a new-note creation, stopping a recording, and generating AI Cleanup all call the notes flush path before they proceed.
- **As a safety net**, if `NotesPanel` ever does unmount (e.g. navigating away), the debounced save is flushed so the last edits reach the DB.
- **The persistence API rejects destructive empty overwrites.** If a non-empty note already exists, an accidental empty save is ignored rather than replacing user content.

---

## Critical Decisions

- **Add `isRefetching` (not reuse `isLoading`) in `usePaginatedTranscripts`:** `isLoading` must remain `true` only while there is no data and the UI has nothing to show. Background refetches use a separate flag so the loading guard is never triggered.
- **Change the loading guard in `page.tsx` to exclude `isRefetching`:** The spinner condition should only fire on initial load (when `metadata === null`), not on subsequent background refreshes.
- **Expose imperative `flushNotes()` from `NotesPanel`:** Parent workflows can force the editor's current document into persistence before navigation, recording state changes, or AI Cleanup generation.
- **Read from `editor.document` during flush:** The flush path uses the editor's live document rather than only React state, so it captures the newest typed content.
- **Ignore stale note load responses:** If a user navigates between meetings while note loads are in flight, late responses cannot replace the current editor content.
- **Protect the persistence boundary:** `api_save_note` now refuses to overwrite an existing non-empty note with an empty payload, and `api_get_note` returns `content_markdown` for generation flows.

---

## Tasks

- [x] 🟩 **Step 1: Add `isRefetching` state to `usePaginatedTranscripts`**

  **File:** `frontend/src/hooks/usePaginatedTranscripts.ts`

  - [x] 🟩 Added `const [isRefetching, setIsRefetching] = useState(false);` alongside existing state declarations.
  - [x] 🟩 In `refetch()`: replaced `setIsLoading(true)` with `setIsRefetching(true)`. `isLoading` no longer changes during a refetch.
  - [x] 🟩 In `refetch()`'s `finally` block: `setIsRefetching(false)` instead of `setIsLoading(false)`.
  - [x] 🟩 Added `isRefetching` to the `UsePaginatedTranscriptsReturn` interface and return value.

- [x] 🟩 **Step 2: Update the loading guard in `page.tsx` to ignore `isRefetching`**

  **File:** `frontend/src/app/meeting-details/page.tsx`

  - [x] 🟩 Destructured `isRefetching: isRefetchingTranscripts` from `usePaginatedTranscripts`.
  - [x] 🟩 Loading guard now: `isLoadingTranscripts && !isRefetchingTranscripts` — spinner never fires during background refetches.

- [x] 🟩 **Step 3: Flush the debounced save when `NotesPanel` unmounts**

  **File:** `frontend/src/components/NotesPanel.tsx`

  - [x] 🟩 Added `useEffect` cleanup that calls `debouncedSave.flush()` on unmount.

- [x] 🟩 **Step 4: Verify the fix covers all trigger paths**

  - [x] 🟩 `meeting-transcripts-updated` event → `refetchTranscripts()` — non-destructive via Steps 1 & 2.
  - [x] 🟩 `onMeetingUpdated` → `fetchMeetingDetails()` → `refetchTranscripts()` — non-destructive via Steps 1 & 2.
  - [x] 🟩 `fetchMeetingDetails` direct call — non-destructive via Steps 1 & 2.
  - [x] 🟩 `onSummaryUpdated` → `refetchSummaryForMeeting` — does not touch `usePaginatedTranscripts`, no change needed.

- [x] 🟩 **Step 5: Add explicit notes flush boundaries**

  - [x] 🟩 `NotesPanel` exposes `flushNotes()` through a ref.
  - [x] 🟩 Start-recording flow flushes notes after a new note receives its real meeting ID.
  - [x] 🟩 Stop-recording flow flushes notes before transcript save/refresh events continue.
  - [x] 🟩 AI Cleanup flow flushes notes before collecting transcript and notes inputs.

- [x] 🟩 **Step 6: Harden note load/save races**

  - [x] 🟩 Ignore stale note load results when the selected meeting changes.
  - [x] 🟩 Preserve in-editor content when the DB returns no note for the selected meeting.
  - [x] 🟩 Prevent empty saves from overwriting existing non-empty notes in `api_save_note`.
  - [x] 🟩 Return `content_markdown` from `api_get_note` so AI Cleanup uses the persisted Markdown form.

- [x] 🟩 **Step 7: Manual smoke test**

  - [x] 🟩 Start a meeting recording, type in `My Notes`, end recording, generate AI Cleanup, navigate away, return to the original meeting, and confirm typed notes persist.
  - [x] 🟩 User confirmed the reproduced failure case no longer deletes `My Notes`.

---

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
