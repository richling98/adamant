# ADA-6: Move "Start Meeting" to Sidebar, Remove Home Page

**Type:** Improvement | **Priority:** Medium | **Effort:** Medium

## TL;DR

The home page (`/`) exists solely to display a "Start New Meeting" button. Remove it and surface that button in the sidebar footer (where the About button currently lives), giving the app a single-panel experience with no unnecessary landing screen.

## Current Behavior

- Navigating to `/` shows a dedicated home page with a centered "Start New Meeting" button
- The sidebar has a Home button that routes back to this page
- Users must land on the home page before starting a meeting

## Expected Behavior

- No dedicated home page — `/` redirects to the meetings list (or is removed)
- A "Start Meeting" button lives in the sidebar footer at the bottom-left, in the slot currently occupied by the About button
- Clicking it navigates to `/meeting-details?id=new` and fires the `start_new_meeting` analytics event
- Transcript recovery dialog (currently on the home page) is moved to a layout-level component so it still triggers on app start

## Files to Touch

1. `frontend/src/components/Sidebar/index.tsx` — Add "Start Meeting" button to footer; remove Home button; wire routing and analytics
2. `frontend/src/app/page.tsx` — Replace with redirect to meetings list; migrate transcript recovery dialog out
3. `frontend/src/components/MainContent/index.tsx` — Adjust layout if needed after home page removal

## Notes / Risks

- Transcript recovery dialog must be preserved — move to layout or a persistent provider, not deleted
- Analytics event (`start_new_meeting`) must still fire on the new sidebar button
