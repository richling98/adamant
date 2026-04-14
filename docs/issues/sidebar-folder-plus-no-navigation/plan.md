# Feature Implementation Plan: Replace "Start Meeting" Button with Inline "+" Entry Points

**Overall Progress:** `100%`

---

## TLDR

Remove the "Start Meeting" button from the sidebar footer (both expanded and collapsed variants) and replace it with two clearly-labelled "+" entry points directly in the sidebar list:

1. **Folder "+"** — already exists on each folder row via `FolderItem`; needs the navigation bug fixed (missing `setIsMeetingActive(true)`)
2. **"Meeting Notes" section "+"** — new button next to the "MEETING NOTES" section header; creates an unfiled note (same as the old "Start Meeting" button, no folder assignment)

This makes the affordance obvious: users see exactly where a new note will land before they click.

---

## End Result

- The sidebar footer no longer has a "Start Meeting" button.
- Hovering over a folder row shows a small "+" icon (unchanged). Clicking it navigates to a new blank note pre-assigned to that folder. **This now works from any page, not just the home page.**
- The "MEETING NOTES" section header has a persistent "+" icon on its right edge (visible on hover of the header row, consistent with the folder row pattern). Clicking it navigates to a new blank unfiled note.
- The collapsed sidebar no longer shows the green Play icon button.
- Behavior is identical whether the user is viewing the home page or an existing meeting.

---

## Critical Decisions

* **Remove both expanded and collapsed "Start Meeting" buttons** — The footer button at lines 1005–1028 (expanded) and lines 619–647 (collapsed) in `index.tsx` are both deleted. Related hover state vars (`hoverExpandedStart`, `hoverCollapsedStart`) are also removed.

* **"Meeting Notes" "+" uses the same pattern as folder "+"** — Small `Plus` icon, visible on hover of the section header row, calls `setIsMeetingActive(true)` then `router.push('/meeting-details?id=new')`. No `setPendingFolderId` call (unfiled note).

* **Fix folder "+" navigation bug in the same pass** — `handleNewMeeting` in `FolderItem.tsx` is missing `setIsMeetingActive(true)`. Add it here so both "+" entry points share the same navigation pattern.

---

## Tasks

- [x] 🟩 **Step 1: Fix folder "+" navigation bug in `FolderItem.tsx`**
  - [x] 🟩 Add `setIsMeetingActive` to the `useSidebar()` destructure on line 37
  - [x] 🟩 In `handleNewMeeting` (line 96), call `setIsMeetingActive(true)` before `router.push('/meeting-details?id=new')`

- [x] 🟩 **Step 2: Remove "Start Meeting" button from expanded sidebar in `index.tsx`**
  - [x] 🟩 Delete the `<button>` block for "Start Meeting" (lines 1005–1028) from the expanded footer
  - [x] 🟩 Remove `hoverExpandedStart` state declaration (line 90) and its `setHoverExpandedStart` calls on the deleted button

- [x] 🟩 **Step 3: Remove "Start Meeting" button from collapsed sidebar in `index.tsx`**
  - [x] 🟩 Delete the collapsed Play icon `<button>` block (lines 619–647) from `renderCollapsedIcons()`
  - [x] 🟩 Remove `hoverCollapsedStart` state declaration (line 88) and its `setHoverCollapsedStart` calls on the deleted button

- [x] 🟩 **Step 4: Add "+" button to the "MEETING NOTES" section header in `index.tsx`**
  - [x] 🟩 Add hover state for the section header row (e.g. `isMeetingNotesHeaderHovered`) so the "+" is revealed on hover, consistent with the folder row pattern
  - [x] 🟩 Change the "MEETING NOTES" header `<div>` (line 924) to use `justify-between` and add `onMouseEnter`/`onMouseLeave` handlers
  - [x] 🟩 Insert a `<button>` with `<Plus className="h-3 w-3" />` on the right side of the header row — shown when hovered, hidden otherwise
  - [x] 🟩 On click: call `setIsMeetingActive(true)` then `router.push('/meeting-details?id=new')` (no `setPendingFolderId` — unfiled note)

---

## Verification

1. Open the app — confirm no "Start Meeting" button appears in the sidebar footer (expanded or collapsed)
2. Hover over a folder → "+" appears → click it from the **home page** → navigates to blank new note, saves under that folder ✓
3. Hover over a folder → "+" appears → click it from an **existing meeting page** → navigates to blank new note, saves under that folder ✓ (the fixed bug)
4. Hover over the "MEETING NOTES" header → "+" appears → click it → navigates to blank new note, saves unfiled ✓
5. Hover over "MEETING NOTES" header from an **existing meeting page** → same result ✓

---

## Critical Files

- `frontend/src/components/Sidebar/FolderItem.tsx` — Step 1 (2 line changes)
- `frontend/src/components/Sidebar/index.tsx` — Steps 2, 3, 4

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
