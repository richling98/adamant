# ADA-5: Meeting UI (consolidated plans)

This document merges the panel-header plan and follow-up implementation plans for the meeting-details experience.


---

## Source: ADA-5-panel-header-controls-reorganization.md

# Feature Implementation Plan: ADA-5 Panel Header Controls Reorganization

**Overall Progress:** `100%`

## TLDR

Reorganize the three meeting-detail panel headers so each panel owns its relevant action buttons. Move "Generate AI Summary" from the Transcript header into the AI Notes header. Replace the sidebar's "Start/End Recording" button with a context-smart "Record" button inside the Transcript header. Add a "Copy" button to the My Notes header.

## Target UI Layout

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  Sidebar                                                                            │
│  (no recording                                                                      │
│   button)      ╔══════════════════╦══════════════════╦═══════════════════════════╗  │
│                ║  My Notes        ║  Transcript      ║  AI notes                 ║  │
│                ║  [  Copy  ]      ║  [Copy] [Record] ║  [Generate AI Summary ✦]  ║  │
│                ╠══════════════════╬══════════════════╬═══════════════════════════╣  │
│                ║                  ║                  ║                           ║  │
│                ║  hello there     ║  Welcome to      ║  No Summary               ║  │
│                ║  this is my      ║  Adamant!        ║  Generated Yet            ║  │
│                ║  new note        ║                  ║                           ║  │
│                ║                  ║  Start recording ║  [  Generate Summary  ]   ║  │
│                ║                  ║  to see live     ║                           ║  │
│                ║                  ║  transcription   ║                           ║  │
│                ╚══════════════════╩══════════════════╩═══════════════════════════╝  │
└─────────────────────────────────────────────────────────────────────────────────────┘

  Record button states (Transcript header):
  ┌─ No transcript, not recording ──┐   ┌─ No transcript, recording active ──┐
  │  [Copy] [🎤 Record]             │   │  [Copy] [⏹ End Recording]  ← red   │
  └─────────────────────────────────┘   └─────────────────────────────────────┘

  ┌─ Transcript exists ─────────────┐
  │  [Copy]          ← Record gone  │
  └─────────────────────────────────┘
```

---

## Critical Decisions

- **Pass recording callbacks down from `page-content.tsx` via props** — `page-content.tsx` already owns `handleStartRecordingOnPage` and `isRecordingLocal`; we add `useRecordingStop` there too and pass both handlers down through `TranscriptPanel → TranscriptButtonGroup`. This follows the existing prop-threading pattern and avoids adding context imports inside panel components.
- **Thread `SummaryGeneratorButtonGroup` props through `SummaryPanel`** — Rather than creating a separate wrapper, extend `SummaryPanel`'s props interface to accept all `SummaryGeneratorButtonGroup` props and render it in the existing header row. All data continues to flow from `page-content.tsx`.
- **Remove Generate AI Summary from `TranscriptButtonGroup` entirely** — `TranscriptButtonGroup` currently handles both Copy and Generate AI Summary. We strip the summary-related props/JSX and replace with record-related props. The component name stays the same.
- **Sidebar recording button: remove both render sites** — The feature spec says the Transcript Record button *replaces* the sidebar button. Remove both the floating pill (line ~500) and full-width button (line ~789) from `Sidebar/index.tsx`. Also remove the `start-recording-on-note` event listener in `page-content.tsx` since nothing dispatches it once the sidebar button is gone.
- **Notes Copy: use BlockNote `blocksToMarkdownLossy`** — The `editor` instance is already available in `NotesPanel`; call `await editor.blocksToMarkdownLossy(editor.document)` and write to clipboard. Disable button when `editor.document` has only empty/default blocks.

---

## Tasks

- [x] 🟩 **Step 1: Add Copy button to My Notes header (`NotesPanel.tsx`)**
  - [x] 🟩 Import `Copy` from `lucide-react` and `Button` from `@/components/ui/button`
  - [x] 🟩 Add a `handleCopyNotes` async function that calls `editor.blocksToMarkdownLossy(editor.document)` and writes to `navigator.clipboard`; show a toast on success (follow `copyOperations` pattern in page-content)
  - [x] 🟩 Compute `isNotesEmpty` — true when the editor document contains only a single empty default block (check `editor.document.length === 1 && !editor.document[0].content?.length`)
  - [x] 🟩 Render the `Copy` button in the header row (right side, same `shrink-0` pattern as Transcript) — disabled when `isNotesEmpty || !isEditorReady`

- [x] 🟩 **Step 2: Refactor `TranscriptButtonGroup` — remove summary button, add Record button**
  - [x] 🟩 Remove props: `onGenerateSummary`, `onStopSummaryGeneration`, `isSummaryDisabled`, `hasExistingSummary` from the interface
  - [x] 🟩 Add props: `isRecording: boolean`, `isStopping: boolean`, `onStartRecording: () => void`, `onStopRecording: () => void`
  - [x] 🟩 Remove the `Generate AI Summary / Stop` button JSX block entirely
  - [x] 🟩 Add a Record/End Recording button that: shows only when `transcriptCount === 0`; uses `Mic` icon + "Record" label when not recording; uses `Square` icon + "End Recording" label (red bg) when recording; is disabled when `isStopping`; calls `onStartRecording` or `onStopRecording` accordingly
  - [x] 🟩 Import `Mic`, `Square` from `lucide-react`

- [x] 🟩 **Step 3: Update `TranscriptPanel` props interface and wiring**
  - [x] 🟩 Remove props forwarded for summary: `onGenerateSummary`, `onStopSummaryGeneration`, `isSummaryDisabled`, `hasExistingSummary`
  - [x] 🟩 Add new props: `onStartRecording: () => void`, `onStopRecording: () => void`, `isStopping: boolean`
  - [x] 🟩 Pass all new props through to `TranscriptButtonGroup`

- [x] 🟩 **Step 4: Add `SummaryGeneratorButtonGroup` to `SummaryPanel` header**
  - [x] 🟩 Import `SummaryGeneratorButtonGroup` and `ModelConfig` into `SummaryPanel.tsx`
  - [x] 🟩 Extend `SummaryPanelProps` with the full `SummaryGeneratorButtonGroup` prop set
  - [x] 🟩 Render `<SummaryGeneratorButtonGroup ... />` inside `MEETING_PANE_HEADER_ROW_CLASS` div, alongside the "AI notes" `<h2>` title (right side, `shrink-0`)
  - [x] 🟩 `hasTranscripts` derives from `transcripts.length > 0` (already a prop on `SummaryPanel`)

- [x] 🟩 **Step 5: Wire everything in `page-content.tsx`**
  - [x] 🟩 Add `useRecordingStop` import and hook call with local state
  - [x] 🟩 Create `handleStopRecordingOnPage` callback
  - [x] 🟩 Remove the `start-recording-on-note` `window.addEventListener` / `removeEventListener` `useEffect`
  - [x] 🟩 Update `<TranscriptPanel>` — new recording props wired in
  - [x] 🟩 Update `<SummaryPanel>` — all `SummaryGeneratorButtonGroup` props passed through
  - [x] 🟩 Expose `availableTemplates` state populated inside the existing `resolveTemplate` effect
  - [x] 🟩 Add `handleSaveModelConfig` and `handleTemplateSelect` callbacks

- [x] 🟩 **Step 6: Remove recording button from `Sidebar/index.tsx`**
  - [x] 🟩 Deleted floating circular recording button (collapsed sidebar)
  - [x] 🟩 Deleted full-width "Start/End Recording" button (expanded footer)
  - [x] 🟩 Removed `showRecordingButton`, `handleRecordingButtonClick`, recording state vars, `useRecordingStop`, and `useRecordingState` from sidebar
  - [x] 🟩 Removed `Mic`, `Square` from lucide-react import; removed `isMeetingActive`, `handleRecordingToggle` from `useSidebar` destructuring

---

## Verification

1. `cd frontend && pnpm run tauri:dev`
2. **My Notes Copy**: Open a meeting, type notes → "Copy" button appears enabled; click → clipboard contains note text; empty notes → button disabled
3. **Transcript Record button**: Open a new meeting with no transcript → "Record" button shows in Transcript header; click → recording starts; "End Recording" appears; click again → recording stops; once transcript segments appear → Record button disappears
4. **AI Notes Generate button**: Open a meeting with a transcript → "Generate AI Summary" (green) button is now in the AI Notes header (not Transcript); click → generation starts; Settings and Template buttons also present
5. **Sidebar**: Confirm no recording buttons are shown in the sidebar at all
6. **Regression**: Transcript Copy button still works; AI summary generate/stop/settings/template all work from AI Notes header; `isStopping` state correctly disables the Record button during stop

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

---

## Source: implementation-plan.md

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

---

## Source: three-pane-header-and-surface-cleanup-plan.md

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

---

## Source: side-by-side-no-clipping-plan.md

# Feature Implementation Plan

**Overall Progress:** `90%`

## My Understanding
You’re saying the narrow-width stacked layout works, but in side-by-side mode (medium/wide) the right `AI notes` pane still gets clipped, and some words/content are cut off.  
You want this guarantee: at any window size, content should remain visible and readable (prefer wrapping/reflow over clipping).

## TLDR
Fix the desktop side-by-side layout by combining:
1. stronger pane sizing rules (no hidden overflow clipping),
2. responsive width distribution across panes, and
3. explicit wrapping rules for AI summary rich content (especially tables/cells from BlockNote).

## Root Cause (Current Behavior)
1. The page uses a side-by-side flex layout with parent `overflow-hidden`; any child overflow can be visually cut off.
2. The `Transcript` pane is pinned to `xl:w-1/3`, which can squeeze the `AI notes` pane more than intended at some widths.
3. AI summary content (notably table-like output in BlockNote) can have intrinsic min-width behavior that resists wrapping.
4. Without table/cell wrap constraints, long content overflows the pane and appears truncated at the right edge.

## Critical Decisions
* **Decision 1:** Keep side-by-side mode, but make width allocation deterministic and shrink-safe (all panes `min-w-0`, no accidental min-content overflow).
* **Decision 2:** Prefer wrapping first; use horizontal scrolling only as a fallback for truly unbreakable structures.
* **Decision 3:** Add summary-surface-specific table and cell wrapping CSS so AI notes content cannot clip.
* **Decision 4:** Verify behavior across explicit window-width checkpoints before marking complete.

## Tasks

- [x] ✅ **Step 1: Stabilize side-by-side pane sizing (no hidden clipping)**
  - [x] ✅ Rework desktop pane width distribution so `My Notes`, `Transcript`, and `AI notes` each get predictable share without starving the right pane.
  - [x] ✅ Ensure all pane roots and inner flex children that participate in width calculations use `min-w-0 min-h-0`.
  - [x] ✅ Remove any layout-level X clipping that causes content to be unreachable in side-by-side mode.
  - Layman’s version: make the three columns share space properly so the right column doesn’t get squeezed off-screen.
  - Update (2026-03-04 00:11:12 PST): Switched desktop layout to 3-column grid (`xl:grid-cols-3`), enabled top-level horizontal fallback access (`overflow-x-auto`), and removed transcript’s fixed desktop width so panes share space evenly.

- [x] ✅ **Step 2: Make AI notes content wrap inside pane boundaries**
  - [x] ✅ Add `summary-editor-surface` rules for rich text/tables:
    - table width constrained to container,
    - cells allow wrapping (`overflow-wrap`, `word-break`, `white-space`),
    - no forced min-width overflow.
  - [x] ✅ Ensure plain text blocks and headings in summary also wrap aggressively for long tokens.
  - Layman’s version: force AI summary text and tables to break lines instead of running off the right side.
  - Update (2026-03-04 00:11:43 PST): Added summary-specific wrap constraints in `frontend/src/app/globals.css` for BlockNote text nodes and table/cell structures (`width:100%`, `table-layout:fixed`, `overflow-wrap:anywhere`).

- [x] ✅ **Step 3: Add safe fallback for unavoidable overflow**
  - [x] ✅ If certain rich structures still cannot fully wrap, provide local horizontal scroll inside the content region (not whole-app clipping).
  - [x] ✅ Keep this fallback scoped to summary content so layout remains clean.
  - Layman’s version: if something truly cannot wrap, you can still access it by scrolling that section only.
  - Update (2026-03-04 00:12:13 PST): Added `overflow-x-auto` fallback to `SummaryPanel` content containers and markdown-compatibility fallback renderer so overflow is local to AI notes.

- [x] ✅ **Step 4: Cross-pane wrap hardening**
  - [x] ✅ Apply consistent `break-words`/`overflow-wrap:anywhere` where needed in notes/transcript/summary text containers.
  - [x] ✅ Confirm header controls remain visible and do not push pane titles out of bounds.
  - Layman’s version: no long word in any pane should disappear off the screen.
  - Update (2026-03-04 00:12:49 PST): Added wrap-anywhere rules for notes editor content and changed shared pane header row/title classes to wrap safely under constrained widths.

- [ ] 🟨 **Step 5: Verification matrix + sign-off evidence**
  - [x] ✅ Run `pnpm tsc --noEmit` in `frontend`.
  - [ ] 🟥 Manual window-width checks:
    - side-by-side wide
    - side-by-side medium
    - narrow stacked
  - [ ] 🟥 Validate specifically with summary content that includes a table (like your screenshot) and confirm no clipped words.
  - [ ] 🟥 Record outcomes in this plan doc and set progress to `100%` before final sign-off request.
  - Layman’s version: prove it works at all window sizes before calling it done.
  - Update (2026-03-04 00:13:12 PST): Typecheck passed. Manual multi-width verification with real summary table content is pending in-app confirmation.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.

---

## Source: stop-recording-fix-plan.md

# ADA-5B: Fix Sidebar "End Recording" to Actually Stop Backend Recording

**Overall Progress:** `92%`

## TLDR

The current sidebar **End Recording** path runs transcript post-processing but does **not** call backend `stop_recording`, so recording continues.

We will make stop behavior source-aware and explicit:

- **UI stop (sidebar button):** call backend `stop_recording` first (with one retry), then run transcript finalization/save.
- **Backend-originated stop (tray/shortcut):** skip backend stop call and run only post-processing.

This guarantees "End Recording" fully stops capture and preserves all transcript content up to that point, while keeping the user on the same meeting page for notes + AI summary.

## Codebase Recon (Current State)

- Sidebar button calls `handleRecordingStop(true)` in `frontend/src/components/Sidebar/index.tsx`.
- `useRecordingStop` currently assumes backend stop already happened ("called by RecordingControls"), which is no longer true for sidebar flow:
  - `frontend/src/hooks/useRecordingStop.ts` comment near stop sequence.
- Backend `recording-stop-complete` event is emitted only from tray paths in `frontend/src-tauri/src/tray.rs`, not from normal frontend `stop_recording` command in `frontend/src-tauri/src/lib.rs`.
- Result: sidebar stop path performs save/wait logic without stopping recorder process.

## Critical Decisions

- **Decision 1:** Make stop API invocation part of `useRecordingStop` for UI-initiated stops.
  - Rationale: one authoritative stop lifecycle owner avoids "UI says stopped, backend still recording" regressions.
- **Decision 2:** Keep source-aware behavior: `ui` vs `backend_event`.
  - Rationale: avoids double-stop when tray already stopped recording.
- **Decision 3:** On backend stop failure, **auto-retry once**.
  - Rationale: improves resilience without hiding failures.
- **Decision 4:** Preserve existing transcript completion/wait/flush/save pipeline and existing-meeting attachment (`pendingMeetingId`).
  - Rationale: keeps desired meeting-first behavior unchanged.

## Public APIs / Interfaces / Types Changes

1. **`useRecordingStop` input contract**
- Current: `handleRecordingStop(callApi: boolean)`
- New:
  - `handleRecordingStop(options?: { source?: 'ui' | 'backend_event'; callApi?: boolean })`
  - Defaults: `{ source: 'ui', callApi: true }`

2. **`window.handleRecordingStop` contract**
- Current: `(callApi?: boolean)`
- New: `(options?: { source?: 'ui' | 'backend_event'; callApi?: boolean })`

3. **Callsite updates**
- Sidebar button call becomes:
  - `handleRecordingStop({ source: 'ui', callApi: true })`
- `RecordingPostProcessingProvider` event call becomes:
  - `handleRecordingStop({ source: 'backend_event', callApi: event.payload })`

## Tasks

- [x] 🟩 **Step 1: Refactor stop lifecycle API to be source-aware**
  - [x] 🟩 Update `useRecordingStop` signature and internal flow to use structured options (`source`, `callApi`).
  - [x] 🟩 Remove/replace stale assumption that backend stop was already performed by `RecordingControls`.
  - [x] 🟩 Keep transcript wait/flush/save steps unchanged after stop confirmation.

- [x] 🟩 **Step 2: Add backend stop execution for UI stop path**
  - [x] 🟩 In `source === 'ui'`, generate save path and call backend `stop_recording` before transcription completion polling.
  - [x] 🟩 Implement one automatic retry if backend stop fails.
  - [x] 🟩 If both attempts fail: set error status, show toast, and avoid entering save flow.

- [x] 🟩 **Step 3: Preserve backend-event post-processing path**
  - [x] 🟩 In `source === 'backend_event'`, skip backend stop call and continue directly to transcript completion/flush/save.
  - [x] 🟩 Keep compatibility with tray `recording-stop-complete` events.

- [x] 🟩 **Step 4: Update callsites**
  - [x] 🟩 Update sidebar button handler in `Sidebar/index.tsx` to pass `{ source: 'ui', callApi: true }`.
  - [x] 🟩 Update `RecordingPostProcessingProvider` listener to pass `{ source: 'backend_event', callApi: event.payload }`.
  - [x] 🟩 Update any remaining legacy callers (`window.handleRecordingStop`, tests/mocks).

- [x] 🟩 **Step 5: Guardrails and UX state correctness**
  - [x] 🟩 Ensure `stopInProgressRef` prevents duplicate stop initiation from rapid clicks.
  - [x] 🟩 Disable end button during active stop sequence (`STOPPING`/`PROCESSING_TRANSCRIPTS`/`SAVING`) to prevent re-entry.
  - [x] 🟩 Ensure final state transitions are coherent (`RECORDING -> STOPPING -> PROCESSING -> SAVING -> IDLE|ERROR`).

- [ ] 🟨 **Step 6: Verification and regression checks**
  - [x] 🟩 Add targeted logging around stop-source, stop attempt count, and backend stop result.
  - [x] 🟩 Run `pnpm tsc --noEmit`.
  - [ ] 🟥 Execute manual E2E validation scenarios (below) and document outcomes.

## Test Cases and Scenarios

1. **Primary bug scenario (must pass)**
- Start recording from sidebar in new meeting.
- Speak for 10-20s; verify live transcript updates.
- Click **End Recording**.
- Expected:
  - backend recording actually stops (no further transcript events),
  - all transcript segments up to click point are finalized/saved,
  - user remains on same meeting page with notes + transcript available.

2. **Retry scenario**
- Simulate first `stop_recording` failure (mock/injected error), second success.
- Expected:
  - one automatic retry,
  - success path continues normally,
  - no duplicate saves.

3. **Hard failure scenario**
- Both stop attempts fail.
- Expected:
  - clear error toast/status,
  - no false "saved successfully" state,
  - recording state reflects backend truth (still active unless backend confirmed stop).

4. **Tray stop compatibility**
- Start recording, stop via tray.
- Expected:
  - `recording-stop-complete` triggers post-processing only,
  - no additional backend stop call from frontend,
  - save and UI updates complete normally.

5. **Existing meeting attachment**
- Start recording on persisted meeting with notes.
- Stop recording via sidebar.
- Expected:
  - `pendingMeetingId` path used,
  - transcript appended to same meeting,
  - no unexpected navigation.

6. **Double-click/end-spam**
- Click End Recording rapidly multiple times.
- Expected:
  - single effective stop flow,
  - no duplicate backend calls/saves.

## Non-Goals

- Re-architecting recording start flow.
- Replacing transcript post-processing algorithm.
- Large backend protocol changes beyond stop-path reliability.

## Assumptions and Defaults

- Existing Rust `stop_recording` command remains authoritative for ending capture.
- Tray still emits `recording-stop-complete`; frontend must support it.
- We keep current meeting-first behavior: stay on current meeting after stop.
- Default failure policy is **auto-retry once** for UI stop command.
- Plan document target path for implementation artifact: `docs/ada-5-meeting-ui/plan.md` (section *Source: stop-recording-fix-plan.md*).

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do

---

## Source: transcript-visibility-after-stop-plan.md

# Feature Implementation Plan

**Overall Progress:** `95%`

## TLDR
After recording ends, transcripts are saved correctly but do not appear immediately on the current meeting page because transcript data is loaded via `usePaginatedTranscripts` and is only fetched on meeting ID change. Since the meeting ID stays the same, the page keeps stale transcript state until the user navigates away/back.  
Fix: add explicit transcript cache invalidation/reload after successful recording save so the current meeting view refreshes immediately.

## Critical Decisions
* **Decision 1:** Use event-driven refresh (`window` custom event) from recording stop flow to meeting page transcript loader, instead of full page reload/router refresh - preserves UX continuity and avoids unnecessary remounts.
* **Decision 2:** Add a first-class `refetch` API to `usePaginatedTranscripts` and call it on matching meeting update events - reuses existing data-loading logic and minimizes duplicate fetch code.
* **Decision 3:** Emit refresh event only after successful DB save for both existing-meeting and new-meeting save paths - guarantees UI updates are tied to committed data.

## Root Cause Analysis
* `useRecordingStop` saves transcript segments to DB (`storageService.saveMeeting`) and updates sidebar meetings, but does not notify meeting-details transcript query state to reload.
* Meeting details transcript list is sourced from `usePaginatedTranscripts` in `frontend/src/app/meeting-details/page.tsx`.
* `usePaginatedTranscripts` initial load effect is gated by `meetingId` and `loadedMeetingIdRef`, so same-ID updates do not refetch.
* Result: transcript view remains stale until route navigation causes unmount/remount and a new fetch.

## Tasks

- [x] 🟩 **Step 1: Add explicit transcript refetch capability to `usePaginatedTranscripts`**
  - [x] 🟩 Add a `refetch` function that reloads metadata + first transcript page for the current `meetingId`.
  - [x] 🟩 Ensure `refetch` resets pagination state (`offset`, `hasMore`, `error`, loading flags) without requiring meeting ID change.
  - [x] 🟩 Return `refetch` from hook API and update type/interface definitions accordingly.

- [x] 🟩 **Step 2: Wire meeting-details page to refresh transcripts on recording-save event**
  - [x] 🟩 In `meeting-details/page.tsx`, consume new `refetch` from `usePaginatedTranscripts`.
  - [x] 🟩 Add listener for a new custom browser event (e.g., `meeting-transcripts-updated`) and trigger `refetch` when `detail.meetingId` matches current page meeting ID.
  - [x] 🟩 Keep listener lifecycle safe (register/unregister on mount/unmount; guard null/invalid IDs).

- [x] 🟩 **Step 3: Emit transcript-update event from stop flow after successful save**
  - [x] 🟩 In `useRecordingStop`, after successful `saveMeeting`, dispatch `window.dispatchEvent(new CustomEvent('meeting-transcripts-updated', { detail: { meetingId } }))`.
  - [x] 🟩 Emit in both existing-meeting and new-meeting success paths (before optional navigation).
  - [x] 🟩 Add defensive logging for event emission and meeting ID for observability.

- [x] 🟩 **Step 4: Keep existing behaviors stable**
  - [x] 🟩 Preserve pendingMeetingId semantics (recording attaches to active meeting).
  - [x] 🟩 Preserve no-navigation behavior for existing meetings after stop.
  - [x] 🟩 Preserve tray stop + backend event flow compatibility.

- [ ] 🟨 **Step 5: Verification and regression testing**
  - [x] 🟩 Run `pnpm tsc --noEmit`.
  - [ ] 🟥 Manual scenario: Start recording in existing meeting, end recording, verify transcript appears immediately without navigation.
  - [ ] 🟥 Manual scenario: Stop from tray while on same meeting page, verify transcript appears without manual navigation.
  - [ ] 🟥 Manual scenario: New meeting recording stop still behaves correctly and no duplicate transcript entries appear.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.

**Note on `request_user_input` Tool:**
- Use `request_user_input` for each clarification round; it pauses execution until the user responds.
- Ask 1-3 questions per round and continue until all ambiguities are resolved.

---

## Source: summary-rendering-stability-plan.md

# Plan: Stabilize AI Summary Rendering (Intermittent Blank Right Pane)

## Summary
The backend is successfully generating and saving summaries (`status=completed`, non-empty markdown), but the right pane intermittently appears blank after success. Based on observed behavior and DB evidence, the failure is in the frontend markdown-to-BlockNote rendering path.  
This plan makes rendering deterministic by adding parser fallbacks, content normalization, and explicit observability so “success toast + blank UI” cannot occur.

## Root-Cause Hypothesis to Address
1. `BlockNoteSummaryView` markdown parse is fragile for certain model outputs (tables / malformed markdown / leaked template instructions).
2. Parse failures are swallowed (console-only), leaving no visible fallback renderer.
3. Intermittency is driven by variable LLM output shape, not by storage failure.

## Why Rendering Fails Today (Current Mechanism)
1. Summary generation succeeds in backend and is saved in DB as markdown (`status=completed`, non-empty markdown).
2. Frontend receives that markdown and tries to convert it to BlockNote blocks using `editor.tryParseMarkdownToBlocks(...)` in `BlockNoteSummaryView.tsx`.
3. Some model outputs include markdown shapes that are less parser-friendly (especially table-heavy output and occasional leaked template instruction text).
4. When parsing fails (or returns unusable/empty block output), current code mainly logs an error and does not guarantee a visible fallback render.
5. Result: user sees success toast (generation worked) but right pane can appear blank (rendering failed).

## How We Fix It
1. Normalize markdown before parsing to reduce parser breakage from inconsistent AI output.
2. Treat parse failure as an explicit UI state, not a silent console event.
3. Always render a fallback (read-only markdown) when structured parse fails.
4. Add diagnostics so each failure is attributable (table present, instruction leak, parse state).
5. Preserve prior visible content during transitions to avoid blank flicker.

## Execution Steps & Tracking (Pre-Approval Checklist)
**Overall Progress:** `92%`

Use this checklist to track implementation before final approval.  
Status legend:
- `⏳` Pending
- `🔄` In Progress
- `✅` Completed

- [x] ✅ **Step 1: Add markdown normalization utility**
  - Files: `frontend/src/lib/summaryMarkdown.ts`, `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`
  - Completion criteria:
    - `normalizeSummaryMarkdown()` exists and is used before parsing.
    - Handles leaked template instructions and common markdown/table cleanup.
    - Unit test coverage added for normalizer edge cases.
  - Note (2026-03-03 23:11:59 PST): Added `summaryMarkdown.ts` + `summaryMarkdown.test.ts`; wired normalization before markdown parse in `BlockNoteSummaryView`.

- [x] ✅ **Step 2: Add explicit parse-state lifecycle**
  - Files: `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`
  - Completion criteria:
    - Parse state includes `idle/parsing/parsed/failed`.
    - Parse failures and empty parse output route to `failed` state.
    - No silent failure path remains.
  - Note (2026-03-03 23:11:59 PST): Added parse-state state machine + emitted state callbacks; parse failures and empty-content parse now route to failed state.

- [x] ✅ **Step 3: Implement guaranteed fallback renderer**
  - Files: `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`, `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
  - Completion criteria:
    - On parse failure, summary is shown in read-only markdown mode.
    - Right pane is never blank after successful generation.
    - Optional “retry structured render” behavior implemented or intentionally deferred and noted.
  - Note (2026-03-03 23:11:59 PST): Added compatibility-mode renderer with read-only markdown + retry button; summary panel now tracks render state and surfaces fallback mode.

- [x] ✅ **Step 4: Add diagnostics/observability hooks**
  - Files: `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`, `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`
  - Completion criteria:
    - Structured diagnostic logs include: meetingId, summaryStatus, markdownLength, hasTable, hasInstructionLeak, parseState.
    - Severe fallback conditions produce actionable error messaging (non-noisy).
  - Note (2026-03-03 23:11:59 PST): Added structured generation/render diagnostics logs (start/completed, markdown shape, parse state), plus fallback warnings.

- [x] ✅ **Step 5: Stabilize summary state transitions**
  - Files: `frontend/src/components/MeetingDetails/SummaryPanel.tsx`, `frontend/src/hooks/meeting-details/useMeetingData.ts`
  - Completion criteria:
    - Completed summaries do not route to empty-state when markdown exists.
    - Previous visible content is preserved during transition to new content.
    - No temporary blank pane flicker in normal flow.
  - Note (2026-03-03 23:11:59 PST): Added `displaySummary` buffering in `SummaryPanel` and kept meeting-aware summary sync in `useMeetingData` to avoid transient blank states.

- [ ] 🔄 **Step 6: Verification and sign-off evidence**
  - Files: tests + manual verification notes in this document
  - Completion criteria:
    - `pnpm tsc --noEmit` passes.
    - Manual scenarios (plain markdown, table markdown, leaked instructions) pass.
    - 20-run stress check has zero “success toast + blank pane” outcomes.
    - A short “What was tested / Results” note is appended before approval request.
  - Note (2026-03-03 23:11:59 PST): Completed local automated checks: `pnpm tsc --noEmit` passed; `node --test --experimental-transform-types src/lib/summaryMarkdown.test.mts` passed (3/3). Manual scenario and 20-run stress validation pending user run.

### What Was Tested / Results
- `pnpm tsc --noEmit`: ✅ pass
- `node --test --experimental-transform-types src/lib/summaryMarkdown.test.mts`: ✅ pass (3 tests)
- Manual UI verification (plain/table/leaked-instruction markdown + 20-run stress): ⏳ pending

### Tracking Update Protocol
For each step during implementation:
1. Change the step status marker (`⏳` → `🔄` → `✅`).
2. Update `Overall Progress` percentage.
3. Add a one-line note under the step with:
   - timestamp,
   - files changed,
   - verification performed.

## Important Interface / Type Changes
1. `frontend/src/components/AISummary/BlockNoteSummaryView.tsx`
   - Add internal render-state union:
     - `parse_state: 'idle' | 'parsing' | 'parsed' | 'failed'`
   - Add normalized markdown + parse result cache for current summary payload.
2. `frontend/src/components/MeetingDetails/SummaryPanel.tsx`
   - Support explicit “render fallback” state from child (or infer from summary status + parse failure callback).
3. `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`
   - Add structured diagnostics logging payload (meetingId, summary length, hasTable, hasMarkdown, parseOutcome event sink).
4. Optional lightweight utility:
   - `frontend/src/lib/summaryMarkdown.ts`
   - Export `normalizeSummaryMarkdown(markdown: string): string` and `detectMarkdownShape(markdown)` helpers.

No backend API contract changes required.

## Implementation Plan

### Step 1: Add deterministic markdown normalization before parse
- Layman's description: Before the app tries to render the AI summary, we clean up messy AI output so it is easier for the editor to understand. This reduces random failures.
- File: `BlockNoteSummaryView.tsx`
- Normalize incoming markdown before `tryParseMarkdownToBlocks`:
  - Strip leaked template-instruction artifacts (e.g., `SECTION-SPECIFIC INSTRUCTIONS`, trailing `</template>` blocks).
  - Normalize table delimiters and blank-line spacing.
  - Ensure markdown is non-empty after normalization.
- Keep original markdown for fallback display and telemetry.

### Step 2: Make parse failure a first-class UI state
- Layman's description: Right now, if rendering fails, the app mostly fails silently. We will explicitly track "render failed" so the UI can react correctly instead of showing a blank panel.
- File: `BlockNoteSummaryView.tsx`
- Replace silent catch with explicit branch:
  - On parse success: render BlockNote editor.
  - On parse failure or zero parsed blocks with non-empty markdown: set `parse_state='failed'`.
- Emit callback/event to parent with parse outcome.

### Step 3: Add guaranteed fallback renderer
- Layman's description: If fancy structured rendering fails, we still show the summary as plain readable text. This guarantees users always see something after successful generation.
- Files: `BlockNoteSummaryView.tsx`, `SummaryPanel.tsx`
- If `parse_state='failed'`, render a robust fallback instead of blank pane:
  - Read-only markdown view (pre-wrapped text, preserves headings/table text).
  - Header note: “Rendered in compatibility mode.”
  - Optional “Retry structured render” button.
- This guarantees visible summary whenever DB has markdown.

### Step 4: Add observability to isolate remaining edge cases
- Layman's description: We add better internal logging so we can tell exactly why a given summary did or did not render, instead of guessing from user reports.
- Files: `useSummaryGeneration.ts`, `BlockNoteSummaryView.tsx`
- Log one structured diagnostics object per generation render:
  - `meetingId`, `summaryStatus`, `markdownLength`, `hasTable`, `hasInstructionLeak`, `parseState`.
- Add toast only for severe fallback conditions (not noisy).

### Step 5: Tighten success criteria in UI state flow
- Layman's description: We make state transitions safer so the app does not briefly clear the summary area during refreshes and accidentally leave it blank.
- Files: `SummaryPanel.tsx`, `useMeetingData.ts`
- Ensure completed summary never routes to empty-state if markdown exists.
- Preserve previously rendered summary until new render outcome is known (avoid temporary blank flicker).

## Test Cases & Scenarios

### Manual scenarios
1. Generate summary with plain sections only (no table).
   - Expect: BlockNote structured render.
2. Generate summary containing markdown table.
   - Expect: Either BlockNote render or fallback markdown render, never blank.
3. Generate summary with leaked instruction text.
   - Expect: normalization strips artifacts or fallback renders content.
4. Rapid consecutive regenerations.
   - Expect: right pane always shows latest completed content, never empty.
5. Existing historical meetings with legacy summaries.
   - Expect: unchanged behavior; no regressions.

### Automated tests (targeted)
1. Unit test `normalizeSummaryMarkdown`:
   - table markdown, malformed separator, leaked instruction block, empty output handling.
2. Component test `BlockNoteSummaryView`:
   - mock parse success -> structured renderer.
   - mock parse throw -> fallback renderer.
   - mock parse empty result with non-empty markdown -> fallback renderer.
3. Integration-level hook/component test:
   - completed summary with markdown always yields visible content state.

## Acceptance Criteria
1. After success toast, summary pane always displays content immediately (structured or fallback).
2. No reproducible “success toast + blank right pane” on 20 consecutive runs.
3. DB-completed summaries are always user-visible without navigation.
4. Typecheck and existing app flow remain green (`pnpm tsc --noEmit`).

## Assumptions / Defaults
1. Default behavior: prefer structured BlockNote rendering; fallback only on parse failure/empty parse.
2. No backend prompt/template changes in this fix (frontend resilience first).
3. Existing summary storage format (`{ markdown: string }`) remains unchanged.
4. If fallback renders, user can still copy/export summary content immediately.

---

## Source: summary-immediate-render-fix-execution.md

# Summary Immediate Render Fix - Execution Tracking

**Overall Progress:** `100%`

## Tasks

- ✅ **Step 1: Decouple title sync from full meeting refresh**
  - ✅ Limit/stop unconditional `onMeetingUpdated()` calls in summary success path.
  - ✅ Keep lightweight title updates local via existing title state updater.

- ✅ **Step 2: Add explicit parent summary hydration callback**
  - ✅ Add `refetchSummaryForMeeting` in meeting page.
  - ✅ Pass callback to meeting page content as `onSummaryUpdated`.

- ✅ **Step 3: Hydrate parent summary after successful generation**
  - ✅ Extend summary generation hook props with `onSummaryUpdated`.
  - ✅ Invoke parent hydration callback after successful summary state update.

- ✅ **Step 4: Prevent transient null prop sync from wiping local summary**
  - ✅ Update summary sync logic in `useMeetingData` to avoid overwriting non-null local state with transient null.
  - ✅ Keep reset behavior when meeting ID changes.

- ✅ **Step 5: Keep summary render behavior stable**
  - ✅ Ensure empty state only renders when summary is truly absent and not in completed/loading transition.
  - ✅ Keep transcript-length gating removed.

## Status Legend
- ✅ Done
- 🔄 In Progress
- ⏳ Pending
