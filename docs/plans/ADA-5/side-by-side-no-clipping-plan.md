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
