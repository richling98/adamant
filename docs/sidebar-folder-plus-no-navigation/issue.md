# Issue: Folder "+" button does nothing when already on a meeting-details page

## Summary

Clicking the "+" icon next to a folder in the sidebar to create a new meeting note has no visible effect when the user is currently viewing an existing meeting (`/meeting-details?id=<uuid>`). The same button works correctly when navigating from the home page (`/`).

## Steps to Reproduce

1. Open the app and navigate to any existing meeting note (URL: `/meeting-details?id=<some-uuid>`).
2. In the left sidebar, locate any folder with a "+" icon.
3. Click the "+" icon.

**Expected:** App navigates to a blank new meeting note scoped to that folder (`/meeting-details?id=new`).

**Actual:** Nothing visually happens. The page does not change. No new note is created.

## Working Path (for comparison)

1. Navigate to the home page (`/`).
2. Click the "+" icon next to any folder in the sidebar.

**Result:** App correctly navigates to `/meeting-details?id=new` and opens a blank note canvas.

## Root Cause (Preliminary)

The folder "+" button is implemented in `FolderItem.tsx`:

```typescript
const handleNewMeeting = (e: React.MouseEvent) => {
  e.stopPropagation();
  setPendingFolderId(folder.id);
  router.push('/meeting-details?id=new');
};
```

When the user is already on `/meeting-details?id=<uuid>`, `router.push('/meeting-details?id=new')` is a **same-route navigation** — only the query parameter changes. Next.js does not unmount/remount the page component; it only triggers a re-render with the new `searchParams`.

The `MeetingDetailsContent` component in `page.tsx` reads `meetingId` from `useSearchParams()` and responds to changes via `useEffect`. However, there may be a guard, race condition, or conflicting state update that prevents the "new note" initialization path from firing correctly when the component is already mounted with a real meeting ID.

Notably, the `noteSessionActive` flag (set to `true` when `showRecordingControls` is true) and the `isMeetingActive` flag may interact with sidebar rendering in a way that suppresses the navigation or causes it to be silently ignored.

This does **not** affect the sidebar footer "Start Meeting" button, which uses the same `router.push` call — suggesting the issue is specific to interactions that originate from within a folder row in the sidebar while on the meeting-details route.

## Affected Files

- `frontend/src/components/Sidebar/FolderItem.tsx` — "+" button handler (`handleNewMeeting`)
- `frontend/src/app/meeting-details/page.tsx` — `meetingId` change detection and new-note initialization effects
- `frontend/src/components/Sidebar/SidebarProvider.tsx` — `pendingFolderId` state

## Impact

Users cannot start a folder-scoped note from within an existing meeting view. They must navigate to the home page first, which breaks flow and is non-obvious.
