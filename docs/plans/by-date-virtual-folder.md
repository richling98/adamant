# Feature Implementation Plan: "By Date" Virtual Folder

**Overall Progress:** `100%`

## TLDR
Add a read-only "By Date" section to the sidebar that automatically groups **all** meeting notes by their creation date (e.g. "3/24/2026"), sorted most-recent-first. Each date is a collapsible row — click to expand and see that day's notes. No adding, no dragging. Pure frontend grouping once `created_at` is exposed in the meetings API.

## Architecture Overview

**The gap:** `created_at` exists in the SQLite `MeetingModel` but the `Meeting` struct returned by `api_get_meetings()` only exposes `id`, `title`, and `folder_id`. One Rust change adds `created_at` to the API response.

**Frontend logic (pure derived state):**
- Group `meetings` by `created_at` date string (M/D/YYYY)
- Sort groups descending (newest date first)
- Render a collapsible date header per group, with non-draggable meeting rows inside
- The whole "By Date" section header is itself collapsible, with state persisted to localStorage

**What does NOT change:**
- The database schema — no new tables or columns
- User-created folders — unaffected
- Drag-and-drop — "By Date" items are navigation-only (no drag source/drop target)

## End Result

A new "By Date" section appears in the sidebar below the Folders section. It shows one collapsible row per date that has at least one meeting note (e.g. "3/24/2026 · 3"). Clicking a date expands it to reveal all meeting notes created that day. The user can click any note to open it. Nothing can be added, dragged into, or removed from this section — it's a read-only time-based view of everything. Collapsing and expanding the section (and individual dates) is remembered across app restarts.

## Critical Decisions

* **Show ALL meetings (not just unfiled):** "By Date" is a full time-based view of every note regardless of which folder it lives in. Same note may appear in a user folder and in "By Date" — this is intentional.
* **Date field: `created_at`:** The user said "each date where there was at least 1 *created* meeting note" — creation date, not last-updated.
* **Date groups default to collapsed:** With potentially many dates, defaulting to collapsed (show just the date header, click to expand) is the most usable default. The section itself defaults to expanded.
* **Purely frontend — no new DB table:** Date grouping is derived from `meetings` state in the sidebar. The only backend change is exposing `created_at` in the existing `api_get_meetings` response.
* **Non-draggable rows:** Meeting rows inside "By Date" use `DraggableMeetingRow` with drag disabled (or a plain `MeetingRow`) — no drop zone on date groups.

## Tasks

- [x] 🟩 **Step 1: Expose `created_at` in the Rust meetings API**
  - [x] 🟩 Add `created_at: String` to the `Meeting` struct in `frontend/src-tauri/src/api/api.rs`
  - [x] 🟩 Update the `api_get_meetings` SQL query (or mapping) to include `created_at` from the `meetings` table

- [x] 🟩 **Step 2: Add `created_at` to the frontend `CurrentMeeting` type**
  - [x] 🟩 Add `created_at?: string` to the `CurrentMeeting` interface in `SidebarProvider.tsx`
  - [x] 🟩 Verify the `fetchMeetings` mapping passes `created_at` through from the Tauri response

- [x] 🟩 **Step 3: Add "By Date" section to the sidebar**
  - [x] 🟩 Add `isByDateExpanded` state initialized from `localStorage.getItem('sidebar-by-date-collapsed')` (default: `true`)
  - [x] 🟩 Add `toggleByDate` handler that persists to localStorage
  - [x] 🟩 Compute `meetingsByDate`: group all meetings by `created_at` date (M/D/YYYY), sorted descending
  - [x] 🟩 Render the "By Date" section header with chevron toggle (matches Folders/Meeting Notes style)
  - [x] 🟩 For each date group, render a collapsible date row (chevron + date label + count badge) — collapsed by default, state persisted to `localStorage` keyed by date string
  - [x] 🟩 Inside each expanded date row, render a read-only meeting list using the existing `DraggableMeetingRow` with `onNavigate` wired up (no drag, no edit, no delete actions shown)

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
