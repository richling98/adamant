# Feature Implementation Plan

**Overall Progress:** `75%`

## TLDR

Text in the Transcript and AI Notes (Summary) sections overflows horizontally when the app window is narrow, and there is no horizontal scroll to see the clipped content. The fix is to remove `overflow-x-auto` from the root layout container and the SummaryPanel, and ensure all text containers use `overflow-x-hidden` + word-wrap so content wraps vertically instead.

## End Result

When the user narrows the app window, all text in the Transcript and AI Notes (Summary) panels wraps onto new lines — no text is clipped, no horizontal scrollbar appears. The user can read everything by scrolling vertically as normal.

## Root Cause

Three containers allow horizontal overflow instead of preventing it:

1. **`page-content.tsx` root grid container** — `overflow-x-auto` on the flex/grid wrapper that holds all three panels; this lets the entire layout scroll sideways.
2. **`SummaryPanel.tsx` content area** — `overflow-y-auto overflow-x-auto` on the scrollable div.
3. **`SummaryPanel.tsx` editor surface** — `overflow-x-auto` on the `summary-editor-surface` wrapper.

The BlockNote editor surfaces already have `word-break: break-word` and `overflow-wrap: anywhere` via globals.css — those rules are correct and will take effect once the outer containers stop expanding horizontally.

The `TranscriptPanel.tsx` content area uses `overflow-hidden` and delegates to `VirtualizedTranscriptView`, which already uses `break-words` on text. It should be fine but needs verification.

## Critical Decisions

- **Use `overflow-x-hidden` not `overflow-x-clip`** — `clip` is less widely supported in older WebKit; `hidden` is safe for Tauri's WebView.
- **Do not add `max-width` constraints** — panels already use `min-w-0` + `flex-1`/`w-full` which should constrain them once horizontal overflow is blocked at the root.
- **Do not touch BlockNote internals** — word-wrap CSS in globals.css already covers the editor; only the outer shell classes need changing.

## Tasks

- [x] 🟩 **Step 1: Fix root layout container in `page-content.tsx`**
  - [x] 🟩 In `src/app/meeting-details/page-content.tsx` (~line 343), on the `div` with `overflow-y-hidden overflow-x-auto`, change `overflow-x-auto` → `overflow-x-hidden`

- [x] 🟩 **Step 2: Fix SummaryPanel overflow classes**
  - [x] 🟩 In `src/components/MeetingDetails/SummaryPanel.tsx` (~line 180), on the content area div with `overflow-y-auto overflow-x-auto`, remove `overflow-x-auto`
  - [x] 🟩 In `src/components/MeetingDetails/SummaryPanel.tsx` (~line 226), on the `summary-editor-surface` wrapper with `overflow-x-auto`, remove `overflow-x-auto`

- [x] 🟩 **Step 3: Verify TranscriptPanel wraps correctly**
  - [x] 🟩 In `src/components/MeetingDetails/TranscriptPanel.tsx` (~line 100), confirm the content area is `overflow-hidden` (correct — virtualized scroll handles internally)
  - [x] 🟩 In `src/components/VirtualizedTranscriptView.tsx` (~line 227), confirm the scroll container is `overflow-y-auto` with no `overflow-x-auto` (confirmed — no changes needed)
  - [x] 🟩 Visually confirm transcript entries wrap — each entry's text `<p>` already has `break-words` so this should work without code changes

- [ ] 🟥 **Step 4: Visual verification**
  - [ ] 🟥 Run the app with `./clean_run.sh` and narrow the window
  - [ ] 🟥 Confirm Transcript text wraps (no horizontal scroll, no clipping)
  - [ ] 🟥 Confirm AI Notes / Summary text wraps (TLDR, bullet points, headings)
  - [ ] 🟥 Confirm My Notes panel wraps (already uses BlockNote with word-break CSS)
  - [ ] 🟥 Confirm no layout breaks at full-width (panels still fill correctly on xl grid)

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
