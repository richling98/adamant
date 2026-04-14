# Bug Fix Plan: Infinite Meeting Creation Loop on Folder Note Autosave

**Overall Progress:** `100%`

## TLDR

When the user clicks "+" on a folder, opens a new note, and types something, the first autosave correctly creates the meeting and assigns it to the folder. But the app then enters an infinite loop, creating one new meeting after another. Root cause: `debouncedSave` in `NotesPanel` captures `saveNote` from the initial render via a stale closure, so every subsequent save call still sees `isNewNote=true` and `actualMeetingId=null` — and creates another meeting.

## Root Cause

`debouncedSave` is built once using `useRef` and never updated:

```ts
// NotesPanel.tsx lines 196–200
const debouncedSave = useRef(
  debounce((blocks: Block[]) => {
    saveNote(blocks); // <- captures saveNote from INITIAL render only
  }, 2000)
).current;
```

`saveNote` is a `useCallback` that re-creates whenever `isNewNote`, `actualMeetingId`, `meetingId`, `noteVersion`, or `onMeetingCreated` change. But the debounced wrapper never picks up the new version — it always calls the original `saveNote` where `isNewNote=true` and `actualMeetingId=null`.

**The loop step-by-step:**

1. User types → `debouncedSave(blocks)` queued
2. 2 s later: stale `saveNote` fires (`isNewNote=true`, `actualMeetingId=null`) → `api_create_meeting` → new UUID
3. `setActualMeetingId(uuid)` queued, `api_save_note` runs, `onMeetingCreated(uuid)` called
4. `onMeetingCreated` → `router.replace(?id=uuid)` + `refetchMeetings`
5. URL changes → `isNewNote` flips to `false` in `page.tsx` → `NotesPanel` re-renders
6. In the load effect, `editor.replaceBlocks()` restores content — BlockNote fires `onChange`
7. `onChange` → `handleEditorChange` → `debouncedSave(blocks)` (still stale!)
8. 2 s later: stale `saveNote` fires again, `isNewNote=true`, `actualMeetingId=null` → **creates yet another meeting** → go to step 3

**File to touch:** `frontend/src/components/NotesPanel.tsx`

## End Result

When this fix is complete:

- Clicking "+" on a folder, opening a new note, and typing creates **exactly one meeting** on first autosave
- The meeting is assigned to the correct folder
- Subsequent edits to the note save it **in place** (update the same meeting), not create new ones
- Content is preserved across the URL transition from `?id=new` to `?id=<uuid>` with no blank flash
- Cmd+S manual save also works correctly after the first autosave

## Tasks

- [x] 🟩 **Step 1: Fix stale `saveNote` closure in `debouncedSave`**
  - [x] 🟩 Add a `latestSaveNote` ref that always points to the current `saveNote`:
    ```ts
    const latestSaveNote = useRef(saveNote);
    useEffect(() => { latestSaveNote.current = saveNote; }, [saveNote]);
    ```
  - [x] 🟩 Update `debouncedSave` to call `latestSaveNote.current(blocks)` instead of `saveNote(blocks)`:
    ```ts
    const debouncedSave = useRef(
      debounce((blocks: Block[]) => {
        latestSaveNote.current(blocks);
      }, 2000)
    ).current;
    ```
  - [x] 🟩 Place `latestSaveNote` declaration immediately before the `debouncedSave` ref so the ref exists when the debounce is created

- [x] 🟩 **Step 2: Suppress spurious autosave triggered by content restoration**
  - [x] 🟩 Add an `isRestoringContent` ref (`useRef(false)`) to `NotesPanel`
  - [x] 🟩 In the `loadNote` effect (the `justSavedRef.current` branch), set `isRestoringContent.current = true` before calling `editor.replaceBlocks()`, then clear it after a `setTimeout(..., 0)` to cover async `onChange` dispatch
  - [x] 🟩 In `handleEditorChange`, add an early return if `isRestoringContent.current` is true — this prevents `replaceBlocks` from re-triggering a debounced save

- [x] 🟩 **Step 3: Cancel pending debounced saves on meeting creation**
  - [x] 🟩 In `saveNote`, at the point where `onMeetingCreated` is about to be called, call `debouncedSave.cancel()` to flush any in-flight debounce timer before the URL transition changes props
  - [x] 🟩 This prevents a second queued timer from firing with stale state during the re-render window

- [ ] 🟥 **Step 4: Verify**
  - [ ] 🟥 Click "+" on a folder → type text → wait 2s for autosave → exactly ONE new meeting appears under the folder in the sidebar
  - [ ] 🟥 Continue typing in the same note → saves update in place, no new meetings created
  - [ ] 🟥 Sidebar does not flicker or show duplicate entries
  - [ ] 🟥 Cmd+S manual save works correctly at every stage
  - [ ] 🟥 Creating a note via the global "+" (no folder) still works correctly (no regression)

---

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
