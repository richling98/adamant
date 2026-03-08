# ADA-5: Panel Header Controls Reorganization

**Type:** Feature/Enhancement | **Priority:** Medium | **Effort:** Medium-Large

## TL;DR

Reorganize the three main panel headers (My Notes, Transcript, AI Notes) so that each panel's relevant action buttons live directly in its own header. This makes the UI more intuitive — controls are co-located with the content they affect — and eliminates the sidebar's context-duplicating recording button.

---

## Current State vs. Desired State

### Current State

| Panel | Header Buttons |
|-------|---------------|
| **My Notes** | None (only "Saved X ago" indicator) |
| **Transcript** | `Copy` + `Generate AI Summary` (green) |
| **AI Notes** | `SummaryGeneratorButtonGroup` rendered via SummaryPanel (Settings, Template selector, Generate/Stop) |
| **Sidebar** | `Start/End Recording` button (shown when on `/meeting-details` and meeting is active) |

The "Generate AI Summary" quick-action in the Transcript header is confusing — it triggers a summary but belongs semantically to the AI Notes panel. The sidebar recording button duplicates context-specific logic that belongs in the Transcript panel itself.

### Desired State

| Panel | Header Buttons |
|-------|---------------|
| **My Notes** | `Copy` (copies notes content to clipboard) |
| **Transcript** | `Copy` + `Record / End Recording` |
| **AI Notes** | `Generate AI Summary` (the full `SummaryGeneratorButtonGroup`: generate/stop, settings, template selector) |
| **Sidebar** | Recording button removed (replaced by Transcript's Record button) |

---

## Detailed Requirements

### 1. My Notes — Add Copy Button

- Add a `Copy` button to the Notes panel header (right side, same pattern as Transcript's Copy button).
- On click: copy the full notes content (plain text extracted from the BlockNote editor) to the clipboard.
- Button should be disabled when the editor is empty.
- Show standard copy feedback (toast or brief icon change).

### 2. Transcript — Replace "Generate AI Summary" with "Record" Button

**Remove:**
- Remove the `Generate AI Summary` button from `TranscriptButtonGroup`.

**Add `Record / End Recording` button:**
- Appearance: outlined button with a microphone icon and label "Record". When recording is active, switch to a red stop variant with "End Recording" label (matching the existing sidebar style).
- Visibility rules:
  - **Show** when: no transcript exists AND the current session is a meeting-details context.
  - **Hide** when: transcripts exist (recording is done; user can review but not re-record into this session).
  - **Always show** (in the active/inactive toggle state) while the transcript count is zero, regardless of whether a recording is currently in progress.
- Behavior on click:
  - If not recording → start recording (invoke `start_recording` via `useRecordingStart` / `handleRecordingToggle`).
  - If recording → stop recording (invoke `handleRecordingStop`).
- Disabled/busy states: respect `isStopBusy` / `isStopping` / `isProcessing` / `isSaving` from `RecordingStateContext` (same as sidebar).
- The button should wire into the same `handleRecordingButtonClick` logic already used in the sidebar — no new Tauri commands needed.

### 3. AI Notes — Move "Generate AI Summary" Here

- Move the `SummaryGeneratorButtonGroup` (generate/stop, AI Model settings, Template selector) into the `SummaryPanel` header row.
- It is currently rendered somewhere outside or below the header in `SummaryPanel`; it should sit in the `MEETING_PANE_HEADER_ROW_CLASS` div alongside the "AI notes" title.
- All existing functionality (Ollama/built-in AI check, settings dialog, template dropdown) must be preserved exactly.
- The button should remain hidden when `!hasTranscripts` (current guard in `SummaryGeneratorButtonGroup`).

### 4. Sidebar — Remove Recording Button

- Remove (or conditionally hide) the two recording button render sites in `frontend/src/components/Sidebar/index.tsx`:
  - The floating circular button (around line 500).
  - The full-width "Start Recording / End Recording" button (around line 789).
- The `showRecordingButton` guard and `handleRecordingButtonClick` logic can be deleted from `Sidebar/index.tsx` since that responsibility moves to the Transcript panel.
- Ensure no side effects: `useRecordingStop`, `useRecordingStart`, and `RecordingStateContext` are still used elsewhere (page-content.tsx) and must not be removed.

---

## Recording Button Visibility — State Machine

```
┌─────────────────────────────────────────────────────────┐
│           transcriptCount === 0                         │
│  ┌──────────────────────┐  ┌───────────────────────┐   │
│  │  isRecording = false │  │  isRecording = true   │   │
│  │  → Show "Record"     │  │  → Show "End Recording│   │
│  │    (enabled)         │  │    (red, stoppable)   │   │
│  └──────────────────────┘  └───────────────────────┘   │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│           transcriptCount > 0                           │
│  → Hide Record button entirely                          │
└─────────────────────────────────────────────────────────┘
```

---

## Affected Files

| File | Change |
|------|--------|
| `frontend/src/components/NotesPanel.tsx` | Add Copy button to header; wire to BlockNote content extraction |
| `frontend/src/components/MeetingDetails/TranscriptButtonGroup.tsx` | Remove Generate AI Summary button; add Record/End Recording button with recording state props |
| `frontend/src/components/MeetingDetails/TranscriptPanel.tsx` | Pass `isRecording`, `isStopping`, `transcriptCount`, `onStartRecording`, `onStopRecording` props to `TranscriptButtonGroup` |
| `frontend/src/components/MeetingDetails/SummaryPanel.tsx` | Move `SummaryGeneratorButtonGroup` into the header row |
| `frontend/src/app/meeting-details/page-content.tsx` | Pass recording callbacks + state into `TranscriptPanel`; ensure `SummaryGeneratorButtonGroup` props flow to `SummaryPanel` header |
| `frontend/src/components/Sidebar/index.tsx` | Remove both recording button render sites and the `showRecordingButton` logic |

---

## Dependencies & Context

- **Recording state source of truth**: `RecordingStateContext` (`isRecording`, `isStopping`, `isProcessing`, `isSaving`) — already imported in Sidebar; must be imported in TranscriptPanel or passed via props from page-content.
- **Recording start**: `useRecordingStart` hook → `handleRecordingToggle` — already used in page-content.tsx.
- **Recording stop**: `useRecordingStop` hook → `handleRecordingStop` — used in both Sidebar and page-content.tsx.
- **BlockNote content extraction**: Need to call `editor.document` and serialize to plain text for the Notes Copy button. The editor ref is available in `NotesPanel.tsx`.
- **`SummaryGeneratorButtonGroup` props**: All props it currently receives from `page-content.tsx` must continue to flow; the component just renders in a different DOM location (the SummaryPanel header).

---

## Risks & Notes

- **Sidebar removal**: Two render sites for the recording button exist in `Sidebar/index.tsx` (one floating pill, one full-width). Both must be removed to avoid showing a stale recording control. Verify with `grep showRecordingButton` before removing.
- **BlockNote copy**: BlockNote's editor API (`editor.blocksToMarkdownLossy` or plain-text traversal) should be used to extract text. Edge case: empty editor should disable the button.
- **SummaryGeneratorButtonGroup placement**: Currently `hasTranscripts` guards the return; if moved to the header, ensure the conditional still works so the button doesn't appear for truly empty meetings.
- **Responsive layout**: The AI Notes header with the full `SummaryGeneratorButtonGroup` (3–4 buttons) may be tight on small screens. Consider wrapping or using icon-only mode below `lg:` breakpoint (already partially handled by the component's `hidden lg:inline` spans).
- **New-note mode**: The `isNewNote` prop in `page-content.tsx` affects certain behaviors. Verify the Record button respects this flag (should be enabled in new-note mode, as that's exactly when you'd start recording).
