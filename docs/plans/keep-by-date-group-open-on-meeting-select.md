# Feature Implementation Plan

**Overall Progress:** `100%`

## TLDR
When a user opens a date group in the sidebar's "By Date" section and clicks a meeting note under that date, the meeting should open without collapsing that date group. The likely fix is to make the per-date expanded groups real React state initialized from `localStorage`, instead of deriving expansion directly from `localStorage` through `getDateGroupExpanded()` on each render.

## Current Behavior
In [frontend/src/components/Sidebar/index.tsx](../../frontend/src/components/Sidebar/index.tsx), the "By Date" section:

- Stores each date group's expanded/collapsed value in `localStorage` using keys like `sidebar-by-date-group-5/13/2026`.
- Reads expansion through `getDateGroupExpanded(dateLabel)` during render.
- Uses `dateGroupToggle` only as a dummy counter to force re-renders after header toggles.
- Navigates meeting rows with `setCurrentMeeting(...)` and `router.push(...)`.

That means the UI has no direct React state representing "these date groups are open", so navigation-related renders can cause the visible group state to fall back unexpectedly.

## Desired Behavior
Clicking a meeting inside an expanded date group should:

- Select/open the meeting note.
- Keep the date group expanded.
- Preserve the existing persisted expand/collapse behavior across app restarts.
- Avoid changing folder drag-and-drop, date bulk selection, delete actions, or search behavior.

## Critical Decisions
* **Use React state for expanded date groups** - Keep a `Set<string>` of expanded date labels in component state so normal rerenders and meeting selection do not recompute expansion from storage alone.
* **Keep `localStorage` persistence** - Initialize the set from existing `sidebar-by-date-group-*` keys and write updates back when a date header is toggled.
* **Do not change meeting-row navigation** - The current `SidebarMeetingRow` used by By Date is already non-draggable; the bug is about preserving group expansion, not row drag behavior.
* **Keep the change in one file** - This should only need [frontend/src/components/Sidebar/index.tsx](../../frontend/src/components/Sidebar/index.tsx).

## Tasks

- [x] 🟩 **Step 1: Reproduce and confirm the failing path**
  - [x] 🟩 Open Adamant locally.
  - [x] 🟩 In the sidebar, expand "By Date", expand one date group, then click a meeting under it.
  - [x] 🟩 Confirm the behavior path with an automated local browser check.

- [x] 🟩 **Step 2: Replace dummy date-group rerender state with explicit expanded-group state**
  - [x] 🟩 In `Sidebar/index.tsx`, replace `dateGroupToggle` with `expandedDateGroups: Set<string>`.
  - [x] 🟩 Initialize `expandedDateGroups` from `localStorage` by scanning `meetings` date labels and adding labels whose stored value is `'true'`.
  - [x] 🟩 Keep the default for date groups collapsed when no stored value exists.
  - [x] 🟩 Update `toggleDateGroup(dateLabel)` to mutate the set and persist the new value to `localStorage`.

- [x] 🟩 **Step 3: Render By Date groups from React state**
  - [x] 🟩 Change `const isGroupExpanded = getDateGroupExpanded(dateLabel)` to read from `expandedDateGroups.has(dateLabel)`.
  - [x] 🟩 Confirm the meeting-row `onNavigate` handler only calls `setCurrentMeeting` and `router.push`, with no collapse-state mutation.

- [x] 🟩 **Step 4: Verify the behavior**
  - [x] 🟩 Expand a date group and click a meeting note under that date; the group stays open after navigation.
  - [x] 🟩 Confirm the expanded state persists in `localStorage`.
  - [x] 🟩 Confirm the meeting-row navigation path does not mutate date group expansion state.
  - [x] 🟩 Run frontend verification: `pnpm exec tsc --noEmit` and `pnpm run build`.

## Verification Performed
- `pnpm run lint` was attempted, but this repo's script currently fails because `next lint` is not supported by the installed Next CLI and is interpreted as an invalid `frontend/lint` directory.
- `pnpm exec tsc --noEmit` passed.
- `pnpm run build` passed after allowing the build to fetch Google Fonts.
- Automated local UI check passed via Next dev server + headless Chrome with mocked Tauri commands:
  - Rendered the real sidebar.
  - Expanded the sidebar and a By Date group for `5/13/2026`.
  - Clicked `Alpha note`.
  - Confirmed navigation to `/meeting-details?id=11111111-1111-4111-8111-111111111111`.
  - Confirmed the date group row stayed visible after navigation and `localStorage["sidebar-by-date-group-5/13/2026"]` remained `'true'`.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

## Assumptions
- The user wants only the expanded date group to remain open; no changes to the top-level "By Date" section default are intended.
- The date label format should remain unchanged to preserve existing stored expansion preferences.
