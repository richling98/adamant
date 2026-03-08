# Feature Implementation Plan

**Overall Progress:** `85%`

## TLDR
Clean up the three-pane meeting UI so it feels visually unified: use consistent pane headers (`My Notes`, `Transcript`, `AI notes`), align the header divider at one exact horizontal level across all panes, and remove the darker inner summary surface so content sits directly on the standard pane background like Notes.

## ASCII Mockup (Target UI)
```text
+---------------------------+---------------------------+---------------------------+
| My Notes                  | Transcript                | AI notes                  |
| Saved 22s ago             | [Copy] [Generate AI...]   |                           |
+---------------------------+---------------------------+---------------------------+
|                           |                           |                           |
| note content...           | [00:00] transcript line   | summary heading           |
|                           | [00:05] transcript line   | summary bullets...        |
|                           | [00:12] transcript line   | action items...           |
|                           |                           |                           |
| (no dark inset surface)   |                           | (no dark inset surface)   |
|                           |                           |                           |
+---------------------------+---------------------------+---------------------------+
```

## My Understanding Of Your Request
- You want all three pane headers to look intentional and consistent.
- You want one continuous horizontal divider across the top content boundary, not three slightly misaligned lines.
- You want the summary content area to stop rendering inside a darker inset box and instead blend with the same background style as the notes pane.
- You want header titles renamed to:
  - `My Notes`
  - `Transcript`
  - `AI notes`

## Root Cause Snapshot
- Each pane currently renders its own header with different content and effective height:
  - Notes header includes title + saved timestamp.
  - Transcript header is button-only.
  - Summary header is mostly empty.
- Because each pane draws its own `border-b`, those borders render at different vertical positions.
- The AI summary content includes inner surfaces (BlockNote defaults and fallback/status cards) with darker backgrounds, creating the “boxed-in” look.

## Critical Decisions
* **Decision 1:** Standardize all pane headers to a shared fixed-height header container (`h-*` + shared padding) so the divider lands on the same Y-position in every pane.
* **Decision 2:** Keep pane-level `border-b` but enforce identical header geometry across panes; this gives the visual effect of one continuous line while preserving existing layout boundaries.
* **Decision 3:** Apply summary-specific “transparent surface” CSS overrides (similar to notes) so BlockNote and fallback views blend into the base pane background.
* **Decision 4:** Keep existing functionality and controls (copy, generate/stop summary, saving indicator) while only restructuring presentation.

## Tasks

- [x] ✅ **Step 1: Introduce a shared pane-header style contract**
  - [x] ✅ Define a reusable header class pattern (height, vertical centering, padding, border treatment) used by Notes, Transcript, and Summary panes.
  - [x] ✅ Refactor panel header wrappers in:
    - `frontend/src/components/NotesPanel.tsx`
    - `frontend/src/components/MeetingDetails/TranscriptPanel.tsx`
    - `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
  - [x] ✅ Confirm the divider line aligns at one exact horizontal level across all three panes.
  - Plain-English: make all three top bars the same height so the separator line is straight across.
  - Update (2026-03-03 23:45:54 PST): Added shared pane header contract in `frontend/src/components/MeetingDetails/paneHeaderStyles.ts` and wired all three panes to `h-20` + shared border/padding classes.

- [x] ✅ **Step 2: Rename and normalize pane header titles**
  - [x] ✅ Update Notes header label from `Meeting Notes`/`New Note` display text to `My Notes`.
  - [x] ✅ Add explicit Transcript pane title `Transcript` in the header, while keeping action buttons.
  - [x] ✅ Add explicit Summary pane title `AI notes`.
  - [x] ✅ Preserve existing secondary info where useful (e.g., saved timestamp in notes).
  - Plain-English: make the section names exactly what you requested and present them consistently.
  - Update (2026-03-03 23:45:54 PST): Header copy updated in Notes/Transcript/Summary panes; notes saved indicator retained.

- [x] ✅ **Step 3: Remove dark inset backgrounds from AI summary content**
  - [x] ✅ Add a summary surface wrapper class (e.g., `summary-editor-surface`) and apply transparent background overrides for BlockNote internals in `frontend/src/app/globals.css`.
  - [x] ✅ Remove or neutralize darker card-like summary wrappers in `SummaryPanel` where they conflict with the clean pane look.
  - [x] ✅ Ensure compatibility/fallback summary renderer also uses transparent background (no dark inset box).
  - Plain-English: remove the dark summary box so summary text sits directly on the normal pane background.
  - Update (2026-03-03 23:45:54 PST): Added `summary-editor-surface` transparency overrides, removed dark fallback background in `BlockNoteSummaryView`, and neutralized summary card/status backgrounds in `SummaryPanel`.

- [x] ✅ **Step 4: Keep transcript/summary header controls clean after layout update**
  - [x] ✅ Reposition transcript header controls so title and actions coexist in the new shared header layout without overlap.
  - [x] ✅ Validate loading/stop/generate states still render correctly in header controls.
  - [x] ✅ Confirm no regression in copy transcript behavior.
  - Plain-English: keep all buttons working and visually tidy after the header cleanup.
  - Update (2026-03-03 23:45:54 PST): `TranscriptButtonGroup` now supports flexible placement; transcript header now renders title + controls in one shared row.

- [ ] 🟨 **Step 5: Visual verification + regression check**
  - [x] ✅ Run `pnpm tsc --noEmit` from `frontend`.
  - [ ] 🟥 Manual UI checks:
    - three headers visible with requested names
    - divider appears as one continuous horizontal line
    - AI summary content has no darker inset background
    - generating summary still works and displays correctly
  - [ ] 🟥 Capture outcome notes in this plan doc before requesting final sign-off.
  - Plain-English: verify the UI is cleaner and nothing broke.
  - Update (2026-03-03 23:45:54 PST): Typecheck passed. Manual visual verification remains pending in running app.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.
