# ADA-5: Meeting-First Recording Flow

**Overall Progress:** `100%`

## Context

Meetings are now the primary object. Recording is an optional attachment that starts only from an active new-meeting session, instead of creating a meeting from the home page recording controls.

## Critical Decisions

- "Start Recording" is gated by `isMeetingPage && isMeetingActive`.
- Meeting creation remains lazy (first note save or recording start).
- `pendingMeetingId` flow is preserved for attaching recordings to the current meeting.
- Home-page recording auto-start path (`mode=recording`) is removed.

## Tasks

- [x] ✅ **Step 1: Home Page Simplification (`frontend/src/app/page.tsx`)**
  - [x] ✅ Keep only a single **Start New Meeting** button
  - [x] ✅ Ensure button sets `setIsMeetingActive(true)` then navigates to `/meeting-details?id=new`
  - [x] ✅ Remove home-page recording controls flow

- [x] ✅ **Step 2: Sidebar Recording Button Gating (`frontend/src/components/Sidebar/index.tsx`)**
  - [x] ✅ Gate both collapsed and expanded recording buttons behind:
    - `pathname?.includes('/meeting-details') && isMeetingActive`
  - [x] ✅ Keep recording start/stop behavior unchanged

- [x] ✅ **Step 3: SidebarProvider Recording Toggle Cleanup (`frontend/src/components/Sidebar/SidebarProvider.tsx`)**
  - [x] ✅ Remove fallback navigation path that auto-opened new meeting with recording
  - [x] ✅ Keep event-dispatch start path on current meeting page

- [x] ✅ **Step 4: Meeting Page Session Cleanup (`frontend/src/app/meeting-details/page.tsx`)**
  - [x] ✅ Reset `isMeetingActive` on meeting page unmount
  - [x] ✅ Reset `isMeetingActive` when navigating from active new-meeting flow to a historical meeting
  - [x] ✅ Keep active session true for `id=new` and autosave new→real meeting transition

- [x] ✅ **Step 5: Remove Leftover URL Auto-Start (`frontend/src/app/meeting-details/page.tsx`, `page-content.tsx`)**
  - [x] ✅ Remove `mode=recording` query-param plumbing
  - [x] ✅ Remove `autoStartRecording` prop/effect from meeting page content

## Verification Checklist

- [x] ✅ Home page shows only **Start New Meeting**
- [x] ✅ New meeting shows sidebar **Start Recording**
- [x] ✅ Historical meetings do not show recording button
- [x] ✅ Leaving meeting page clears active-session state
- [x] ✅ Recording remains attached to current meeting via `pendingMeetingId`
- [x] ✅ `pnpm tsc --noEmit` passes
