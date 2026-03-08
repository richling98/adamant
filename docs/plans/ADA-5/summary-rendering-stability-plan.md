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
