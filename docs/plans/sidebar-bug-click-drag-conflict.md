# Bug Fix Plan: Meeting Clicks Show Blue Rectangle Flash (+ Drag Regression)

**Overall Progress:** `90%`

## TLDR

Two related issues:
1. **(Original)** Clicking a meeting row briefly flashes a blue drag-outline before navigating.
2. **(Regression from Step 1 fix)** Restricting `{...listeners}` to the icon div broke drag-and-drop entirely — users try to drag from anywhere on the row, not just the tiny icon.

The correct solution addresses both at once: keep `{...listeners}` on the full row (restoring draggability), but configure dnd-kit's `PointerSensor` with a minimum `distance` constraint so the drag state doesn't activate until the pointer has moved at least 8px. Brief clicks never reach that threshold, so the blue flash is eliminated without sacrificing drag-and-drop.

## Root Cause

**Original bug:** `{...listeners}` on the outer div causes dnd-kit to begin drag-detection on every `pointerdown`, including clicks. The drop zones see a "drag active" signal and briefly render their highlight ring before dnd-kit resets.

**Regression (Step 1):** Moving `{...listeners}` to only the 20×20px icon div means the rest of the row has no drag listener. Users who press-and-drag anywhere other than the icon get no drag at all.

**Correct fix:** Use dnd-kit's built-in `PointerSensor` with `activationConstraint: { distance: 8 }`. This keeps `{...listeners}` on the full row (draggable from anywhere) but dnd-kit only activates drag mode after 8px of pointer movement, so brief clicks are silently ignored and no drop zones are signalled.

**Files to touch:** `frontend/src/components/Sidebar/index.tsx`

## End Result

When this fix is complete:
- Clicking any meeting row in the sidebar navigates directly to that meeting with no visual artifacts — no blue outline, no flash, no delay
- Drag-and-drop works by pressing and moving anywhere on a meeting row (not just the icon)
- Clicking the pencil or trash icon on a meeting row still works normally and does not trigger drag

## Tasks

- [x] 🟩 **Step 1: Restrict listeners to icon (attempted — caused regression)**
  - [x] 🟩 Moved `{...listeners}` to icon div — fixed the flash but broke drag-and-drop entirely
  - Note: this step is superseded by Step 3 below

- [x] 🟩 **Step 2: Revert icon-handle approach**
  - [x] 🟩 In `DraggableMeetingRow`, moved `{...listeners}` back to the outer `<div>`
  - [x] 🟩 Removed `cursor-grab` from the icon wrapper div

- [x] 🟩 **Step 3: Add PointerSensor distance constraint to DndContext**
  - [x] 🟩 Imported `PointerSensor`, `useSensor`, `useSensors` from `@dnd-kit/core`
  - [x] 🟩 Configured `sensors` with `activationConstraint: { distance: 8 }` in `Sidebar` component body
  - [x] 🟩 Passed `sensors={sensors}` to `<DndContext>`

- [ ] 🟥 **Step 4: Verify**
  - [ ] 🟥 Clicking a meeting row navigates without any blue flash
  - [ ] 🟥 Dragging a meeting (from anywhere on the row) moves it into a folder or back to root correctly
  - [ ] 🟥 Clicking edit / delete buttons still works without triggering drag

---

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
