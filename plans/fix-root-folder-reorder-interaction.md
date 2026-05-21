# Feature Implementation Plan

**Overall Progress:** `100%`

**Execution Status:** Implemented. The root folder list now computes insertion from pointer position, renders a real placeholder slot, and uses the existing positioned move API on drop.

## TLDR

The current insertion-zone approach is too fragile: the "between folder" targets are only a few pixels tall and compete with the much larger folder-row droppable targets. That is why only the very top insertion line reliably works, and why dragging an existing root folder above another root folder does not behave like reorder.

Fix this by making root-folder reordering a first-class drag state instead of relying on tiny droppable strips. While a folder is being dragged over the top-level folder list, compute the intended root insertion index from the pointer's Y position relative to the root folder row midpoints. Render a real placeholder gap at that index so folders visibly move out of the way. On drop, call the existing `moveFolderToPosition(folderId, null, index)` command.

## Expected End Result

If this plan is executed correctly, the Folders section will behave like a normal reorderable list:

* A user can drag any top-level folder above or below any other top-level folder.
* As the dragged folder moves through the root list, the list will open a clear slot where the folder will land.
* The folders below that slot will visually shift down, so the interaction feels like the dragged folder is pushing into the list.
* Dropping a top-level folder in that slot persists the new root order.
* A user can drag a nested folder out of its parent and into any root position: first, last, or between two existing parent folders.
* Dropping a nested folder into a root slot makes it a parent/root folder with `parent_id = null` and the chosen `sort_order`.
* Dropping a folder directly on another folder row still means "nest inside that folder."
* Dropping meetings into folders or back into the unfiled meeting area continues to work as it does today.

Concrete examples:

* Root folders are `A, B, C`. Drag `C` above `A`; the UI opens a slot above `A`; drop leaves `C, A, B`.
* Root folders are `A, B, C`; nested folder `D` lives under `A`. Drag `D` between `B` and `C`; the UI opens a slot between `B` and `C`; drop leaves root folders `A, B, D, C`.
* Drag folder `A` directly onto folder `B`; this still nests `A` under `B` rather than reordering it beside `B`.

## Current Diagnosis

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1120) renders `FolderRootInsertDropZone` before and after root folders.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1678) makes those zones only `h-2` unless hovered.
* [FolderItem.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/FolderItem.tsx:80) makes each folder row a full droppable target for nesting.
* Because the insert zones are tiny and folder rows are full-size targets, DnD collision resolution usually selects `folder-target`, not the intended insert target.
* The backend order model added in the previous implementation is still useful and should remain: `sort_order`, `api_move_folder_to_position`, and `moveFolderToPosition` are the right persistence layer.

## Critical Decisions

* **Keep the backend work:** The persisted `sort_order` and positioned move API are the correct foundation.
* **Do not use tiny droppable strips as the primary signal:** They are too hard to hit and lose to larger folder-row targets.
* **Use pointer-position insertion for root list ordering:** The root list should compute insertion index from pointer Y against root row midpoints.
* **Render a real placeholder slot:** The UI should visibly make room at the computed insertion index, not just show a thin line.
* **Keep nesting as a deliberate row drop:** Folder row drops still map to nesting, but root insertion should win when the pointer is in the root list gutter/between-row area.

## Tasks

- [ ] 🟥 **Step 1: Track Root Row Geometry**
  - [ ] 🟥 Add a `rootFolderListRef` around the top-level folder list.
  - [ ] 🟥 Track DOM refs for each rendered top-level folder row, keyed by folder ID.
  - [ ] 🟥 Clear stale refs when root folders change.
  - [ ] 🟥 Keep refs local to `Sidebar/index.tsx`; avoid changing `FolderItem` ownership more than necessary.

- [ ] 🟥 **Step 2: Compute Root Insertion Index From Pointer Position**
  - [ ] 🟥 Add `activeRootInsertIndex` state, initially `null`.
  - [ ] 🟥 On folder drag start, capture the starting pointer Y coordinate.
  - [ ] 🟥 Add `onDragMove` or `onDragOver` handling that computes current pointer Y from the start coordinate plus drag delta.
  - [ ] 🟥 If the pointer is inside the root folder list's vertical region, compare it against root folder row midpoints and derive an insertion index from `0..rootFolders.length`.
  - [ ] 🟥 If the dragged folder is already a root folder, adjust the index to account for removing it from its current position before insertion.
  - [ ] 🟥 Set `activeRootInsertIndex` only for folder drags; leave meeting drags untouched.

- [ ] 🟥 **Step 3: Render a Real Placeholder Gap**
  - [ ] 🟥 Replace always-rendered `FolderRootInsertDropZone` strips with a single visual placeholder rendered at `activeRootInsertIndex`.
  - [ ] 🟥 The placeholder should have enough height to feel like a folder row can land there, likely close to the root folder row height.
  - [ ] 🟥 Style it as a subtle blue insertion slot or ghost row that matches Adamant's sidebar, without adding instructional copy.
  - [ ] 🟥 Ensure the placeholder visually pushes folders below it down.
  - [ ] 🟥 Avoid layout jumps when no folder drag is active.

- [ ] 🟥 **Step 4: Make Drop Resolution Prefer Root Reorder When Appropriate**
  - [ ] 🟥 On drag end, if `activeData.type === 'folder'` and `activeRootInsertIndex !== null`, call `moveFolderToPosition(activeFolderId, null, activeRootInsertIndex)`.
  - [ ] 🟥 This root insertion path should handle both root-folder reorder and nested-folder-to-root promotion.
  - [ ] 🟥 If there is no root insertion index and `overData.type === 'folder-target'`, keep the existing nesting behavior.
  - [ ] 🟥 Reset `activeRootInsertIndex` and pointer refs on drag end/cancel.
  - [ ] 🟥 Keep meeting drop behavior unchanged.

- [ ] 🟥 **Step 5: Improve Ambiguous Hover Behavior**
  - [ ] 🟥 Define a clear root-list hit region so hovering near the left gutter or between rows means reorder.
  - [ ] 🟥 Define a clear folder-row hit region so hovering over the row body means nest.
  - [ ] 🟥 If the current UI makes these regions hard to distinguish, add a root-list reorder gutter on the left side during folder drags.
  - [ ] 🟥 Confirm users can reorder root folders without accidentally nesting them.
  - [ ] 🟥 Confirm users can still intentionally nest one folder inside another.

- [ ] 🟥 **Step 6: Preserve Backend Guarantees**
  - [ ] 🟥 Keep existing Rust tests for `move_folder_to_position`.
  - [ ] 🟥 Add or update a test if an off-by-one bug is found while reordering root folders downward.
  - [ ] 🟥 Keep cycle-prevention tests passing.

- [ ] 🟥 **Step 7: Verify With Real Interaction**
  - [ ] 🟥 Run `pnpm exec tsc --noEmit --pretty false`.
  - [ ] 🟥 Run `cargo test database::repositories::folder::tests`.
  - [ ] 🟥 Run `pnpm run build`.
  - [ ] 🟥 Launch Adamant Dev and manually test:
    - [ ] 🟥 reorder root folder upward,
    - [ ] 🟥 reorder root folder downward,
    - [ ] 🟥 drag nested folder to first root position,
    - [ ] 🟥 drag nested folder between two root folders,
    - [ ] 🟥 drag nested folder to last root position,
    - [ ] 🟥 drag folder onto another folder to nest,
    - [ ] 🟥 drag meetings into folder and back to unfiled.

## Risks and Edge Cases

* **Pointer math:** Need to handle scrolling in the sidebar because row `getBoundingClientRect()` values are viewport-relative.
* **Root folder being dragged:** Reordering a root folder downward needs index adjustment so it does not land one slot too low.
* **Collapsed folders:** Collapsed/expanded state should not affect root ordering except by changing row heights, which the midpoint calculation should naturally handle.
* **Empty root list:** If there are no root folders, dragging a nested folder into the root list should still show one valid landing slot.
* **Nesting vs reordering ambiguity:** The UI must make it clear whether the user is dropping into a folder or between folders.

## Out of Scope

* Reordering nested sibling folders within a parent.
* Reordering meetings.
* Multi-folder drag/reorder.
* Keyboard-accessible folder reordering.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
