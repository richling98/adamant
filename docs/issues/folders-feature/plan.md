# Feature Implementation Plan: Sidebar Folders

**Overall Progress:** `90%`

## TLDR

Add a one-level folder system to the sidebar so users can organize meetings into named groups. User-created folders appear at the top under a "Folders" section; unfiled meetings appear below under "Meeting Notes". Meetings can be dragged into folders. Each folder has a "+" to start a new meeting pre-assigned to it. Folders can be renamed inline (double-click) and deleted (meetings move to root, not deleted).

## UI Mockup

```
┌─────────────────────────────────┐
│  Adamant              [Settings]│
├─────────────────────────────────┤
│  [Search meetings...          ] │
│                                 │
│  [+ Start Meeting             ] │
│                                 │
│  Folders              [+ Folder]│
│  ─────────────────────────────  │
│                                 │
│  📁 Q1 Reviews           (3) + │  ← user-created folder
│    └─ Kickoff Call              │     (collapsed/expanded)
│    └─ Sprint Planning           │
│    └─ Retro                     │
│                                 │
│  📁 Client - Acme        (1) + │  ← folder with "+" to add meeting
│    └─ Sales Call                │     trash icon on hover
│                                 │
│  📁 Personal             (0) + │  ← empty folder
│                                 │
│  Meeting Notes                  │
│  ─────────────────────────────  │
│  Unfiled Meeting 1              │  ← unfiled meetings below folders
│  Unfiled Meeting 2              │
│  Unfiled Meeting 3              │
│                                 │
└─────────────────────────────────┘

Drag behaviour:
  - Drag any meeting row → hover over a folder → drop to assign
  - Drag a meeting out of a folder → drop on the unfiled zone below
  - Dragged item shows reduced opacity; target folder highlights

Rename (double-click folder name):
  📁 [Q1 Reviews_         ] (3) +   ← inline <input>, Enter to save, Esc to cancel

Collapsed sidebar (icon-only mode):
  📁   ← folder icon with tooltip showing folder name
  📁
  📁
  ──
  •    ← unfiled meeting dots
  •
```

## Design Decisions

- **One level only** — no nested folders; simpler to build, sufficient for organizing meetings
- **Folder deletion** — moves contained meetings to root (no data loss)
- **Unfiled meetings** — render flat at the bottom of the sidebar, below all folders
- **Inline rename** — double-click a folder name to edit it in place
- **DB approach** — new `folders` table + `folder_id` FK column on `meetings` (via sqlx migration). The existing `folder_path` field on `MeetingModel` is left as-is; it's unused in the UI
- **Drag-and-drop** — `@dnd-kit/core` (modern, accessible, actively maintained)
- **New meeting in folder** — clicking "+" on a folder navigates to the new meeting page, then immediately moves the meeting into that folder once it's created (via a `pendingFolderId` in context, or by passing a `folder_id` query param and calling `api_move_meeting_to_folder` post-creation)

## Architecture Overview

```
SQLite
  folders (id, name, created_at, updated_at)
  meetings (... existing ..., folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL)

Rust
  database/models.rs        — FolderModel struct; add folder_id to MeetingModel
  database/repositories/
    folder.rs               — CRUD: create, get_all, rename, delete
    meeting.rs              — add update_meeting_folder()
  api/api.rs                — Folder type, request types, 5 new Tauri commands
  lib.rs                    — register new commands

Frontend
  SidebarProvider           — fetch folders, enrich meetings with folder_id, expose API
  Sidebar/index.tsx         — render unfiled flat + folders below; drag-and-drop; rename
  (new) FolderItem.tsx      — folder row component with collapse, rename, "+" button
  page.tsx / meeting flow   — handle pendingFolderId after new meeting creation
  pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

---

## Tasks

- [x] 🟩 **Step 1: Database Migration**
  - [x] 🟩 Create `frontend/src-tauri/migrations/<timestamp>_add_folders.sql`
  - [x] 🟩 SQL: `CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`
  - [x] 🟩 SQL: `ALTER TABLE meetings ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL`
  - [x] 🟩 Verify migration file name follows existing naming convention (e.g. `20260101000000_add_folders.sql`)

- [x] 🟩 **Step 2: Rust — Data Models**
  - [x] 🟩 In `database/models.rs`, add `FolderModel` struct with `sqlx::FromRow` derive: `id: String`, `name: String`, `created_at: DateTimeWrapper`, `updated_at: DateTimeWrapper`
  - [x] 🟩 Add `folder_id: Option<String>` field to `MeetingModel` struct (the sqlx query already uses `SELECT *` so it'll pick it up from the new column)
  - [x] 🟩 Verify `MeetingModel` SELECT queries that name columns explicitly (e.g. in `meeting.rs` line 65, 123) also include `folder_id`

- [x] 🟩 **Step 3: Rust — Folders Repository**
  - [x] 🟩 Create `frontend/src-tauri/src/database/repositories/folder.rs`
  - [x] 🟩 Implement `FoldersRepository::create_folder(pool, id, name)` — INSERT into folders
  - [x] 🟩 Implement `FoldersRepository::get_all_folders(pool)` — SELECT * FROM folders ORDER BY created_at ASC
  - [x] 🟩 Implement `FoldersRepository::rename_folder(pool, folder_id, new_name)` — UPDATE folders SET name = ?, updated_at = ?
  - [x] 🟩 Implement `FoldersRepository::delete_folder(pool, folder_id)` — two-step: `UPDATE meetings SET folder_id = NULL WHERE folder_id = ?` then `DELETE FROM folders WHERE id = ?` (in a transaction)
  - [x] 🟩 Implement `MeetingsRepository::update_meeting_folder(pool, meeting_id, folder_id: Option<String>)` — UPDATE meetings SET folder_id = ?, updated_at = ?
  - [x] 🟩 Export `FoldersRepository` from `database/repositories/mod.rs`

- [x] 🟩 **Step 4: Rust — API Types + Tauri Commands**
  - [ ] 🟥 In `api/api.rs`, add types:
    - `Folder { id: String, name: String, created_at: String, updated_at: String }`
    - `CreateFolderRequest { name: String }`
    - `RenameFolderRequest { folder_id: String, name: String }`
    - `MoveMeetingRequest { meeting_id: String, folder_id: Option<String> }`
  - [ ] 🟥 Add `folder_id: Option<String>` to the `Meeting` struct (so the frontend knows which folder a meeting belongs to)
  - [ ] 🟥 Update `api_get_meetings` to map `m.folder_id` into the returned `Meeting` struct
  - [ ] 🟥 Implement `api_get_folders` command — calls `FoldersRepository::get_all_folders`
  - [ ] 🟥 Implement `api_create_folder` command — generates UUID, calls `FoldersRepository::create_folder`
  - [ ] 🟥 Implement `api_rename_folder` command — calls `FoldersRepository::rename_folder`
  - [ ] 🟥 Implement `api_delete_folder` command — calls `FoldersRepository::delete_folder` (meetings move to root in the same transaction)
  - [ ] 🟥 Implement `api_move_meeting_to_folder` command — calls `MeetingsRepository::update_meeting_folder` (pass `None` to unfile)
  - [ ] 🟥 Register all 5 new commands in `lib.rs` `invoke_handler`

- [x] 🟩 **Step 5: Frontend — Install dnd-kit**
  - [ ] 🟥 `cd frontend && pnpm add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`
  - [ ] 🟥 Confirm packages appear in `package.json`

- [x] 🟩 **Step 6: Frontend — SidebarProvider Updates**
  - [ ] 🟥 Update the `Meeting` TypeScript type in `SidebarProvider.tsx` to include `folder_id?: string | null`
  - [ ] 🟥 Add `folders: Folder[]` state and `setFolders` to the provider
  - [ ] 🟥 Add `Folder` TypeScript interface: `{ id: string; name: string; created_at: string; updated_at: string }`
  - [ ] 🟥 Add `fetchFolders` async function calling `invoke('api_get_folders')`
  - [ ] 🟥 Call `fetchFolders()` in initial data load (alongside `fetchMeetings`)
  - [ ] 🟥 Update `baseItems` / `setSidebarItems` logic:
    - Each folder → one `SidebarItem` with `type: 'folder'` and `children` = meetings in that folder, ordered by `created_at` ASC, rendered first
    - Unfiled meetings (no `folder_id`) → flat `SidebarItem[]` appended after all folders
  - [ ] 🟥 Expose via context: `folders`, `fetchFolders`, `createFolder`, `renameFolder`, `deleteFolder`, `moveMeetingToFolder`
  - [ ] 🟥 Add `pendingFolderId: string | null` state + setter to context (used when creating a new meeting inside a folder)

- [x] 🟩 **Step 7: Frontend — FolderItem Component**
  - [ ] 🟥 Create `frontend/src/components/Sidebar/FolderItem.tsx`
  - [ ] 🟥 Props: `folder: Folder`, `children: SidebarItem[]`, `isCollapsed: boolean` (sidebar collapsed state)
  - [ ] 🟥 Render a row with: collapse chevron, folder icon, folder name, meeting count badge, "+" button
  - [ ] 🟥 Folder name is an `<input>` when in rename mode, `<span>` otherwise
  - [ ] 🟥 Double-click on name → enter rename mode; blur or Enter → call `renameFolder` and exit rename mode; Escape → cancel
  - [ ] 🟥 "+" button → call `setPendingFolderId(folder.id)` then navigate to home to trigger new meeting
  - [ ] 🟥 Trash icon (visible on hover) → call `deleteFolder(folder.id)` with confirmation toast
  - [ ] 🟥 Collapse/expand state stored locally in component (or in a `collapsedFolders: Set<string>` in context)
  - [ ] 🟥 When sidebar is collapsed (icon-only mode), show only the folder icon with tooltip

- [x] 🟩 **Step 8: Frontend — Sidebar Rendering + Drag-and-Drop**
  - [ ] 🟥 In `Sidebar/index.tsx`, import `DndContext`, `useDroppable`, `useDraggable` from `@dnd-kit/core`
  - [ ] 🟥 Wrap the meeting list area in `<DndContext onDragEnd={handleDragEnd}>`
  - [ ] 🟥 Make each unfiled meeting item `useDraggable` with `id = meeting.id`
  - [ ] 🟥 Make each meeting inside a folder `useDraggable` with `id = meeting.id`
  - [ ] 🟥 Make each folder's drop zone `useDroppable` with `id = folder.id`
  - [ ] 🟥 Add an "unfiled" drop zone (e.g. `id = 'root'`) at the top so meetings can be moved back out of folders
  - [ ] 🟥 `handleDragEnd`: if `over.id === 'root'` → `moveMeetingToFolder(meeting.id, null)`; else → `moveMeetingToFolder(meeting.id, folder.id)` then `fetchMeetings` + `fetchFolders`
  - [ ] 🟥 Add drag visual feedback (opacity on dragged item, highlight on droppable folder when hovered)
  - [ ] 🟥 Add "New Folder" "+" icon button in the sidebar header area next to the "Folders" section label
  - [ ] 🟥 Clicking "New Folder" → inline name input appears → on Enter/blur with non-empty name → `createFolder(name)` → `fetchFolders()`
  - [ ] 🟥 Render `<FolderItem>` for each folder first, then unfiled meetings flat below them

- [x] 🟩 **Step 9: Frontend — New Meeting in Folder Flow**
  - [x] 🟩 In `useRecordingStop.ts`, after `meetingId` is confirmed from `storageService.saveMeeting()`, check `pendingFolderId` from `useSidebar` context
  - [x] 🟩 If `pendingFolderId` is set: call `invoke('api_move_meeting_to_folder', { meetingId, folderId: pendingFolderId })`, then clear `pendingFolderId` via `setPendingFolderId(null)`
  - [x] 🟩 After move: `refetchMeetings()` already called below, so sidebar updates correctly
  - [x] 🟩 Handle edge case: if save fails, clear `pendingFolderId` in the catch block without calling move

- [ ] 🟥 **Step 10: Verification (Manual)**
  - [ ] 🟥 Create a folder — appears in sidebar below unfiled meetings
  - [ ] 🟥 Drag an unfiled meeting into the folder — meeting moves into folder, folder shows meeting count
  - [ ] 🟥 Drag a meeting back out of a folder to root — meeting becomes unfiled again
  - [ ] 🟥 Click "+" on a folder — new meeting is created and appears under that folder
  - [ ] 🟥 Double-click a folder name — rename inline works, persists after reload
  - [ ] 🟥 Delete a folder — meetings inside become unfiled (not deleted), folder disappears
  - [ ] 🟥 App restart — folder structure and meeting assignments persist correctly

---

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do
