# ADA-4: Consolidate Start Recording to Single Context-Aware Button

**Type:** Improvement | **Priority:** Medium | **Effort:** Medium

## TL;DR

Remove the duplicate "Start Recording" button from the top of the main content area. The single bottom-left sidebar button should be context-aware: append to the current note session if one is active, or auto-create a new session if not.

## Current Behavior

- Two "Start Recording" buttons exist (top header bar + bottom-left sidebar footer)
- Both always start a new recording session regardless of context

## Expected Behavior

- Only the bottom-left sidebar button exists
- **Active session** (`isNewNote` is true / note editor is open): pressing Start Recording appends the recording to the current session — no new session created, meeting auto-named by timestamp
- **No active session**: pressing Start Recording auto-creates a new note (auto-named by timestamp) and starts recording immediately — one-action UX

## Files to Touch

1. `frontend/src/app/meeting-details/page-content.tsx` — remove top Start Recording button (lines 244–253)
2. `frontend/src/components/Sidebar/index.tsx` — update `handleRecordingToggle` to check for active session before creating a new one
3. `frontend/src/app/meeting-details/page.tsx` — expose/pass `isNewNote` state so sidebar can read it when deciding behavior
