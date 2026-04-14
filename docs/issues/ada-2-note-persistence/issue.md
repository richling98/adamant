# ADA-2: Note persistence bug

## Context

**Problem**: When users create a manual note and type content, the auto-save (2-second debounce) successfully saves to the database but the typed content immediately disappears from the editor, replaced with a blank note.

**Root Cause**: After a new note is saved, the app calls `router.replace()` to update the URL from `?id=new` to `?id=meeting-abc123`. This URL change triggers React to update the `meetingId` and `isNewNote` props passed to NotesPanel. When these props change, NotesPanel's `useEffect([meetingId, isNewNote])` dependency array fires, causing the component to reinitialize its state.

The critical issue is that `useCreateBlockNote()` is called on every render with an `initialContent` prop. When the props change after save, the editor is recreated with outdated or empty initial content, losing the user's typed text even though it was saved to the database.

**Why Previous Fixes Failed**:
- `justSavedRef` flag: Prevents database reload but doesn't prevent editor recreation with stale content
- `useEffect` to update editor: Caused infinite loop (594,700+ messages)
- Sidebar refresh: Helps but doesn't address the editor content loss

**User Requirement**: High confidence solution — no more guessing; must address the actual root cause.

Implementation approach and execution history are in `plan.md`.
