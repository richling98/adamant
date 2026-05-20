# Feature Implementation Plan: Folder Drag-and-Drop Nesting

**Overall Progress:** `95%`

## TLDR

Add folder reparenting so users can drag a folder onto another folder to nest it, or drag it back to the top-level folders area. The existing app already supports arbitrary-depth folder storage and recursive rendering via `folders.parent_id`; this plan adds the missing move API, cycle protection, and typed drag-and-drop behavior for folder rows.

## Current State

- Folder nesting already exists in the schema via `folders.parent_id`.
- The sidebar already renders nested folders recursively.
- Users can create subfolders with the `FolderPlus` action.
- Meetings are draggable into folders today.
- Folders are droppable targets today, but only for meetings.
- Folders are not draggable, and there is no `api_move_folder` command.

## Pause Notes - 2026-05-20

Implementation is paused mid-feature at the user's request.

Completed in code:
- Added `FoldersRepository::move_folder(...)` with source validation, target validation, self-move rejection, descendant-cycle rejection, and transactional `parent_id` updates.
- Added and registered `api_move_folder`.
- Added `moveFolder(folderId, parentId)` to `SidebarProvider`.
- Began typed dnd-kit wiring:
  - `FolderItem` now uses `useDraggable` and typed folder drag/drop payloads.
  - `Sidebar/index.tsx` now tracks active drag type and routes `handleDragEnd` by `active.data.current.type`.
  - A `FolderRootDropZone` call site has been added, but the component implementation still needs to be added before the frontend will compile.

Important next actions:
- Finish `FolderRootDropZone` in `Sidebar/index.tsx`. *(Completed after pause.)*
- Confirm `FolderItem` click/drag behavior still works after adding folder draggable listeners. *(Automated compile checks completed; manual app QA still pending.)*
- Add/update `DraggableMeetingRow` and `UnfiledDropZone` typed dnd data if not already complete in the next pass. *(Completed after pause.)*
- Add repository tests for `move_folder`. *(Completed after pause.)*
- Run verification. *(Automated checks completed; manual QA still pending.)*

## Verification Notes - 2026-05-20

Automated verification completed:
- `cargo test database::repositories::folder::tests` from `frontend/src-tauri`: passed, 5 tests passed.
- `cargo check` from `frontend/src-tauri`: passed with existing warnings.
- `pnpm exec tsc --noEmit` from `frontend`: passed with exit code 0.
- `git diff --check` for changed files: passed.
- Targeted `rustfmt --edition 2021` succeeded for `src/database/repositories/folder.rs`. `api.rs` and `lib.rs` were kept as minimal patches to avoid unrelated formatting churn.

Checks not completed:
- `pnpm run lint` failed before linting because `next lint` resolves as an invalid project directory with the current Next CLI: `Invalid project directory provided ... /frontend/lint`.
- Full `cargo fmt` failed on pre-existing trailing whitespace in `src/whisper_engine/whisper_engine.rs` lines 1185 and 1191, unrelated to this feature.
- Manual drag-and-drop QA in the running app has not been performed.

## Critical Decisions

- **No explicit depth limit** - The UI and data model should continue using recursive nesting without a hard-coded maximum. Practical limits are only viewport readability and normal recursion/runtime constraints.
- **Add backend cycle protection** - A folder cannot be moved into itself or any of its descendants. This prevents corrupt trees and infinite recursion in `buildFolderTree`.
- **Support moving folders back to root** - Dragging a folder to a root folders drop zone sets `parent_id = NULL`.
- **Use typed dnd-kit payloads** - Meeting and folder drag operations should be distinguished with `data.current.type`, not inferred from raw IDs. This avoids accidental calls like treating a folder ID as a meeting ID.
- **Keep meeting drag behavior intact** - Existing meeting-to-folder and meeting-to-root moves remain supported while adding folder-to-folder and folder-to-root moves.

## Tasks

- [x] 🟩 **Step 1: Add Folder Move Repository Support**
  - [x] 🟩 Add `FoldersRepository::move_folder(pool, folder_id, parent_id)` in `frontend/src-tauri/src/database/repositories/folder.rs`.
  - [x] 🟩 Validate `folder_id` is non-empty.
  - [x] 🟩 Treat `parent_id = None` as moving the folder to the top level.
  - [x] 🟩 If `parent_id` is present, verify the target folder exists.
  - [x] 🟩 Reject `folder_id == parent_id`.
  - [x] 🟩 Reject moving a folder into one of its descendants by walking the target parent chain with the existing flat folder list.
  - [x] 🟩 Update `folders.parent_id` and `updated_at` in a transaction.
  - [x] 🟩 Return `Ok(false)` when the source folder does not exist, matching existing repository patterns.

- [x] 🟩 **Step 2: Expose `api_move_folder` Through Tauri**
  - [x] 🟩 Add a Tauri command in `frontend/src-tauri/src/api/api.rs`:
    - `folder_id: String`
    - `parent_id: Option<String>`
  - [x] 🟩 Map repository validation failures to user-readable errors.
  - [x] 🟩 Register `api_move_folder` in `frontend/src-tauri/src/lib.rs`.
  - [x] 🟩 Keep existing folder create/rename/delete commands unchanged.

- [x] 🟩 **Step 3: Add Sidebar Provider Helper**
  - [x] 🟩 Extend `SidebarContextType` in `frontend/src/components/Sidebar/SidebarProvider.tsx` with `moveFolder(folderId, parentId)`.
  - [x] 🟩 Implement it with `invoke('api_move_folder', { folderId, parentId })`.
  - [x] 🟩 Refresh folders after a successful move.
  - [x] 🟩 Do not refresh meetings for folder-only moves unless the UI needs it; meeting `folder_id` values do not change.

- [x] 🟩 **Step 4: Make Folder Rows Draggable**
  - [x] 🟩 In `FolderItem.tsx`, use `useDraggable` for the folder header row.
  - [x] 🟩 Keep `useDroppable` on folders so they remain valid targets.
  - [x] 🟩 Combine draggable and droppable refs carefully on the folder container/header.
  - [x] 🟩 Use typed drag data, for example:
    - folder draggable: `{ type: 'folder', folderId: folder.id }`
    - folder droppable: `{ type: 'folder-target', folderId: folder.id }`
  - [x] 🟩 Preserve existing click-to-expand, hover actions, rename, delete, and new-subfolder behavior.
  - [x] 🟩 Prevent drag initiation from action buttons and rename inputs with pointer event guards.

- [x] 🟩 **Step 5: Add a Root Folders Drop Zone**
  - [x] 🟩 Add a droppable root zone around the folders list in `Sidebar/index.tsx`.
  - [x] 🟩 Use typed drop data, for example `{ type: 'folder-root-target' }`.
  - [x] 🟩 Highlight the folders area when a folder is dragged over it.
  - [x] 🟩 Avoid making the meeting-notes root zone handle folder drops.

- [x] 🟩 **Step 6: Route Drag End by Type**
  - [x] 🟩 Replace the current ID-only `handleDragEnd` logic in `Sidebar/index.tsx` with typed branching.
  - [x] 🟩 For `active.type === 'meeting'` and folder target: call `moveMeetingToFolder(meetingId, folderId)`.
  - [x] 🟩 For `active.type === 'meeting'` and meeting root target: call `moveMeetingToFolder(meetingId, null)`.
  - [x] 🟩 For `active.type === 'folder'` and folder target: call `moveFolder(folderId, targetFolderId)`.
  - [x] 🟩 For `active.type === 'folder'` and folder root target: call `moveFolder(folderId, null)`.
  - [x] 🟩 Ignore no-op drops, including dropping a folder on itself.
  - [x] 🟩 Let backend validation handle descendant-cycle drops; optionally show a toast for rejected moves.

- [x] 🟩 **Step 7: Polish Drag UX**
  - [x] 🟩 Give dragged folder rows reduced opacity or a lightweight transform, matching `DraggableMeetingRow`.
  - [x] 🟩 Keep folder drop highlight distinct but consistent with the existing blue highlight.
  - [x] 🟩 Ensure dragging a folder does not unexpectedly toggle expand/collapse on drop.
  - [x] 🟩 Ensure deeply nested rows remain readable and do not overflow action buttons.

- [x] 🟩 **Step 8: Add Focused Tests Where Practical**
  - [x] 🟩 Add Rust unit tests or repository tests for `move_folder` validation:
    - move top-level folder into another folder
    - move nested folder back to root
    - reject moving folder into itself
    - reject moving folder into descendant
    - reject missing target parent
  - [x] 🟩 If frontend test infrastructure is not available, cover frontend behavior with manual QA instead of introducing a new test framework.

- [ ] 🟨 **Step 9: Verify**
  - [x] 🟩 Run `cargo check` in `frontend/src-tauri`.
  - [ ] 🟥 Run `pnpm run lint` in `frontend` if current repo state permits. *(Blocked: current `next lint` command fails before linting with an invalid `/frontend/lint` project path.)*
  - [x] 🟩 Run `pnpm exec tsc --noEmit` in `frontend`.
  - [x] 🟩 Run focused folder repository tests.
  - [x] 🟩 Run `git diff --check` on changed files.
  - [ ] 🟥 Manually verify:
    - drag folder A into folder B
    - drag folder A back to top level
    - drag folder A into nested folder B/C
    - drag a folder containing meetings and subfolders
    - invalid self/descendant drops do not corrupt the tree
    - existing meeting drag into folder still works
    - existing meeting drag back to unfiled still works
    - create, rename, delete, and expand/collapse still work on dragged folders

## Out of Scope

- Reordering folders among siblings.
- Persisted custom sort order.
- Drag previews or overlays beyond the existing inline transform/opacity style.
- Changing deletion semantics for nested folders.

## Open Risks

- Existing recursive rendering assumes an acyclic tree; backend validation is mandatory before exposing folder moves.
- `FolderItem` currently uses the folder container as a droppable target. Making the same row draggable needs careful ref composition so both behaviors remain active.
- The previous drag handler treats every active ID as a meeting ID. The implementation must use typed drag data before folder dragging is enabled.

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.
