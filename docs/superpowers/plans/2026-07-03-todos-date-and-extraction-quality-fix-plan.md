# Todos Date Visibility And Extraction Quality Fix Plan

## Reported Failure

New meeting:

```text
meeting-6cd8e268-6276-42a3-9e3d-4d9ecc1a11e6
```

User-written notes:

```md
### to dos

* figure out how much private aviation costs and how much flying elon musk does
* eat chips tomorrow
*
```

Expected homepage todos:

```md
* figure out how much private aviation costs and how much flying elon musk does
* eat chips tomorrow
```

Observed: homepage To-Do section showed nothing.

## What Actually Happened

The todo extractor did run and inserted rows. The correct todos exist in the dev database:

```sql
SELECT id, meeting_id, date, content_markdown, source_text
FROM todos
WHERE meeting_id = 'meeting-6cd8e268-6276-42a3-9e3d-4d9ecc1a11e6';
```

Important result rows:

```text
date = 2026-07-04
content_markdown = figure out how much private aviation costs and how much flying elon musk does (owner: null)
source_text = figure out how much private aviation costs and how much flying elon musk does

date = 2026-07-04
content_markdown = eat chips tomorrow
source_text = eat chips tomorrow
```

The homepage query returned nothing because it asks the backend for local today:

```sql
WHERE t.date = date('now', 'localtime')
```

At the time of the meeting:

```sql
SELECT date('now'), date('now','localtime');
-- 2026-07-04 | 2026-07-03
```

So the rows were stored under UTC date `2026-07-04`, while the homepage asked for local date `2026-07-03`.

## Root Causes

### Root Cause 1: Todo Dates Are Stored In UTC But Read As Local Dates

In `frontend/src-tauri/src/summary/service.rs`, the todo date is derived from `created_at` using UTC formatting:

```rust
let meeting_date_str = meeting_model
    .as_ref()
    .map(|m| m.created_at.0.format("%Y-%m-%d").to_string());
```

For this meeting:

```sql
SELECT created_at, date(created_at), date(created_at, 'localtime')
FROM meetings
WHERE id = 'meeting-6cd8e268-6276-42a3-9e3d-4d9ecc1a11e6';
```

Result:

```text
created_at = 2026-07-04T03:36:43.026844+00:00
UTC date = 2026-07-04
local date = 2026-07-03
```

The UI labels this meeting as July 3, but todos are stored as July 4.

### Root Cause 2: Frontend And Backend Use Different Definitions Of "Today"

Backend `get_today` uses SQLite local time:

```sql
date('now', 'localtime')
```

Frontend code uses UTC ISO date strings in several todo paths:

```ts
new Date().toISOString().split("T")[0]
```

At night in US time zones, these disagree.

### Root Cause 3: The LLM Extractor Over-Extracts From Transcript Discussion

The extractor created 8 todos for this meeting. Only 2 were desired. The extra rows were transcript discussion mistakenly treated as tasks, for example:

```text
Go to San Francisco for the night, have a few meetings tomorrow, and then come back when we're done.
Who do you think flies more? Elon Musk??
He flies international as well...
```

This happened because the extraction pass is still LLM-driven for all source text. Even with the prompt rule, the LLM can misclassify questions and statements as action items.

### Root Cause 4: `owner: null` Can Leak Into Display Text

One inserted todo became:

```text
figure out how much private aviation costs and how much flying elon musk does (owner: null)
```

That means the provider returned the string `"null"` rather than JSON `null`, and the formatter treated it as a real owner.

## Fix Strategy

The fix should not be another prompt-only change. Prompt-only extraction already proved unreliable. The correct architecture is:

1. Deterministically parse explicit todo sections in user-written notes.
2. Use the LLM only as a secondary extractor for transcript commitments.
3. Normalize all todo dates to local calendar dates.
4. Make all frontend and backend "today" logic use the same date convention.
5. Backfill/fix existing incorrectly dated rows.

## Implementation Plan

### Phase 1: Add A Shared Local Date Policy

Define the product rule:

> Todo dates are local calendar dates in the user's machine timezone, matching how meetings are displayed in the UI.

Backend changes:

1. In `summary/service.rs`, derive meeting date using local timezone:

```rust
let meeting_date_str = meeting_model.as_ref().map(|m| {
    m.created_at
        .0
        .with_timezone(&chrono::Local)
        .format("%Y-%m-%d")
        .to_string()
});
```

2. Change fallback date from UTC to local:

```rust
chrono::Local::now().format("%Y-%m-%d").to_string()
```

3. In `TodosRepository::get_today`, consider removing backend-side `today` entirely and prefer a `get_by_date(date)` call from the frontend. If keeping it, compute with the same local policy.

Frontend changes:

1. Add a local date helper, for example `frontend/src/lib/dateKey.ts`:

```ts
export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

2. Replace todo-facing `new Date().toISOString().split("T")[0]` calls with `localDateKey()`.

3. Replace `getTodayTodos()` usage on the homepage with `getTodosByDate(localDateKey())`. This removes backend/frontend disagreement.

4. Update `subtractDay` and `addDay` in `TodosPage.tsx` to avoid `toISOString()` because it converts back to UTC. Build the date key from local year/month/day instead.

### Phase 2: Backfill Existing Todo Dates

Add a migration to correct existing extracted todos that were stored under UTC meeting dates.

For todos linked to a meeting:

```sql
UPDATE todos
SET date = (
  SELECT date(m.created_at, 'localtime')
  FROM meetings m
  WHERE m.id = todos.meeting_id
)
WHERE meeting_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM meetings m WHERE m.id = todos.meeting_id);
```

This will move the reported meeting's todos from `2026-07-04` to `2026-07-03`.

Manual todos should keep their existing date because they were created from the UI-selected date.

### Phase 3: Deterministically Extract Todo Sections From User Notes

Add a parser in `todo_extractor.rs` before the LLM pass:

1. Parse markdown line-by-line.
2. Detect headings like:

```md
# todo
## todos
### to dos
### action items
### follow ups
```

3. Collect bullet/task-list lines under that heading until the next heading of same or higher level.
4. Normalize bullets:

```md
* item
- item
1. item
- [ ] item
- [x] item
```

5. Ignore empty bullets like `*`.
6. Store these as deterministic todos with `source_text` and `content_markdown` exactly matching the bullet text.

Expected deterministic extraction for this report:

```text
figure out how much private aviation costs and how much flying elon musk does
eat chips tomorrow
```

### Phase 4: Restrict Or Split LLM Transcript Extraction

After deterministic note parsing, run LLM extraction only for transcript content, and only for explicit commitments.

Recommended behavior:

1. Always include deterministic note todos.
2. Run LLM transcript extraction only if transcript contains action-item language or if a setting enables transcript-derived todos.
3. Strengthen the transcript prompt:

```text
Do not extract questions, discussion topics, examples, hypothetical tasks, travel plans, facts, or things someone says they already do.
Only extract commitments where someone explicitly says they will do something after this meeting.
```

4. Add a structured field:

```json
{
  "text": "...",
  "source": "notes" | "transcript",
  "confidence": "high" | "medium" | "low"
}
```

5. Only insert high-confidence transcript todos.

Minimal first implementation:

1. Deterministically extract note todos.
2. If note todo section exists, skip transcript LLM extraction for that meeting.

This would have produced exactly 2 todos for the reported meeting.

### Phase 5: Normalize Nullable Owner/Deadline Values

Before formatting extracted items, normalize provider output:

```rust
fn clean_optional(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .filter(|v| !v.eq_ignore_ascii_case("null"))
        .filter(|v| !v.eq_ignore_ascii_case("none"))
        .map(ToString::to_string)
}
```

Then use cleaned owner/deadline values when building display text.

### Phase 6: Make Homepage And Sidebar Refresh The Same Data

1. Homepage should query `getTodosByDate(localDateKey())`, not `getTodayTodos()`.
2. Sidebar `todayUncheckedCount` should compare against `localDateKey()`.
3. `/todos` default date should be `localDateKey()`.
4. After summary completion, refresh both date counts and the current date list.

### Phase 7: Add Diagnostics For Extraction

Add structured logs around extraction:

```text
Todo extraction start: meeting_id, local_date, transcript_len, notes_len
Deterministic notes todos extracted: count
LLM transcript todos extracted: count
Todos deleted before regeneration: count
Todos inserted: count
```

Also persist non-fatal extraction failures somewhere queryable, either:

1. Add `todo_extraction_status` table, or
2. Add metadata into `summary_processes.metadata`.

This avoids future silent failures.

## Verification Plan

### Database Checks

For the reported meeting after regeneration/backfill:

```sql
SELECT date, content_markdown
FROM todos
WHERE meeting_id = 'meeting-6cd8e268-6276-42a3-9e3d-4d9ecc1a11e6'
ORDER BY sort_order;
```

Expected:

```text
2026-07-03 | figure out how much private aviation costs and how much flying elon musk does
2026-07-03 | eat chips tomorrow
```

No `owner: null` suffix.

### UI Checks

1. Homepage at local July 3 shows both todos.
2. `/todos` default route opens local July 3, not UTC July 4.
3. Sidebar Today badge shows `2` unchecked.
4. `/todos?date=2026-07-03` shows both todos.
5. `/todos?date=2026-07-04` does not incorrectly show this meeting's todos.

### Regression Checks

1. Meeting notes with `### to dos` extracts exact bullets.
2. Empty bullet `*` is ignored.
3. Transcript-only explicit commitment still extracts if enabled.
4. Transcript discussion/question does not become a todo.
5. Regenerating cleanup does not duplicate todos.
6. Manual todos still appear in homepage, sidebar, and `/todos`.

## Priority

1. Highest: local date normalization and backfill.
2. Highest: deterministic note-section parser.
3. High: stop/limit transcript LLM over-extraction.
4. Medium: owner/deadline normalization.
5. Medium: extraction diagnostics.
