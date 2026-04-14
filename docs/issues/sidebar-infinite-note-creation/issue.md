# Issue: Infinite meeting creation when saving a folder note

Creating a note from a folder "+" and typing triggers repeated new meetings because `debouncedSave` holds a stale `saveNote` closure.

See `plan.md` for the full root-cause analysis and fix.
