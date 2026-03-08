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
