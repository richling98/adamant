# Issue: Folder contents always empty; drag-into-folder appears to delete meetings

Folders never show their meetings, and drag-and-drop into a folder looks like it deletes the meeting. Both share a root cause in how `folderMeetings` is derived from the sidebar item tree.

See `plan.md` for analysis and fix.
