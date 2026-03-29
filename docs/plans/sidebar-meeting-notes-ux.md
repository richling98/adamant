# Feature Implementation Plan: Sidebar Meeting Notes UX Fixes

**Overall Progress:** `100%`

## TLDR
Two small UX fixes in `Sidebar/index.tsx`: move "Meeting Notes" above "By Date" in the sidebar order, and make the "+" new note button always visible on the Meeting Notes header instead of hover-only.

## End Result
The sidebar order is: **Folders → Meeting Notes → By Date**. The "+" button on the Meeting Notes header is always visible (matching the always-visible folder-plus icon on the Folders header), so users can create a new note without having to hover first.

## Critical Decisions
* **Always-visible + matches Folders pattern:** The Folders header already has an always-visible `FolderPlus` button. Meeting Notes should match this — remove the `isMeetingNotesHeaderHovered` guard and the hover state that drives it.
* **No state cleanup needed for `isMeetingNotesHeaderHovered`:** The hover state is also used to suppress `onMouseEnter`/`onMouseLeave` — removing the guard and the hover state entirely is the cleanest fix.

## Tasks

- [x] 🟩 **Step 1: Reorder — move Meeting Notes block before By Date block**
  - [x] 🟩 In `Sidebar/index.tsx`, cut the entire "Meeting Notes" section (header + collapsible content) and paste it immediately after the `</div>{/* end collapsible folders wrapper */}` line, before the "By Date" section

- [x] 🟩 **Step 2: Make Meeting Notes "+" always visible**
  - [x] 🟩 Remove the `{isMeetingNotesHeaderHovered && (...)}` conditional wrapper around the `<button>` — render the button unconditionally
  - [x] 🟩 Remove the `onMouseEnter` / `onMouseLeave` handlers from the Meeting Notes header div (no longer needed)
  - [x] 🟩 Remove the `isMeetingNotesHeaderHovered` state declaration (now unused)

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
