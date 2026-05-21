# Feature Implementation Plan

**Overall Progress:** `0%`

## TLDR

The current custom drag geometry is unstable because it mutates the same DOM it is measuring, keeps the dragged folder in the measured layout, and lets root reordering compete with folder-row nesting targets. Replace that approach with a proper `@dnd-kit/sortable` root-folder list.

Root folders should be sortable siblings. Nested folders can be dragged into the root sortable list and inserted anywhere. Folder-on-folder drops should remain the explicit way to nest a folder inside another folder.

## Expected End Result

If this plan is executed correctly, the Folders section will have these interactions:

* **Reorder parent folders:** Drag a top-level folder up or down through the top-level folder list. Other parent folders move out of the way smoothly, and dropping persists the new order.
* **Promote nested folders to parent folders:** Drag any nested folder into the top-level folder list. The top-level list opens a real sortable slot at the intended position. Dropping makes that folder a root folder at that position.
* **Choose any root position:** Nested folders can be dropped first, last, or between any two top-level folders.
* **Nest intentionally:** Drag a folder directly onto another folder row to nest it inside that folder.
* **No buzzing:** The dragged item is rendered through a drag overlay or sortable transform model, so the UI does not repeatedly insert/remove a measured placeholder.
* **No hidden top-only behavior:** Moving a nested folder to root should work across the whole root list, not only above the first folder.
* **Meeting behavior unchanged:** Dragging meetings into folders and back to unfiled remains unchanged.

Concrete examples:

* Root folders are `A, B, C`. Drag `C` above `A`; the UI shifts `A` and `B` down; drop persists root order as `C, A, B`.
* Root folders are `A, B, C`; nested folder `D` lives under `A`. Drag `D` between `B` and `C`; the UI opens a slot there; drop persists root order as `A, B, D, C` and `D.parent_id = null`.
* Drag folder `A` directly onto folder `B`; it nests `A` under `B`, rather than reordering beside `B`.

## Current Root Causes To Fix

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1230) inserts a placeholder into the same DOM being measured, causing layout feedback loops.
* [FolderItem.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/FolderItem.tsx:221) keeps the dragged folder in the measured tree, so the moving item is also a target.
* [FolderItem.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/FolderItem.tsx:82) makes every folder a full droppable nesting target, which competes with root reorder intent.
* Root insertion currently depends on narrow row-edge hit zones instead of a sortable list collision model.
* The root list wrapper includes expanded child content, while the insertion math only measures root headers.

## Critical Decisions

* **Use `@dnd-kit/sortable` for root ordering:** The dependency is already installed, and this interaction is exactly what sortable is designed for.
* **Use `DragOverlay`:** The dragged folder should be rendered independently from the measured layout to avoid self-referential layout changes.
* **Separate reorder intent from nesting intent:** Root sortable context handles ordering among root items. Folder-row droppable targets handle nesting.
* **Keep existing backend persistence:** `sort_order`, `api_move_folder_to_position`, and `moveFolderToPosition` remain the persistence layer.
* **Implement root sorting first:** Nested sibling sorting stays out of scope unless explicitly requested.

## Tasks

- [ ] 🟥 **Step 1: Remove the Unstable Custom Geometry**
  - [ ] 🟥 Remove `rootFolderListRef`, `rootFolderRowRefs`, `dragStartClientYRef`, `activeRootInsertIndex`, and `updateRootInsertIndex`.
  - [ ] 🟥 Remove `FolderRootInsertPlaceholder`.
  - [ ] 🟥 Remove `rowRef` from `FolderItem` if nothing else needs it.
  - [ ] 🟥 Remove `onDragMove` root insertion logic.

- [ ] 🟥 **Step 2: Introduce a Root Sortable Context**
  - [ ] 🟥 Import `SortableContext`, `useSortable`, `verticalListSortingStrategy`, and `arrayMove` from `@dnd-kit/sortable`.
  - [ ] 🟥 Wrap the top-level folder render list in `SortableContext` with item IDs from `rootFolders`.
  - [ ] 🟥 Create a `SortableRootFolderItem` wrapper that uses `useSortable` for top-level folders.
  - [ ] 🟥 Keep recursive/nested `FolderItem` rendering unchanged for non-root folders.
  - [ ] 🟥 Use sortable transforms/transition styles for top-level folder motion.

- [ ] 🟥 **Step 3: Add a Stable Drag Overlay**
  - [ ] 🟥 Track `activeFolderId` and derive the dragged folder data from `folders`.
  - [ ] 🟥 Add `DragOverlay` to render a lightweight folder-row preview during folder drags.
  - [ ] 🟥 Ensure the original dragged folder does not visually fight the overlay; use sortable opacity or the existing `isDragging` style.
  - [ ] 🟥 Keep overlay styling consistent with sidebar folder rows.

- [ ] 🟥 **Step 4: Resolve Drop Intent Correctly**
  - [ ] 🟥 In `handleDragEnd`, if a folder is dropped over a root sortable item, compute the target root index.
  - [ ] 🟥 If the dragged folder is already root, reorder it among root folders.
  - [ ] 🟥 If the dragged folder is nested, call `moveFolderToPosition(folderId, null, targetIndex)` to promote it to root.
  - [ ] 🟥 If a folder is dropped over a non-sort nesting target, call `moveFolder(folderId, targetFolderId)`.
  - [ ] 🟥 Prevent no-op drops from making backend calls.

- [ ] 🟥 **Step 5: Avoid Sort/Nest Collision**
  - [ ] 🟥 Give root sortable items distinct IDs, e.g. `root-folder-sort:${folder.id}`.
  - [ ] 🟥 Keep folder nesting targets as `folder-target:${folder.id}`.
  - [ ] 🟥 In drag-end logic, distinguish `root-folder-sort-target` from `folder-target`.
  - [ ] 🟥 Decide whether dropping over the middle of a root folder should reorder before/after it or nest into it. Recommended: while dragging folders in the root list, root sortable wins; nesting still works by dropping onto nested folder rows or using a clear row affordance.
  - [ ] 🟥 If nesting into root folders becomes hard, add a dedicated “drop into folder” hover affordance later, but do not mix it into this fix.

- [ ] 🟥 **Step 6: Preserve Meeting DnD**
  - [ ] 🟥 Keep `DraggableMeetingRow` and `UnfiledDropZone` behavior unchanged.
  - [ ] 🟥 Ensure meeting drops over folder targets still call `moveMeetingToFolder`.
  - [ ] 🟥 Ensure meeting drops over unfiled root still call `moveMeetingToFolder(meetingId, null)`.

- [ ] 🟥 **Step 7: Backend/Test Sanity**
  - [ ] 🟥 Keep existing Rust folder-order tests.
  - [ ] 🟥 Add one repository test if needed for a root reorder downward off-by-one case.
  - [ ] 🟥 Do not change the database schema unless a backend bug is discovered.

- [ ] 🟥 **Step 8: Manual Interaction QA**
  - [ ] 🟥 Run `pnpm exec tsc --noEmit --pretty false`.
  - [ ] 🟥 Run `cargo test database::repositories::folder::tests`.
  - [ ] 🟥 Run `pnpm run build`.
  - [ ] 🟥 Launch Adamant Dev.
  - [ ] 🟥 Test root reorder upward.
  - [ ] 🟥 Test root reorder downward.
  - [ ] 🟥 Test nested folder to first root position.
  - [ ] 🟥 Test nested folder between two root folders.
  - [ ] 🟥 Test nested folder to last root position.
  - [ ] 🟥 Test folder nesting still works.
  - [ ] 🟥 Test meeting folder/unfiled drag remains unchanged.

## Risks and Edge Cases

* **Nesting into root folders may need a clearer affordance:** A sortable root row and a folder nesting target represent different intents. The initial fix should prioritize making root reorder stable. If nesting into root folders becomes ambiguous, add an explicit nesting affordance rather than overloading the row.
* **Nested folder promotion into root sortable context:** A nested dragged item is not initially in the root sortable item list. The drag-end logic must still handle dropping it over a root sortable item by calculating the insertion index from the over root item.
* **Expanded root folders:** Root sortable items may include children. If sorting the entire expanded subtree feels heavy, render only the root header as the sortable handle and keep children below it in the item wrapper.
* **Collapsed Folders section:** Drag behavior should only operate when the root list is rendered.
* **Empty root list:** If no root folders exist, a nested folder promotion target may need a simple root-list droppable fallback.

## Out of Scope

* Reordering nested subfolders within their parent.
* Reordering meetings.
* Multi-select folder dragging.
* Keyboard-accessible folder ordering.
* Redesigning the full sidebar folder system.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

