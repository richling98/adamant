# Feature Implementation Plan: Eager Note Creation on "+" Click

**Overall Progress:** `100%`

---

## TLDR

Replace the current lazy `?id=new` draft flow (which requires user input before the note is persisted) with **eager creation**: clicking "+" on a folder row or the "Meeting Notes" section immediately creates the meeting note in the DB, assigns it to the correct location, refreshes the sidebar, and navigates directly to the new note's real URL (`/meeting-details?id=<uuid>`). The note exists and is saved from the moment the "+" is clicked — no typing or recording required.

---

## End Result

1. User clicks "+" next to a folder → app creates a note titled e.g. `"3-23-26 new note"`, saves it to the DB under that folder, updates the sidebar, and navigates to `/meeting-details?id=<uuid>`.
2. User clicks "+" next to "MEETING NOTES" → same, but unfiled.
3. The note is immediately visible in the sidebar.
4. The user can type in the Notes panel or start a recording exactly as with any existing meeting note.
5. No `?id=new` draft flow is involved — the note has a real DB ID from the first moment.

---

## Critical Decisions

* **Eager creation over draft flow** — The current `?id=new` lazy approach creates notes only on first keypress. Instead, we call `api_create_meeting` immediately on "+" click. This guarantees the note is persisted and visible in the sidebar right away.

* **Title format: `"M-D-YY new note"`** — e.g. `"3-23-26 new note"` (month, day, 2-digit year). Simple, human-readable, consistent with the user's specification.

* **Use `moveMeetingToFolder` from `SidebarProvider` for folder assignment** — Already exported from context; it calls `api_move_meeting_to_folder` AND refreshes folders + meetings atomically. No need for `pendingFolderId` after this change.

* **Navigate to real ID, not `?id=new`** — Since the note is created before navigation, we push `/meeting-details?id=<uuid>` directly. This avoids all same-route navigation issues and stale-state bugs we've been chasing.

* **Show loading state on the "+" button during creation** — The async invoke takes a moment. Disable the button and show a subtle loading indicator to prevent double-clicks and give feedback.

* **`setPendingFolderId` and `setIsMeetingActive` are no longer needed for these entry points** — Remove them from `handleNewMeeting` in `FolderItem.tsx` and from the "Meeting Notes" "+" handler in `index.tsx`.

---

## Tasks

- [x] 🟩 **Step 1: Rewrite `handleNewMeeting` in `FolderItem.tsx` to eagerly create the note**
  - [x] 🟩 Add `import { invoke } from '@tauri-apps/api/core'` to `FolderItem.tsx`
  - [x] 🟩 Replace `setPendingFolderId` and `setIsMeetingActive` in the `useSidebar()` destructure with `moveMeetingToFolder`
  - [x] 🟩 Add `isCreating` local state (bool) for button loading feedback
  - [x] 🟩 Rewrite `handleNewMeeting` as async: build date title → `invoke('api_create_meeting', { title })` → `moveMeetingToFolder(id, folder.id)` (which also refreshes the sidebar) → `router.push('/meeting-details?id=<uuid>')`
  - [x] 🟩 Disable the "+" button while `isCreating` is true

- [x] 🟩 **Step 2: Rewrite the "Meeting Notes" "+" handler in `index.tsx` to eagerly create the note**
  - [x] 🟩 Added `refetchMeetings` to the `useSidebar()` destructure in `index.tsx`
  - [x] 🟩 Add `isCreatingUnfiled` local state (bool) for button loading feedback
  - [x] 🟩 Convert the "Meeting Notes" "+" `onClick` to an `async` handler: build date title → `invoke('api_create_meeting', { title })` → `refetchMeetings()` → `router.push('/meeting-details?id=<uuid>')`
  - [x] 🟩 Disable the "+" button while `isCreatingUnfiled` is true

---

## Helper: Date Title Format

```typescript
// Produces e.g. "3-23-26 new note"
function newNoteTitle(): string {
  const now = new Date();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const yy = String(now.getFullYear()).slice(-2);
  return `${m}-${d}-${yy} new note`;
}
```

---

## Affected Files

- `frontend/src/components/Sidebar/FolderItem.tsx` — Step 1
- `frontend/src/components/Sidebar/index.tsx` — Step 2

---

## Files NOT Changed

- `frontend/src/app/meeting-details/page.tsx` — no change; navigating to a real ID follows the normal existing-meeting load path
- `frontend/src/components/Sidebar/SidebarProvider.tsx` — `moveMeetingToFolder` and `refetchMeetings` already exported; no additions needed

---

## Verification

1. Click "+" next to a folder → sidebar immediately shows a new note titled `"M-D-YY new note"` nested under that folder; page navigates to that note ✓
2. Click "+" next to "MEETING NOTES" → sidebar shows new note unfiled; page navigates to that note ✓
3. Both work correctly whether user is on home page OR an existing meeting page ✓
4. New note is immediately editable (Notes panel) and recordable (Transcript panel) ✓
5. Double-clicking "+" does not create two notes (button disabled during creation) ✓

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
