# Feature Implementation Plan

**Overall Progress:** `100%`

**Execution Status:** Implemented. The code now persists folder sibling order, exposes a positioned move command, and replaces the single root drop box with top-level insertion drop zones.

## TLDR

Replace the temporary "Top level" drop box with insertion-based folder drag/drop. When a user drags a folder between two top-level folders, the list should open a visible insertion gap, and dropping there should move that folder to the root at that exact position. This requires persisting folder sibling order because folders are currently returned in `created_at` order.

## Expected End Result

Once implemented, a user can drag any folder, including a nested subfolder, into the top-level folder list and place it exactly where they want it. While dragging, hovering between top-level folders will create a clear insertion slot by pushing the lower folder down. Dropping into that slot will make the dragged folder a root folder and persist its order.

Users will also be able to reorder existing top-level folders with the same interaction. For example, if the root list is `A, B, C`, dragging `C` above `A` should leave the root list as `C, A, B`; dragging nested `D` between `A` and `B` should leave `A, D, B, C`, with `D.parent_id = null`.

Existing behavior must remain intact: dragging a folder onto another folder still nests it, dragging meetings into folders or back to unfiled still works, nested folders can still be expanded/collapsed, and invalid folder moves such as moving a folder into itself or one of its descendants remain rejected.

## Critical Decisions

* **Persist sibling order in SQLite:** Add a numeric `sort_order` column to `folders`. UI-only ordering is insufficient because the user explicitly wants folders to remain in the chosen order.
* **Scope ordering to siblings:** A folder's position only has meaning among folders sharing the same `parent_id`. The immediate request is top-level ordering, but storing sibling order generally keeps the data model coherent for future nested-folder reordering.
* **Add explicit move-with-position API:** Extend the backend with a command that accepts `folder_id`, `parent_id`, and an insertion index or sibling reference. Avoid overloading the current `api_move_folder` behavior in a way that breaks existing callers.
* **Use insertion drop zones, not a single root target:** Replace the "Top level" box with slim droppable zones rendered before, between, and after root folders while a folder is being dragged.
* **Keep folder-on-folder nesting separate:** Dropping on a folder row means "nest into this folder"; dropping between root rows means "move to root at this position."

## Current Code Findings

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:218) currently handles drag end for meetings and folders.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:249) already supports moving a folder to root by calling `moveFolder(folderId, null)` when the drop target is `folder-root-target`.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1113) currently renders one root drop target above all root folders.
* [SidebarProvider.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/SidebarProvider.tsx:202) builds folder trees from the raw `folders` array and currently relies on backend order.
* [folder.rs](/Users/rling/Documents/Vibing/adamant/frontend/src-tauri/src/database/repositories/folder.rs:44) returns folders ordered by `created_at ASC`, so reordering cannot currently persist.
* [folder.rs](/Users/rling/Documents/Vibing/adamant/frontend/src-tauri/src/database/repositories/folder.rs:79) already validates parent changes and prevents cycles.

## Tasks

- [ ] 🟥 **Step 1: Add Persisted Folder Ordering**
  - [ ] 🟥 Add a migration such as `20260520000000_add_folder_sort_order.sql` that adds `sort_order INTEGER NOT NULL DEFAULT 0` to `folders`.
  - [ ] 🟥 Backfill existing folder order deterministically from current `created_at ASC` order, scoped by `parent_id`.
  - [ ] 🟥 Update `FolderModel` and frontend `Folder` type with `sort_order`.
  - [ ] 🟥 Update `get_all_folders` to order by parent scope and `sort_order ASC`, with a stable fallback such as `created_at ASC`.

- [ ] 🟥 **Step 2: Add Backend Move-And-Reorder Support**
  - [ ] 🟥 Add a repository method like `move_folder_to_position(pool, folder_id, parent_id, index)`.
  - [ ] 🟥 Reuse the existing cycle validation from `move_folder`.
  - [ ] 🟥 In one transaction, remove the folder from its old sibling list, insert it into the target sibling list, and rewrite `sort_order` values compactly.
  - [ ] 🟥 Handle moving nested folder to root, moving root folder within root, moving root folder into another folder, and moving between two non-root parents.
  - [ ] 🟥 Add a Tauri command such as `api_move_folder_to_position`.
  - [ ] 🟥 Keep `api_move_folder` working for existing callers, either preserving its current append/default behavior or delegating to the new method with an append position.

- [ ] 🟥 **Step 3: Update Sidebar State Helpers**
  - [ ] 🟥 Add a `moveFolderToPosition(folderId, parentId, index)` helper in `SidebarProvider`.
  - [ ] 🟥 Sort folders by `sort_order` in `buildFolderTree` as a defensive frontend fallback, even though the backend should already return ordered data.
  - [ ] 🟥 Keep existing `moveFolder(folderId, parentId)` for folder-on-folder nesting unless the implementation intentionally routes it through append-position behavior.

- [ ] 🟥 **Step 4: Replace Root Box With Insertion Drop Zones**
  - [ ] 🟥 Remove the visible `FolderRootDropZone` rectangle.
  - [ ] 🟥 Render root insertion drop zones before the first root folder, between each pair of root folders, and after the last root folder while `activeDragType === 'folder'`.
  - [ ] 🟥 Give each zone data like `{ type: 'folder-root-insert-target', index }`.
  - [ ] 🟥 Style hover so the insertion location is obvious: a slim highlighted slot or line that expands enough to be hittable and visually pushes the next folder down.
  - [ ] 🟥 Avoid instructional text in the list; the drag affordance itself should communicate the destination.

- [ ] 🟥 **Step 5: Route Drag End by Drop Intent**
  - [ ] 🟥 Extend `overData` typing in `handleDragEnd` to include `folder-root-insert-target`.
  - [ ] 🟥 On folder drop over an insert target, call `moveFolderToPosition(activeFolderId, null, index)`.
  - [ ] 🟥 Adjust the insertion index when dragging a root folder downward within the same root sibling list, so removing the source before inserting does not create an off-by-one placement.
  - [ ] 🟥 Keep folder-row drops mapped to nesting behavior.
  - [ ] 🟥 Keep meeting drops mapped to existing folder/unfiled behavior.

- [ ] 🟥 **Step 6: Add Focused Tests**
  - [ ] 🟥 Add Rust repository tests for reordering root folders.
  - [ ] 🟥 Add Rust repository tests for moving a nested folder to root at a specific index.
  - [ ] 🟥 Add Rust repository tests for moving a root folder into another folder while assigning sibling order.
  - [ ] 🟥 Add Rust repository tests that cycle prevention still works with the new positioned move method.

- [ ] 🟥 **Step 7: Verify Manually and With Commands**
  - [ ] 🟥 Run the focused Rust folder repository tests.
  - [ ] 🟥 Run `pnpm exec tsc --noEmit --pretty false` from `frontend`.
  - [ ] 🟥 Run `git diff --check`.
  - [ ] 🟥 Manually test in Adamant Dev: reorder root folders, drag a nested folder between root folders, drag a nested folder to the beginning and end of the root list, and confirm order persists after refresh/relaunch.
  - [ ] 🟥 Confirm dragging meetings and folder-on-folder nesting still behave as before.

## Risks and Edge Cases

* **Index adjustment:** Reordering within the same sibling list can place the folder one slot too far unless the implementation accounts for source removal before insertion.
* **Existing data:** Current folders have no order column, so the migration must preserve today's visible order by backfilling from `created_at`.
* **Ambiguous drop zones:** Folder row hit areas and between-row insert zones must be visually and geometrically distinct so users can choose nesting versus reordering.
* **Collapsed folders:** Root insertion should work independently of whether individual folders are expanded.
* **Nested future behavior:** This plan stores order for all sibling groups, but only implements insertion zones for root folders unless scope is explicitly expanded.

## Out of Scope

* Reordering meetings inside folders.
* Reordering nested subfolders within a parent folder.
* Dragging folders into arbitrary nested insertion positions.
* Multi-select folder moves.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
