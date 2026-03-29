# Feature Implementation Plan: Collapsible Sidebar Sections

**Overall Progress:** `100%`

## TLDR
Add collapse/expand toggles to both user-created folders and the "Meeting Notes" (unfiled) section in the sidebar. Collapse state persists across app restarts via localStorage so the user's layout preference is remembered.

## Architecture Overview

**What already exists:**
- `FolderItem.tsx` has a local `isExpanded` state (defaults to `true`) with a working chevron toggle — but resets to expanded on every reload.
- The "Meeting Notes" unfiled section in `Sidebar/index.tsx` has no collapse capability at all.

**What we're adding:**
- Persist folder collapse state to `localStorage` keyed by folder ID.
- Add collapse state + toggle to the "Meeting Notes" section, also persisted.
- Smooth CSS chevron rotation animation (framer-motion already installed but CSS transition is sufficient and consistent with existing patterns).

**Key files:**
- `frontend/src/components/Sidebar/FolderItem.tsx` — persist `isExpanded` to localStorage
- `frontend/src/components/Sidebar/index.tsx` — add collapse to "Meeting Notes" section

## End Result

When the user clicks the chevron (or header row) of any folder, the folder's meetings collapse out of view. When they click again, the meetings reappear. The same toggle exists on the "Meeting Notes" section for unfiled meetings. Collapsed/expanded state survives app restarts — if you close and reopen Adamant, every section is exactly as you left it.

## Tasks

- [ ] 🟩 **Step 1: Persist folder collapse state in FolderItem**
  - [ ] 🟩 On mount, read `localStorage.getItem('sidebar-folder-collapsed-{folder.id}')` and initialize `isExpanded` from it (default: `true` if not set)
  - [ ] 🟩 In the toggle handler, write the new value to `localStorage.setItem('sidebar-folder-collapsed-{folder.id}', ...)`
  - [ ] 🟩 Verify chevron rotates 90° when collapsed using the existing `rotate` class already in the component

- [ ] 🟩 **Step 2: Add collapse to "Meeting Notes" (unfiled) section**
  - [ ] 🟩 Add `isMeetingNotesExpanded` state in `Sidebar/index.tsx`, initialized from `localStorage.getItem('sidebar-meeting-notes-collapsed')` (default: `true`)
  - [ ] 🟩 Add a chevron button to the "Meeting Notes" section header (match the visual style of FolderItem's header)
  - [ ] 🟩 Wrap the unfiled meetings (`<UnfiledDropZone>`) in a conditional render gated on `isMeetingNotesExpanded`
  - [ ] 🟩 Persist toggle to `localStorage.setItem('sidebar-meeting-notes-collapsed', ...)`

- [ ] 🟩 **Step 3: Polish — animate the collapse**
  - [ ] 🟩 Add `transition-all duration-200` + `overflow-hidden` wrapper around the collapsible content in both components so it collapses smoothly rather than snapping

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟩 To Do
