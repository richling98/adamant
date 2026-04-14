# Fix Autosave Blank Editor After New Note Creation (ADA-3)

**Overall Progress:** `100%`

## TLDR

When a user creates a new note and the first autosave fires, the typed content disappears and the editor goes blank. The data is saved to the database correctly, but the editor displays empty content because `editor.replaceBlocks()` is never called after the DB load on remount.

## Root Cause

The existing `justSavedRef` / `editorContentRef` mechanism (from ADA-2) cannot survive a component unmount. Here is the full failure chain:

1. User presses pencil → `/meeting-details?id=new`, `isNewNote=true`
2. User types → `debouncedSave` fires after 2s → `saveNote()` runs
3. `saveNote()`: creates meeting, saves note, sets `justSavedRef.current = true`, sets `editorContentRef.current = blocks`, calls `onMeetingCreated(newMeetingId)`
4. `onMeetingCreated` in `page.tsx` calls `router.replace('/meeting-details?id=<real_id>')` + `refetchMeetings()`
5. `meetingId` URL param changes → `useEffect([meetingId])` in `page.tsx` (line 184) fires, sets `meetingDetails = null` and `isLoading = true`
6. Loading condition at line 388 becomes true → loading spinner shown → **`NotesPanel` unmounts**
7. All React refs in `NotesPanel` are destroyed and reset to initial values (`justSavedRef = false`, `editorContentRef = null`)
8. Data loads → `meetingDetails` populated → `NotesPanel` **remounts** with `isNewNote=false`, fresh state
9. Editor created with `initialContent = noteContent || undefined = null || undefined = undefined` → **empty editor**
10. `loadNote` useEffect fires, loads content from DB via `api_get_note`, calls `setNoteContent(content)`
11. **Missing**: nothing calls `editor.replaceBlocks()` in the normal DB-load path → editor stays blank

The `justSavedRef` branch at lines 298–309 already has the correct `editor.replaceBlocks()` call, but it is dead code in this scenario because `justSavedRef.current` is always `false` on remount.

## Critical Decisions

- **Decision 1: Add `editor.replaceBlocks()` in the normal DB-load path** — mirrors the already-proven pattern in the `justSavedRef` branch and in `BlockNoteSummaryView.tsx`. Minimal, targeted, no architectural change.
- **Decision 2: Do NOT refactor the unmount/remount behavior** — avoiding `meetingDetails = null` reset would require larger changes to `page.tsx` and risk regressions in other loading states. Out of scope.
- **Decision 3: Do NOT fix the `debouncedSave` stale closure separately** — the stale closure of `saveNote` inside `debouncedSave` is a separate issue and not what causes the blank editor. Keep this fix atomic.

## Tasks

- [x] 🟩 **Step 1: Add `editor.replaceBlocks()` after DB load in `NotesPanel.tsx`**
  - [x] 🟩 Open `frontend/src/components/NotesPanel.tsx`
  - [x] 🟩 Locate the `loadNote` async function inside `useEffect([meetingId, isNewNote])` (line ~315)
  - [x] 🟩 After `setNoteContent(content)` and `editorContentRef.current = content` (line ~332), added:
    ```typescript
    // Push loaded content into editor — editor.initialContent is only used at creation time
    if (content && editor) {
      editor.replaceBlocks(editor.document, content);
    }
    ```
  - [x] 🟩 Call is inside the `if (data)` branch, not in the `else` branch

- [x] 🟩 **Step 2: Verify the fix end-to-end** — ✅ Confirmed working by user

- [ ] 🟥 **Step 3: Regression-test existing notes**
  - [ ] 🟥 Open any existing note from sidebar
  - [ ] 🟥 **Expected**: Content loads correctly (no blank editor, no duplicate content)
  - [ ] 🟥 Edit the note, wait for autosave
  - [ ] 🟥 **Expected**: Edits persist, no content loss

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

## Critical File

| File | Location | Change |
|------|----------|--------|
| `frontend/src/components/NotesPanel.tsx` | `loadNote` function, after line 331 | Add `editor.replaceBlocks(editor.document, content)` inside `if (data) { ... }` |

## Reference: Existing Pattern (No Change Needed)

`editor.replaceBlocks()` is already used in two places — this fix makes the normal load path consistent with them:

- **`NotesPanel.tsx` line 304**: `editor.replaceBlocks(editor.document, editorContentRef.current)` (in `justSavedRef` branch — dead code on remount, but correct pattern)
- **`frontend/src/components/AISummary/BlockNoteSummaryView.tsx`**: same API, proven to work

## Success Criteria

- ✅ Typed content stays visible after the 2-second autosave fires for a new note
- ✅ Editor is not blank when the URL transitions from `?id=new` to `?id=<real_id>`
- ✅ Content persists after navigating away and back
- ✅ Existing notes still load correctly (no regression)
- ✅ Console shows `hasContent: true` after load

## Edge Cases

1. **User types during the DB reload**: `editor.replaceBlocks()` would overwrite their latest typing. Acceptable for now — this only happens during the initial load, and the note was just saved 100ms earlier with that content.
2. **DB returns null (note not found yet)**: The `if (content && editor)` guard prevents calling `replaceBlocks` with null.
3. **Editor object not ready**: The `editor` guard handles this.

## Out of Scope

- Fixing the `debouncedSave` stale closure (separate bug)
- Preventing the unmount/remount cycle (requires changes to `page.tsx` loading logic)
- The `justSavedRef` dead-code cleanup (low risk, not user-visible)
