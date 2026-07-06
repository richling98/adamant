# Plan: Fix Todo Extraction Accuracy & Sidebar Expanded View

> Two issues: (1) the AI extracts non-todo items as todos, and (2) the sidebar's expanded date-group view shows nothing.

---

## Issue 1: Todo Extraction Produces False Positives

### Root Cause

The LLM extraction prompt in `todo_extractor.rs` instructs the model to extract "explicit post-meeting commitments," but LLMs interpret this too broadly — discussion topics, rhetorical questions, and factual statements get returned as action items. The prompt does not explicitly forbid extracting tasks that the speaker was *already doing* during the meeting, or hypothetical/aspirational statements.

In this specific case:
- The meeting transcript contained a casual conversation about private aviation with **zero explicit commitments**
- The LLM nevertheless returned spurious todos (discussion topics dressed as action items)
- The deterministic extraction from `### to dos` headings works correctly when present, but when notes lack the heading (or the LLM path fires instead), the loose prompt causes false positives

### Changes Required

**File: `frontend/src-tauri/src/summary/todo_extractor.rs`**

1. **Tighten the system prompt** (lines 111–122). Add explicit negative rules:
   - Do NOT extract items the speaker says they *already do* or *already looked into*
   - Do NOT extract hypothetical questions ("who do you think flies more?")
   - Do NOT extract statements of fact or opinion
   - Do NOT extract things someone *could* do — only things they explicitly *will* do
   - When in doubt, return `[]` — it is better to miss a todo than to create a false one

2. **Lower temperature further** (line 9, `EXTRACTION_TEMPERATURE`). Change from `0.1` to `0.0` — deterministic extraction should have zero randomness.

3. **Add strict output validation** after parsing. Filter out items that:
   - Contain question marks (likely rhetorical questions, not commitments)
   - Are shorter than 10 characters (likely fragments)
   - Start with "maybe", "could", "might", "should" (hypothetical, not committed)

---

## Issue 2: Sidebar Expanded Date Group Shows Nothing

### Root Cause

`TodoDateGroupRow` in `index.tsx:1938–1947` renders only a "View all N items →" link when expanded — it never fetches or renders the actual todo items. The user clicks to expand and sees nothing useful.

### Changes Required

**File: `frontend/src/components/Sidebar/index.tsx`**

1. **Add todo fetching to `TodoDateGroupRow`**: Call `getTodosByDate(date)` when the component mounts or expands, store results in local state.

2. **Render inline todo items**: Replace the single "View all" link with:
   - A compact list of unchecked todo items (checkbox + truncated text, max ~5)
   - A "View all N items →" link at the bottom if there are more than 5

   Each item should show:
   - A small checkbox (calls `toggleTodo` on click)
   - Truncated todo text (extracted from `content_markdown` or `source_text`)
   - Link back to originating meeting (if `meeting_id` is present)

3. **Loading state**: Show a brief "Loading..." or skeleton pulse while fetching.

### Optional Polish

- Add a small "Add todo" inline button at the bottom of the expanded list to jump to `/todos?date=...`
- Animate items appearing with a staggered fade-in

---

## Implementation Order

1. Apply the prompt + validation changes in `todo_extractor.rs` (minimal, high-impact)
2. Refactor `TodoDateGroupRow` to fetch and render inline todos (moderate effort)
3. Test: launch the app, check sidebar expansion, trigger cleanup on a casual-conversation meeting, verify no false positives
4. Commit changes if clean

## Files Modified

| File | Change |
|------|--------|
| `frontend/src-tauri/src/summary/todo_extractor.rs` | Tighter prompt, lower temperature, post-parse filtering |
| `frontend/src/components/Sidebar/index.tsx` | Inline todo rendering in `TodoDateGroupRow` |
