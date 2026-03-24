# ADA-3: Autosave blank editor after new note creation

When a user creates a new note and the first autosave fires, typed content disappears and the editor goes blank even though the database has the correct data. Root cause: `editor.replaceBlocks()` is never called after DB load on remount; refs from ADA-2 do not survive unmount.

Details and fix are in `plan.md`.
