# Folder Drag-and-Drop Hit Testing Fix Plan

**Overall Progress:** `92%`

## TLDR

Most of the folder drag behavior is now correct, but two hit-testing problems remain:

1. Root insertion between folders works, but the blue dashed slot appears slightly below the visual gap.
2. Folder nesting only reliably detects some folder headers, especially the top folder, while lower target folders often do not become the active drop target.

The root cause is frontend geometry, not backend persistence. The current implementation uses real full-width DOM blocks for root insertion slots and a narrow pointer-only header target for folder nesting. Those targets do not consistently match the user’s perceived drag intent.

The fix is to make root insertion zones straddle the boundary between folders and make folder nesting detection use the dragged item’s overlap with folder headers, not only the pointer’s exact pixel.

## Expected End Result

When this plan is executed correctly:

* Dragging a nested folder between two top-level folders shows the blue dashed slot when the cursor is directly in the visible gap, not slightly below it.
* Dragging a folder onto any visible folder header, including lower folders, reliably highlights that folder and nests into it on drop.
* Root insertion still works above the first folder, between folders, and below the last folder.
* Top-level folder reorder still works.
* A folder dropped on a folder header nests; a folder dropped in the gap between folders becomes/reorders as a root folder.
* The interactions that already passed user testing remain intact.

## Current Root Cause Analysis

### 1. Root insertion between folders works, but the hit area is visually offset

**Observed behavior:** Moving a nested folder between two parent folders works, but the user has to hover slightly below the apparent gap before the dashed rectangle appears.

**Primary root cause:** `RootFolderInsertZone` is rendered as a normal in-flow block after the previous root folder. Its inactive hit area is `h-4`, and its active placeholder expands to `h-10 py-1`. Because the zone starts after the previous folder/subtree instead of straddling the boundary between the two folders, the effective hit area is biased downward from the perceived gap.

Relevant code:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1204) renders the first root insertion zone.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1245) renders each between-folder insertion zone after the previous root folder.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:1828) renders the insertion zone as a real block with `h-4` inactive and `h-10` active.

This is why the target feels slightly lower than expected: the drop target is not centered on the boundary the user is aiming at.

### 2. Nesting into lower folders is unreliable

**Observed behavior:** Dropping into the top folder works, but dropping the bottom-most folder into the second-bottom-most folder often does not detect the intended target.

**Primary root cause:** The custom collision detector only accepts a folder nesting target when `pointerWithin` says the cursor itself is inside the header droppable. That is too strict for drag-and-drop, because the visible dragged folder can overlap a target header while the cursor is still slightly above, below, or inside a nearby root insertion zone.

Relevant code:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:243) uses `pointerWithin(args)` as the first collision source.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:253) only returns `folder-nest-target` collisions found by pointer position.
* [FolderItem.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/FolderItem.tsx:89) attaches the folder nesting target to the header only.

Header-only nesting is the right direction, but pointer-only detection makes the header feel too hard to hit. This gets worse for lower folders because the dragged item, scroll position, and insertion zones make it easier for the cursor to land near the boundary rather than inside the exact header rectangle.

### 3. Root insertion zones currently steal priority near folder headers

**Observed behavior:** When attempting to nest into lower folders, the UI does not always highlight the intended folder.

**Contributing root cause:** The collision detector gives root insertion zones first priority whenever the cursor is inside one:

* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:246) filters root insertion collisions.
* [Sidebar/index.tsx](/Users/rling/Documents/Vibing/adamant/frontend/src/components/Sidebar/index.tsx:249) immediately returns root insertion collisions before checking folder headers.

This is good for avoiding accidental nesting during root promotion, but it is too blunt near a folder header. If the cursor is in a nearby insertion strip while the dragged row visually overlaps the target header, the interaction becomes root insertion/reorder instead of nesting.

### 4. The backend is not the failing layer

The previous backend changes already support:

* root reorder,
* nested-to-root at first/middle/last positions,
* moving folders under another parent,
* rejecting cycles.

The current failures are about which `overData.type` the frontend chooses before calling the backend. No schema or repository changes should be required for this fix.

## Critical Decisions

* **Keep explicit target types:** Preserve `root-folder-insert`, `folder-nest-target`, and `root-folder-sort`. The type separation fixed the disappearing-folder bug and should remain.
* **Make root insert zones boundary-centered:** A root insertion hit area should straddle the visual boundary between root folders rather than sit below it.
* **Use overlap-based nesting detection:** Folder nesting should activate when the dragged item meaningfully overlaps a folder header, even if the pointer is a few pixels outside the header.
* **Keep folder nesting header-only:** Do not make the entire expanded folder subtree droppable again; that would reintroduce accidental nesting into parent folders.
* **Prefer header nesting over insertion when overlap is strong:** If the dragged row overlaps a folder header enough, nesting should win. If the cursor is clearly in the gap, root insertion should win.
* **Do not touch persistence unless verification exposes a backend issue:** The remaining problems are UI hit-testing issues.

## Tasks

- [x] 🟩 **Step 1: Instrument Drag Target Classification Temporarily**
  - [x] 🟩 Add gated logging for folder drags showing `active.type`, `active.folderId`, `over.id`, `over.data.type`, and the resulting API call.
  - [x] 🟩 Include target index or target folder ID in the log.
  - [x] 🟩 Gate logging behind `localStorage['adamant-debug-folder-dnd'] = 'true'` so normal usage stays quiet.

- [x] 🟩 **Step 2: Make Root Insert Zones Visually Centered On Boundaries**
  - [x] 🟩 Change `RootFolderInsertZone` so its inactive hit area is centered around the visual boundary instead of occupying only the space below the previous item.
  - [x] 🟩 Use negative vertical margins or an inner absolutely-positioned visual line so the dashed rectangle appears exactly where the user expects the slot.
  - [x] 🟩 Preserve enough hit height for usability, especially the final bottom slot above Meeting Notes.
  - [x] 🟩 Verify the active placeholder still pushes folders apart when hovered.

- [x] 🟩 **Step 3: Separate Hit Area From Visual Placeholder**
  - [x] 🟩 Keep the droppable hit area forgiving.
  - [x] 🟩 Keep the dashed rectangle visually aligned with the boundary/gap.
  - [x] 🟩 Avoid letting the invisible hit area create a visible offset in the list layout.
  - [x] 🟩 Ensure no layout buzzing returns when the placeholder expands.

- [x] 🟩 **Step 4: Add Overlap-Based Folder Header Detection**
  - [x] 🟩 Import `rectIntersection` or implement a small local rectangle-overlap helper using dnd-kit droppable rects.
  - [x] 🟩 In the custom collision detector, compute folder header collisions from dragged-item overlap, not just pointer location.
  - [x] 🟩 Require a meaningful overlap threshold so a nearby header does not steal root insertion when the user is clearly in a gap.
  - [x] 🟩 Keep pointer-over header as an immediate valid nesting signal.

- [x] 🟩 **Step 5: Refine Collision Priority**
  - [x] 🟩 If the pointer is directly inside a folder header, return the `folder-nest-target`.
  - [x] 🟩 Else, if the pointer is inside a root insertion zone, return `root-folder-insert`.
  - [x] 🟩 Else, if the dragged row meaningfully overlaps a folder header, return the `folder-nest-target`.
  - [x] 🟩 Else, fall back to `closestCenter` for top-level sortable reorder behavior.

- [x] 🟩 **Step 6: Preserve Existing Good Paths**
  - [x] 🟩 Confirm top-level folder reordering still routes through `root-folder-sort` or `root-folder-insert`.
  - [x] 🟩 Confirm nested-to-root above the first folder still routes to `root-folder-insert:0`.
  - [x] 🟩 Confirm nested-to-root below the last folder still routes to `root-folder-insert:${rootFolders.length}`.
  - [x] 🟩 Confirm meeting-to-folder still uses `folder-nest-target`.
  - [x] 🟩 Confirm meeting-to-unfiled still uses `meeting-root-target`.

- [x] 🟩 **Step 7: Add Focused Automated Checks Where Possible**
  - [x] 🟩 Keep existing Rust repository tests unchanged.
  - [x] 🟩 Add a small pure rectangle helper for overlap scoring.
  - [x] 🟩 Keep final collision behavior inside dnd-kit because it depends on runtime droppable containers and measured DOM rects; manual QA is the meaningful verification for the visual hit zones.

- [ ] 🟨 **Step 8: Verification**
  - [x] 🟩 Run `pnpm exec tsc --noEmit --pretty false`.
  - [x] 🟩 Run `cargo test database::repositories::folder::tests`.
  - [x] 🟩 Run `pnpm run build`.
  - [x] 🟩 Run `git diff --check`.
  - [x] 🟩 Launch Adamant Dev.
  - [ ] 🟥 Test parent folder reorder.
  - [ ] 🟥 Test nested folder to root above first parent.
  - [ ] 🟥 Test nested folder to root between parents and verify the dashed slot appears directly in the perceived gap.
  - [ ] 🟥 Test nested folder to root bottom.
  - [ ] 🟥 Test nesting into the top folder.
  - [ ] 🟥 Test nesting into a middle folder.
  - [ ] 🟥 Test nesting into the second-bottom-most folder.
  - [ ] 🟥 Test nesting a nested folder into another non-top folder.

## Verification Criteria

This fix is complete only when:

* The dashed insertion slot appears where the user is visually aiming, not lower than the gap.
* Every visible folder header is a reliable nesting target.
* The top folder is not special; lower folders behave the same.
* Root insertion and folder nesting remain visually distinguishable.
* The four interactions that already passed continue to pass.
* No folder disappears or moves into an unintended folder.

## Risks And Edge Cases

* **Overlap detection can be too eager:** If the threshold is too low, folder headers may steal drops that were intended for root insertion. The plan includes an explicit threshold to avoid this.
* **Insertion zones can become too small:** If visual alignment removes too much hit area, the root promotion interaction may regress. Keep the hit area forgiving even if the visual rectangle is boundary-centered.
* **Expanded folders change geometry:** Expanded children should not be nesting targets for the parent. Header-only droppables remain important.
* **Scroll position matters:** Lower-folder nesting should be tested with enough folders that the sidebar is scrolled or near the bottom.
* **Top-level folder sortables wrap full subtrees:** Collision fallback must not let the full sortable subtree override a header-level nesting target.

## Out Of Scope

* Reordering nested sibling folders.
* Redesigning the folder sidebar.
* Keyboard drag-and-drop.
* Changing database schema or folder persistence behavior.

**Status Tracking:**

* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
