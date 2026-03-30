# Feature Implementation Plan: Nested Folders

**Overall Progress:** `100%`

## TLDR

The current folder system is explicitly flat — the schema comment reads "Folders are one level deep (no nested folders)" and `FolderModel` has no `parent_id`. This plan adds unlimited nesting by introducing a `parent_id` column to `folders`, updating the Rust model/repository/API, making `buildSidebarItems()` recursive, and extending `FolderItem` to render child folders recursively with a "New Subfolder" action.

## End Result

Every folder has a "New Subfolder" button in its hover actions. Clicking it creates a child folder directly inside that folder, which immediately enters rename mode. Subfolders can themselves contain subfolders, infinitely deep. Each level has its own expand/collapse, rename, delete, and "new meeting" controls — identical UX to top-level folders. Deleting a parent folder deletes all its descendants; meetings in any deleted folder become unfiled (existing FK behaviour preserved).

## Critical Decisions

- **`parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE`** — deleting a parent cascades to all descendants. Meetings in deleted child folders become unfiled automatically via the existing `meetings.folder_id ON DELETE SET NULL` constraint. Clean, no manual recursive cleanup needed in Rust.
- **Flat `get_all_folders()` response; frontend builds the tree** — avoids recursive CTEs in SQLite (not available until SQLite 3.35+, and we rely on system SQLite in some paths). The frontend receives a flat array and builds the recursive tree with `buildFolderTree(parentId)`.
- **`folderData?: Folder` added to `SidebarItem`** — when a `SidebarItem` represents a folder, it carries its `Folder` model so `FolderItem` can render rename/delete/etc. without threading a separate lookup map through props.
- **New subfolder created with name "New Folder" + immediately enters inline rename** — mirrors the existing folder creation UX. No modal needed; matches how the app already handles folder naming.
- **Drag-and-drop scope unchanged** — meetings can still be dragged to any folder (including nested ones). Moving folders themselves via drag is out of scope.
- **`depth` prop added to `FolderItem`** — controls left-indent per nesting level. Each level adds `12px` of padding, consistent with the existing `depth * 12 + 12` formula used for meeting rows.

---

## Tasks

- [x] 🟩 **Step 1: DB Migration — add `parent_id` to `folders`**
  - [x] 🟩 Create `frontend/src-tauri/migrations/20260330000000_add_folder_nesting.sql`:
    ```sql
    ALTER TABLE folders ADD COLUMN parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE;
    ```
  - [x] 🟩 No data migration needed — existing folders get `parent_id = NULL` (top-level) by default.

- [x] 🟩 **Step 2: Rust model — add `parent_id` to `FolderModel`**
  - [x] 🟩 In `frontend/src-tauri/src/database/models.rs`, add `pub parent_id: Option<String>` to `FolderModel`.
  - [x] 🟩 Update the doc comment on `FolderModel` to remove "one level deep, no nesting."

- [x] 🟩 **Step 3: Rust repository — thread `parent_id` through `create_folder`**
  - [x] 🟩 In `frontend/src-tauri/src/database/repositories/folder.rs`, add `parent_id: Option<&str>` parameter to `create_folder()`.
  - [x] 🟩 Update the SQL INSERT to include `parent_id` in the column list and bind it.
  - [x] 🟩 No changes needed to `get_all_folders`, `rename_folder`, or `delete_folder` — the CASCADE handles recursive child deletion automatically.

- [x] 🟩 **Step 4: Tauri API — thread `parent_id` through `api_create_folder`**
  - [x] 🟩 In `frontend/src-tauri/src/api/api.rs`, add `parent_id: Option<String>` parameter to `api_create_folder`.
  - [x] 🟩 Pass `parent_id.as_deref()` through to `FoldersRepository::create_folder`.
  - [x] 🟩 Add `#[serde(skip_serializing_if = "Option::is_none")] pub parent_id: Option<String>` to the `Folder` response struct so the frontend receives the hierarchy information.

- [x] 🟩 **Step 5: Frontend — update `Folder` type and `SidebarItem`**
  - [x] 🟩 In `SidebarProvider.tsx`, add `parent_id?: string | null` to the `Folder` interface.
  - [x] 🟩 In `Sidebar/index.tsx` (or wherever `SidebarItem` is defined), add `folderData?: Folder` to the `SidebarItem` interface. This field is populated for `type: 'folder'` items so `FolderItem` can render rename/delete without a separate lookup.

- [x] 🟩 **Step 6: `SidebarProvider` — recursive `buildFolderTree` + update `createFolder`**
  - [x] 🟩 Update `createFolder(name, parentId?: string | null)` to accept and pass through `parentId` when calling `invoke('api_create_folder', { name, parentId })`.
  - [x] 🟩 Replace the flat `buildSidebarItems()` folder mapping with a recursive `buildFolderTree(parentId: string | null): SidebarItem[]` helper:
    - Filters `folders` by `(f.parent_id ?? null) === parentId`
    - For each folder, recursively calls `buildFolderTree(folder.id)` for sub-folders
    - Appends meeting items (`meetings.filter(m => m.folder_id === folder.id)`) after subfolder items
    - Sets `folderData: folder` on each folder SidebarItem
  - [x] 🟩 Top-level `buildSidebarItems()` calls `buildFolderTree(null)` for the folders section and keeps the existing unfiled meetings list unchanged.

- [x] 🟩 **Step 7: `FolderItem` — recursive rendering + "New Subfolder" button**
  - [x] 🟩 Add `depth?: number` prop to `FolderItemProps` (default `0`). Use it to compute `paddingLeft` for the folder header: `${depth * 12 + 12}px`. Child `FolderItem`s receive `depth + 1`.
  - [x] 🟩 In the children rendering loop, check `child.type`:
    - If `child.type === 'folder'` and `child.folderData` exists: render `<FolderItem folder={child.folderData} children={child.children ?? []} depth={(depth ?? 0) + 1} ...forwardedProps />`. Forward `isSidebarCollapsed`, `renderMeetingItem`, `activeMeetingId`.
    - If `child.type === 'file'`: existing `renderMeetingItem(child, true)` call (unchanged).
  - [x] 🟩 Add a "New Subfolder" icon button to the hover action row (alongside existing pencil / plus / trash). Use `FolderPlus` from `lucide-react`:
    - On click: call `createFolder('New Folder', folder.id)` then immediately enter inline rename mode for the newly created subfolder.
    - Since the new subfolder is rendered as a child `FolderItem`, trigger rename on it by setting a `pendingRenameId` ref/state that each `FolderItem` checks on mount.
  - [x] 🟩 Alternatively (simpler): on "New Subfolder" click, call `createFolder('New Folder', folder.id)` and `fetchFolders()` — the new subfolder will appear in the tree and the user can double-click to rename (consistent with the existing rename-via-double-click pattern). This avoids the need for cross-component rename triggering.

- [x] 🟩 **Step 8: `Sidebar/index.tsx` — render only root folders**
  - [x] 🟩 In the folders rendering section, filter to only root folders before mapping: `folders.filter(f => !f.parent_id)`. Child folders are rendered recursively by `FolderItem` — no change to how `FolderItem` is called at the top level.
  - [x] 🟩 The `folderMeetings` computation (meetings filtered by `folder.id`) stays as-is for the top-level call. Child folder meetings are handled inside `FolderItem` via the recursive `children` prop built in `buildFolderTree`.

- [x] 🟩 **Step 9: Verify compilation and test**
  - [x] 🟩 Run `cargo check` inside `frontend/src-tauri` — zero errors.
  - [x] 🟩 Run `./clean_run.sh` — app launches.
  - [x] 🟩 Manually verify: create a top-level folder → hover → "New Subfolder" button appears → click creates a child folder → double-click to rename.
  - [x] 🟩 Manually verify: create a subfolder inside a subfolder (3 levels deep).
  - [x] 🟩 Manually verify: meetings can be dragged into nested folders.
  - [x] 🟩 Manually verify: deleting a parent folder removes all child folders and unfiles their meetings.
  - [x] 🟩 Manually verify: expand/collapse works independently at each nesting level.
  - [x] 🟩 Manually verify: search results still surface meetings inside nested folders correctly.

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
