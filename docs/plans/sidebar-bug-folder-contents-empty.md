# Bug Fix Plan: Folder Contents Always Empty (Bugs 2 & 3)

**Overall Progress:** `90%`

## TLDR

Folders never show their meetings (bug 2) and drag-and-drop into a folder appears to delete the meeting (bug 3). Both symptoms share one root cause: `folderMeetings` is computed by filtering `filteredSidebarItems` for top-level `type: 'file'` items, but filed meetings are never top-level — they live inside folder items' `children`. The fix is to compute `folderMeetings` directly from the `meetings` array, which has accurate `folder_id` values.

## Root Cause

`buildSidebarItems()` in `SidebarProvider.tsx` returns a flat array of two kinds of items:
1. `type: 'folder'` items — each has a `children` array containing its filed meetings
2. `type: 'file'` items — only **unfiled** meetings (those with `folder_id = null`)

In `Sidebar/index.tsx` lines 787–792, `folderMeetings` is built by filtering `filteredSidebarItems`:

```ts
const folderMeetings = filteredSidebarItems.filter(
  (item) => item.type === 'file' &&
    meetings.find((m) => m.id === item.id)?.folder_id === folder.id
);
```

`filteredSidebarItems` is derived from `sidebarItems` (top-level only). The only `type: 'file'` items at the top level are **unfiled** meetings. Filed meetings are nested inside folder children and are invisible to this filter. Therefore the secondary condition `?.folder_id === folder.id` is never true, `folderMeetings` is always `[]`, and every `FolderItem` renders empty.

The same empty `folderMeetings` explains bug 3: after drag-and-drop, `moveMeetingToFolder` correctly updates the DB and the `meetings` array, but the folder still receives an empty `children` prop and shows nothing.

**File to touch:** `frontend/src/components/Sidebar/index.tsx` (lines 787–815)

## Fix

Replace the broken filter with a direct lookup against the `meetings` array, applying the active search filter manually:

```ts
// Before (broken):
const folderMeetings = filteredSidebarItems.filter(
  (item) => item.type === 'file' &&
    meetings.find((m) => m.id === item.id)?.folder_id === folder.id
);

// After (correct):
const folderMeetings: SidebarItem[] = meetings
  .filter((m) => m.folder_id === folder.id)
  .filter((m) =>
    !searchQuery.trim() ||
    m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    searchResults.some((r) => r.id === m.id)
  )
  .map((m) => ({ id: m.id, title: m.title, type: 'file' as const }));
```

No changes to `SidebarProvider`, `buildSidebarItems`, or any Rust code needed.

## End Result

When this fix is complete:
- Folders correctly show all meetings assigned to them — clicking a folder expands it and reveals its meetings
- Dragging a meeting into a folder causes it to appear under that folder immediately after drop
- Dragging a meeting back to "Meeting Notes" removes it from the folder and shows it as unfiled
- Searching while folders are open filters their contents correctly
- Deleting a folder causes its meetings to reappear in the "Meeting Notes" (unfiled) section

## Tasks

- [x] 🟩 **Step 1: Fix folderMeetings computation**
  - [x] 🟩 In `Sidebar/index.tsx`, replaced `filteredSidebarItems.filter(...)` with a direct filter on `meetings` by `folder_id`, with inline search filtering
  - [x] 🟩 `searchQuery` and `searchResults` were already in scope — no extra plumbing needed

- [ ] 🟥 **Step 2: Verify**
  - [ ] 🟥 Create a folder, drag a meeting into it — folder shows the meeting immediately
  - [ ] 🟥 Expand a folder that already contains meetings — meetings appear in the list
  - [ ] 🟥 Drag a meeting back to "Meeting Notes" — meeting reappears in the unfiled section, disappears from folder
  - [ ] 🟥 Search while folder contains meetings — search filters folder contents correctly
  - [ ] 🟥 Delete a folder — its meetings appear unfiled in "Meeting Notes"

---

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
