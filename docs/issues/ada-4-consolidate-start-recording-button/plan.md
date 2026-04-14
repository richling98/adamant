# ADA-4: Consolidate Start Recording to Single Context-Aware Button

**Overall Progress:** `100%`

## Context

Two "Start Recording" buttons exist in the UI — one at the top of the meeting-details page header, one at the bottom of the sidebar. Both always start a fresh session. The goal is to remove the top duplicate and make the single bottom-left sidebar button context-aware: if a note-taking session (pencil flow) is already open, recording appends to it; otherwise, a new timestamped note session is auto-created.

## Critical Decisions

- **Active session detection via SidebarContext flag**: Add `isNoteSessionActive` / `setNoteSessionActive` to `SidebarProvider` so `page.tsx` can signal to the sidebar whether a note session is open. This follows the existing shared-context pattern.
- **Custom event to trigger recording on notes page**: When the sidebar button fires during an active session, dispatch a `start-recording-on-note` DOM event — `page-content.tsx` listens and calls its local `handleStartRecordingOnPage()`. Follows the existing `start-recording-from-sidebar` pattern used on the home page.
- **No active session → navigate to notes + recording**: Change `handleRecordingToggle` to push `/meeting-details?id=new&mode=recording` (instead of the home page). The existing `autoStartRecording` flow in `page-content.tsx` handles the rest.
- **Timestamp-based meeting title**: Change `handleStartRecordingOnPage` to create meetings as `Meeting YYYY-MM-DD_HH-mm-ss` (matching the existing home-page recording naming convention).

## Tasks

- [x] 🟩 **Step 1: Remove top "Start Recording" button**
  - [x] 🟩 In `frontend/src/app/meeting-details/page-content.tsx` lines 244–253: delete the green gradient "Start Recording" `<button>` element (the `else` branch after `isRecording` check in the header bar)

- [x] 🟩 **Step 2: Add `isNoteSessionActive` to SidebarContext**
  - [x] 🟩 In `frontend/src/components/Sidebar/SidebarProvider.tsx`: add `isNoteSessionActive: boolean` state and `setNoteSessionActive: (active: boolean) => void` to `SidebarContextType` interface and provider value
  - [x] 🟩 Update `handleRecordingToggle` to:
    - If `isNoteSessionActive` → `window.dispatchEvent(new CustomEvent('start-recording-on-note'))`
    - Else → `router.push('/meeting-details?id=new&mode=recording')`
    - Remove the old home-page navigation / `sessionStorage.setItem('autoStartRecording')` logic

- [x] 🟩 **Step 3: Register/unregister active session in `page.tsx`**
  - [x] 🟩 In `frontend/src/app/meeting-details/page.tsx`: destructure `setNoteSessionActive` from `useSidebar()`
  - [x] 🟩 Add `useEffect` watching `showRecordingControls`: call `setNoteSessionActive(true)` when it becomes true, `setNoteSessionActive(false)` on cleanup/unmount

- [x] 🟩 **Step 4: Listen for `start-recording-on-note` event in `page-content.tsx`**
  - [x] 🟩 In `frontend/src/app/meeting-details/page-content.tsx`: add a `useEffect` that calls `addEventListener('start-recording-on-note', handleStartRecordingOnPage)` on mount and removes it on unmount

- [x] 🟩 **Step 5: Auto-name meetings with timestamp**
  - [x] 🟩 In `handleStartRecordingOnPage` (`page-content.tsx` ~line 163): replace `title: 'Untitled Note'` with a timestamp title e.g. `` `Meeting ${new Date().toISOString().replace('T', '_').slice(0, 19).replace(/:/g, '-')}` ``

## Key Files

| File | Change |
|------|--------|
| `frontend/src/app/meeting-details/page-content.tsx` | Remove button (Step 1), add event listener (Step 4), timestamp title (Step 5) |
| `frontend/src/components/Sidebar/SidebarProvider.tsx` | Add `isNoteSessionActive` state + update `handleRecordingToggle` (Step 2) |
| `frontend/src/app/meeting-details/page.tsx` | Register/unregister note session on `showRecordingControls` change (Step 3) |

## Verification

1. **Remove duplicate button**: Open any note (`/meeting-details?id=new`) — confirm no green "Start Recording" button appears in the page header
2. **No active session**: From the sidebar on the home page or any meeting detail page, click "Start Recording" — should navigate to `/meeting-details?id=new`, open the note editor, and immediately start recording
3. **Active session → append**: Open a new note (pencil icon), then click "Start Recording" from the sidebar — should start recording on the existing note without navigating away or creating a new session
4. **Timestamp title**: After recording completes, confirm the meeting in the sidebar is named `Meeting YYYY-MM-DD_HH-mm-ss` not `Untitled Note`
5. **Session cleanup**: Navigate away from the note page → click "Start Recording" from sidebar → confirm it creates a new session (not tries to append to the old one)

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
