# Feature Implementation Plan: Preserve My Notes on Transcript Save / Refresh

**Overall Progress:** `80%` (Steps 1–4 complete; Step 5 is manual smoke test)

## TLDR

When a recording stops and transcripts are saved, the UI triggers a full re-mount of `PageContent` (including `NotesPanel`) by showing a loading spinner. This destroys any unsaved in-editor note content and reloads the editor from the database — wiping whatever the user typed within the 2-second autosave debounce window. The fix is to make transcript re-fetches incremental (background) rather than destructive (full re-mount), and to add a flush-on-unmount safety net in `NotesPanel`.

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
5. The pending debounced autosave in `NotesPanel` is silently cancelled (the component is gone). Any content typed in the last ≤ 2 seconds is lost.
6. When the refetch completes, `isLoadingTranscripts` returns to `false`, `PageContent` remounts, and `NotesPanel` fetches fresh content from the DB — without the last few seconds of typing.

### Why `isLoading` is the wrong flag for refetch

`isLoading` in `usePaginatedTranscripts` was designed for the **initial load** (no data yet, must show spinner). Using the same flag for a background **refetch** (data already on screen, just refreshing) is the design flaw. Background refreshes should never tear down the UI.

---

## End Result

After this fix:

- **The user's notes are never wiped by a transcript save.** Whatever they have typed — even content that hasn't yet hit the 2-second autosave — stays in the editor.
- **Transcript refreshes are invisible.** The transcript panel updates in the background; no spinner appears, no panels flash.
- **The editor does not remount** on transcript save, recording stop, or any `onMeetingUpdated` callback.
- **As a safety net**, if `NotesPanel` ever does unmount (e.g. navigating away), the debounced save is flushed synchronously so the last edits reach the DB.

---

## Critical Decisions

- **Add `isRefetching` (not reuse `isLoading`) in `usePaginatedTranscripts`:** `isLoading` must remain `true` only while there is no data and the UI has nothing to show. Background refetches use a separate flag so the loading guard is never triggered.
- **Change the loading guard in `page.tsx` to exclude `isRefetching`:** The spinner condition should only fire on initial load (when `metadata === null`), not on subsequent background refreshes.
- **Flush debounced save on `NotesPanel` unmount:** This is a defensive safeguard for edge cases (navigating away mid-typing). It does not fix the root cause but prevents data loss in any scenario that does cause unmount.
- **No changes to the DB schema or Tauri commands:** The note persistence layer is already correct. This is purely a frontend state/render lifecycle fix.

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

- [ ] 🟥 **Step 5: Manual smoke test**

  - [ ] 🟥 Open a meeting with existing transcripts. Type several words into `My Notes` — do **not** pause for 2 seconds (stay within the debounce window).
  - [ ] 🟥 Trigger a transcript save (start + stop a short recording on the same meeting). Confirm the typed notes are still visible in the editor after the recording stops.
  - [ ] 🟥 Type in notes while a recording is live. Confirm the notes persist after the recording stops and the transcript panel refreshes.
  - [ ] 🟥 Open a brand-new meeting (`?id=new`). Confirm the spinner still appears during the initial load (the loading guard is not broken for first visits).
  - [ ] 🟥 Navigate away from a meeting while typing (before the 2-second autosave fires). Confirm the note is saved to the DB (flush-on-unmount). Navigate back and confirm the content is there.

---

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
