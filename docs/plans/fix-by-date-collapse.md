# Fix: By Date Group Collapses on Meeting Click

**Overall Progress:** `0%`

## TLDR

Clicking a meeting row in the "By Date" section correctly navigates to the meeting, but the date group the user clicked from collapses. The fix is to stop using `DraggableMeetingRow` in the By Date section — those rows are read-only navigation rows that never need drag support. The draggable machinery (dnd-kit `{...listeners}` on `onPointerDown`) triggers a DndContext state update on every click, causing a sidebar re-render cascade. A plain non-draggable row eliminates the interference entirely.

## End Result

User clicks a meeting inside a By Date group → meeting opens → the date group they clicked from remains expanded, exactly as it was. No collapse, no sidebar flicker. Drag-and-drop for meetings in Folders and Meeting Notes sections is completely unaffected.

## Critical Decisions

* **Inline a simple navigation div instead of extracting a new component** — the By Date rows only need a click handler and active state styling. Inlining avoids adding another component for a one-off use.
* **No changes to `DraggableMeetingRow`** — it works correctly everywhere else (Folders, Meeting Notes). Don't add a `disabled` prop; just don't use it where it isn't needed.
* **No changes to `DndContext`, sensors, or `handleDragEnd`** — drag-and-drop for folder/unfiled meetings is untouched.

---

## Tasks

- [ ] 🟥 **Step 1: Replace `DraggableMeetingRow` in the By Date section with a plain nav row**
  - [ ] 🟥 In `frontend/src/components/Sidebar/index.tsx`, find the By Date `dateMeetings.map()` block (around line 1131). Replace the `<DraggableMeetingRow ... />` usage with a plain `<div>` that has:
    - `onClick={onNavigate}` → `setCurrentMeeting` + `router.push`
    - Active state styling matching the existing pattern: `bg-emerald-500/20 text-emerald-100 font-medium` when `currentMeeting?.id === m.id`, else `hover:bg-white/5 text-foreground/85`
    - The same icon + title layout as `DraggableMeetingRow` (file icon circle + truncated title)
    - No checkbox, no edit/delete buttons, no drag listeners — these rows are navigation-only

- [ ] 🟥 **Step 2: Verify**
  - [ ] 🟥 Open the app, expand the By Date section, expand a date group.
  - [ ] 🟥 Click a meeting inside the group — confirm it navigates correctly AND the date group stays expanded.
  - [ ] 🟥 Confirm drag-and-drop still works in the Folders and Meeting Notes sections (unrelated paths, should be unaffected).

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
