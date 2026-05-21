# Folder Drag-and-Drop Root Cause and Fix Plan

**Overall Progress:** `88%`

## TLDR

The current implementation works for top-level folder reordering because those rows are handled by `@dnd-kit/sortable`, but nested-folder promotion and folder nesting are still routed through overlapping droppable targets and leftover custom root-insertion state.

The fix is to make the drag system classify intent explicitly:

* **Root reorder:** top-level folder dragged between top-level folders.
* **Root promotion:** nested folder dragged into a dedicated root insertion slot between top-level folders.
* **Folder nesting:** folder dragged directly onto a folder header.

This should remove the current ambiguous behavior where the same visual area can mean “reorder beside this folder,” “promote to root here,” or “nest inside this folder,” depending on whichever dnd-kit collision target wins at that moment.

## End Result

When this plan is executed correctly:

* Dragging a **top-level folder** above or below another top-level folder reorders the parent folders and persists the order.
* Dragging a **nested folder** between top-level folders promotes it to root at that exact position.
* Dragging a **nested folder** above the first top-level folder promotes it to the first root position.
* Dragging a **nested folder** below the last top-level folder promotes it to the last root position.
* Dragging any folder **directly onto a folder header** nests it inside that folder.
* Dropping in a root insertion slot never silently nests the folder into another folder.
* Dropping onto a folder header never silently converts into root reordering.
* A moved folder should not disappear. If it moves, its new parent and root order should be deterministic and visible after refresh.

## Current Root Cause Analysis

### 1. Reorder Parent Folders Works

**Observed behavior:** Dragging a top-level folder above or below another top-level folder works.

**Root cause:** This path is the only one currently owned cleanly by `@dnd-kit/sortable`.

Relevant code:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1292) wraps each root folder with `SortableRootFolderItem`.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:374) handles `activeData.type === 'root-folder-sort'`.

This works because the active item and the drop targets are in the same root sortable list.

### 2. Nested Folder To Root Sometimes Works, Sometimes Disappears

**Observed behavior:** Dragging a nested folder down under its parent sometimes promotes it to root, but sometimes the folder disappears. Dragging it above the original parent almost always makes it disappear.

**Root cause:** Nested-folder promotion is not actually using the root sortable model. It still uses custom pointer geometry and a separate `activeRootInsertIndex`, while every folder is also a full `folder-target` droppable.

Relevant code:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:211) tracks `activeRootInsertIndex`.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:261) snapshots root row rectangles.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:332) updates the root insert index from drag movement.
* [FolderItem.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/FolderItem.tsx:88) registers every folder as `folder-target:${folder.id}`.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:398) chooses between root promotion and folder nesting based on `rootInsertIndex` plus `overData`.

The failure mode is:

1. The nested folder drag starts as `activeData.type === 'folder'`.
2. The root insertion index is calculated separately from dnd-kit collision.
3. At drop time, dnd-kit may report `overData.type === 'folder-target'` because the pointer is over a folder container.
4. The handler then calls `moveFolder(activeFolderId, overFolderId)` instead of `moveFolderToPosition(activeFolderId, null, index)`.
5. The folder is moved into whichever folder won collision detection, often a collapsed or unintended folder.

That looks like a disappearance from the UI, but the backend path is more likely changing `parent_id` to an unexpected folder than deleting the folder. The repository move API does not delete folders in this path.

Dragging above the original parent fails more consistently because the closest/full-area droppable is usually the parent folder container, so the drop is classified as a folder-target interaction instead of a root insertion interaction.

### 3. Nested Folder To Bottom Does Not Work

**Observed behavior:** Dragging a nested folder to the bottom makes it disappear.

**Root cause:** There is no stable bottom root insertion target. The current bottom behavior depends on pointer geometry staying inside the root list snapshot and on `overData` not being a folder target.

Relevant code:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:270) rejects root insertion if the pointer moves outside the snapshotted root list bounds.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:398) only promotes to root when `rootInsertIndex !== null` and the drop is not treated as a folder-target drop.

The bottom of the folder list is especially fragile because there is no explicit `drop at root index N` target. If dnd-kit reports the closest folder target instead, the code nests the dragged folder. If dnd-kit reports no useful target and the custom root index has been cleared, the drop is ignored.

### 4. Folder Nesting No Longer Works

**Observed behavior:** Dragging one folder onto another does not nest it. It moves the dragged folder down in the parent hierarchy instead.

**Root cause:** Root sortable behavior now wins over folder nesting for top-level folder rows, and nested-folder root promotion also wins over root-folder nesting when `activeRootInsertIndex` is set.

Relevant code:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:374) handles root folder drags as sortable reorder first.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:377) treats both `root-folder-sort` and `folder-target` over-data as candidates for root reordering.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:405) promotes nested folders to root when over a root folder and `rootInsertIndex` is set.

The current UI has no unambiguous “drop into this folder” surface. The same folder row is both:

* a root sortable row,
* a folder nesting target,
* part of the custom nested-to-root insertion geometry.

Because these meanings overlap, the drop handler often interprets a folder-on-folder drop as reorder or root promotion instead of nesting.

## Critical Decisions

* **Use explicit root insertion zones for nested promotion:** Nested folders need real dnd-kit droppable targets like `root-folder-insert:0`, `root-folder-insert:1`, etc. This removes the need for snapshotted DOM geometry.
* **Keep `@dnd-kit/sortable` for top-level reorder:** Parent-folder reorder already works and should stay on the proven path.
* **Move folder nesting to folder headers only:** Dropping onto the visible folder header should mean “nest here.” The whole expanded subtree should not be a nesting target.
* **Use distinct target IDs and data types:** Root reorder, root insertion, and folder nesting must have separate IDs and separate `data.type` values.
* **Prefer explicit intent over closest-center guessing:** A drop over an insertion slot should always promote/reorder at that index. A drop over a folder header should always nest. Sortable fallback should handle root reorder only.
* **Add temporary debug logging during the fix:** During manual QA, log active type, over type, active folder, target folder, target index, and resulting API call. Remove or downgrade logs before finalizing if noisy.

## Tasks

- [x] 🟩 **Step 1: Replace Custom Nested-To-Root Geometry**
  - [x] 🟩 Remove `activeRootInsertIndex`, `rootFolderListRef`, `rootFolderRowRefs`, `rootFolderRectSnapshotRef`, `rootFolderListRectSnapshotRef`, `dragStartClientYRef`, `snapshotRootFolderRects`, `updateExternalRootInsertIndex`, and `handleDragMove`.
  - [x] 🟩 Remove the current `FolderRootInsertPlaceholder` implementation that is driven by measured pointer position.
  - [x] 🟩 Remove `rowRef` from `FolderItem` unless another non-DnD use remains.

- [x] 🟩 **Step 2: Add Dedicated Root Insertion Slots**
  - [x] 🟩 Create a `RootFolderInsertZone` component using `useDroppable`.
  - [x] 🟩 Give each zone an ID like `root-folder-insert:${index}` and data `{ type: 'root-folder-insert', index }`.
  - [x] 🟩 Render one zone before the first root folder, one between each root folder, and one after the last root folder.
  - [x] 🟩 During folder drag, expand the active/hovered insertion zone to a folder-row-height placeholder so the UI visibly pushes folders apart.
  - [x] 🟩 Keep inactive insertion zones visually subtle so the list does not look cluttered.

- [x] 🟩 **Step 3: Restrict Folder Nesting Targets To Headers**
  - [x] 🟩 Change `FolderItem` so `useDroppable` for folder nesting attaches to the folder header row, not the entire folder container.
  - [x] 🟩 Rename the drop data type from generic `folder-target` to explicit `folder-nest-target`.
  - [x] 🟩 Keep meeting drops compatible by treating `folder-nest-target` as a valid meeting destination.
  - [x] 🟩 Ensure expanded children do not accidentally count as dropping onto the parent folder.

- [x] 🟩 **Step 4: Separate Drag Handles From Drop Targets**
  - [x] 🟩 Keep top-level folder drag handled by `SortableRootFolderItem`.
  - [x] 🟩 Keep nested folder drag handled by `FolderItem`'s own `useDraggable`.
  - [x] 🟩 Apply sortable listeners to the root folder header while preserving the header as the explicit nesting target.
  - [x] 🟩 Verify action buttons, rename input, and expand/collapse still stop drag initiation correctly.

- [x] 🟩 **Step 5: Rewrite Drop Resolution Around Explicit Target Types**
  - [x] 🟩 For `active.type === 'meeting'` and `over.type === 'folder-nest-target'`, call `moveMeetingToFolder(meetingId, folderId)`.
  - [x] 🟩 For `active.type === 'meeting'` and `over.type === 'meeting-root-target'`, call `moveMeetingToFolder(meetingId, null)`.
  - [x] 🟩 For `active.type === 'folder'` or `active.type === 'root-folder-sort'` and `over.type === 'root-folder-insert'`, call `moveFolderToPosition(folderId, null, index)`, with the existing same-parent downward adjustment for root folders.
  - [x] 🟩 For folder drags over `folder-nest-target`, call `moveFolder(folderId, targetFolderId)` unless it is a self-drop or descendant cycle rejected by the backend.
  - [x] 🟩 For root sortable drags over another `root-folder-sort`, keep the existing root reorder behavior.
  - [x] 🟩 Remove fallback branches that treat a generic folder target as root reorder.

- [x] 🟩 **Step 6: Add Collision Priority If Needed**
  - [x] 🟩 Start with explicit droppable target types and default collision behavior.
  - [x] 🟩 Added a custom collision detector that prioritizes:
    1. pointer-over `root-folder-insert` zones,
    2. pointer-over `folder-nest-target` headers,
    3. sortable root row fallback for top-level reorder.
  - [x] 🟩 Keep this detector small and local to the sidebar.

- [x] 🟩 **Step 7: Add Regression Tests Around Persistence**
  - [x] 🟩 Add or keep repository coverage proving nested-to-root at index `0`, middle, and final index.
  - [x] 🟩 Add coverage for root reorder downward to catch index adjustment mistakes.
  - [x] 🟩 Add coverage proving `move_folder` rejects moving a folder into its descendant.
  - [x] 🟩 Do not change schema unless a backend bug is discovered.

- [ ] 🟨 **Step 8: Manual QA With Debug Trace**
  - [x] 🟩 Run `pnpm exec tsc --noEmit --pretty false`.
  - [x] 🟩 Run `cargo test database::repositories::folder::tests`.
  - [x] 🟩 Run `pnpm run build`.
  - [x] 🟩 Launch Adamant Dev.
  - [ ] 🟥 Test top-level reorder upward and downward.
  - [ ] 🟥 Test nested folder promotion above the first root folder.
  - [ ] 🟥 Test nested folder promotion between two root folders.
  - [ ] 🟥 Test nested folder promotion below the last root folder.
  - [ ] 🟥 Test top-level folder nesting into another top-level folder.
  - [ ] 🟥 Test nested folder nesting into a different folder.
  - [ ] 🟥 Test meeting drag into folder and back to unfiled.
  - [ ] 🟥 Confirm debug traces match the intended API call for every drop.

## Verification Criteria

The fix is not complete until these conditions are true:

* Every drag operation maps to exactly one intended API call.
* Root insertion zones produce `moveFolderToPosition(folderId, null, index)`.
* Folder headers produce `moveFolder(folderId, targetFolderId)`.
* Top-level reorder still produces `moveFolderToPosition(folderId, null, index)`.
* No folder moves into an unintended collapsed folder during the tested flows.
* Refreshing the folder list after each operation shows the moved folder in the expected visible location.

## Risks And Edge Cases

* **Root reorder versus root nesting ambiguity:** Dropping a root folder onto another root folder needs a clear target distinction. The plan resolves this by making insertion slots reorder and folder headers nest.
* **Expanded folders:** Expanded child content must not enlarge the parent nesting target. Header-only droppables fix this.
* **Bottom insertion:** The final `root-folder-insert:${rootFolders.length}` slot must remain present even when the list is scrolled near the Meeting Notes section.
* **Empty root list:** If there are no root folders, render a single root insertion zone at index `0`.
* **Collapsed folders section:** Folder drag targets only exist while the Folders section is rendered; that is acceptable for this fix.
* **Cycle rejection:** The backend already rejects moving a folder into itself or a descendant. The UI should still avoid obvious self-drops before calling the backend.

## Out Of Scope

* Reordering nested folders within a parent folder.
* Reordering meetings.
* Keyboard-accessible folder ordering.
* Multi-select folder dragging.
* Redesigning the full sidebar.

**Status Tracking:**

* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
