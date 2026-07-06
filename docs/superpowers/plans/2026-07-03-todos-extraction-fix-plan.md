# Todos Extraction Diagnosis And Fix Plan

## Problem

The meeting `meeting-280c63ad-f994-4f00-8a49-39e8ccefdc27` had explicit user-written notes:

```md
### to dos

* research more and learn about the open source models that nvidia has to see if it’s truly competitive with openai and anthropic
* figure out if any other company is actually generating meanignful revenue at the model layer
```

The AI cleanup correctly used the self-generated notes as source material, but the new homepage To-Do section did not show either todo.

## Confirmed Evidence

### 1. Summary Cleanup Receives Notes

`frontend/src/hooks/meeting-details/useSummaryGeneration.ts` passes both transcript text and `notesMarkdown` into `api_process_transcript`:

```ts
await invokeTauri('api_process_transcript', {
  text: transcriptText,
  notesMarkdown: notesMarkdown || null,
})
```

`frontend/src-tauri/src/summary/commands.rs` accepts `notes_markdown` and forwards it to `SummaryService::process_transcript_background`.

`frontend/src-tauri/src/summary/service.rs` then passes `notes_markdown.as_deref()` into `generate_meeting_summary`, which is why the AI cleanup correctly incorporated the self notes.

### 2. Todo Extraction Does Not Receive Notes

After summary completion, `service.rs` spawns todo extraction with only the transcript:

```rust
let transcript_todo = text.clone();

TodoExtractor::extract_todos_from_transcript(
    &pool_todo,
    &meeting_id_todo,
    &title_todo,
    &date_todo,
    &transcript_todo,
    ...
)
```

`frontend/src-tauri/src/summary/todo_extractor.rs` then builds a prompt containing only:

```text
=== TRANSCRIPT ===
{transcript}
```

This means the explicit `### to dos` section from the user notes is invisible to the extractor.

### 3. The Transcript Itself Does Not Contain Explicit Todos

The transcript discussed NVIDIA, Palantir, the AI stack, Anthropic, OpenAI, and model-layer revenue. It did not include explicit action-item language like "research this" or "figure out that". The extraction prompt currently says:

```text
Only extract items that are explicitly stated as to-dos, commitments, or action items
```

Given transcript-only input, returning no todos is expected behavior.

### 4. Database Check Matches The Diagnosis

The dev database currently has no todos for this meeting:

```sql
SELECT id, meeting_id, date, content_markdown, source_text
FROM todos
WHERE meeting_id = 'meeting-280c63ad-f994-4f00-8a49-39e8ccefdc27';
```

Result: no rows.

## Root Cause

The todo extractor was implemented as a transcript-only extractor. It is disconnected from the self-generated notes even though the AI cleanup path treats those notes as first-class source material.

For this meeting, the only explicit todos were in the self-generated notes, so the extractor never saw them and saved nothing.

## Secondary Issues Found

### A. Homepage Todo Quick View Can Become Stale

`frontend/src/app/page.tsx` calls `getTodayTodos()` only once on mount:

```ts
useEffect(() => {
  getTodayTodos().then(setTodayTodos).finally(() => setTodosLoading(false));
}, []);
```

After extraction completes, `SidebarProvider` refreshes todo date counts, but the homepage todo list itself does not refresh. If a user is sitting on the homepage while extraction finishes, the newly created todos can be hidden until navigation or reload.

### B. Manual Todos Are Likely Hidden Or Invalid

Manual todo creation uses `meeting_id = "manual"`, but the database schema has:

```sql
FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
```

And todo list reads use an inner join:

```sql
FROM todos t
JOIN meetings m ON t.meeting_id = m.id
```

If foreign keys are enforced, manual todo insertion can fail. If foreign keys are not enforced, manual todos still will not appear in `get_by_date` or `get_today` because no `meetings` row exists for `manual`.

This is not the cause of the missed extracted todos in this meeting, but it is a real correctness issue in the todo feature.

## Fix Plan

### Phase 1: Make Todo Extraction Use Both Transcript And User Notes

1. Rename `TodoExtractor::extract_todos_from_transcript` to something source-accurate like `extract_todos_from_sources`.

2. Add a new optional parameter:

```rust
notes_markdown: Option<&str>
```

3. Update `build_extraction_prompt` to include separate source sections:

```text
=== MEETING METADATA ===
Title: ...
Date: ...

=== USER-WRITTEN NOTES ===
...

=== TRANSCRIPT ===
...

Extract action items from both the transcript and user-written notes.
```

4. Update the system prompt rules to explicitly prioritize `to do`, `todo`, `todos`, `action items`, `follow ups`, and equivalent headings in user notes.

5. Preserve the existing guardrail: do not infer todos from general discussion unless the user notes or transcript explicitly frame them as tasks.

Recommended prompt adjustment:

```text
User-written notes are first-class source material. If the notes contain a section headed "to dos", "todos", "action items", or similar, extract each bullet in that section as a todo unless it is empty or purely decorative.
```

6. In `SummaryService::process_transcript_background`, clone `notes_markdown` for the spawned task and pass it into the extractor:

```rust
let notes_todo = notes_markdown.clone();
...
notes_todo.as_deref(),
```

### Phase 2: Avoid Duplicate Todos On Regeneration

Regenerating AI cleanup for the same meeting currently can re-run extraction and insert duplicate todos.

Implement one of these approaches:

1. Recommended for now: before inserting extracted todos for a meeting, delete existing unchecked AI-extracted todos for that meeting where `source_text IS NOT NULL`.

2. Safer long-term: add a deterministic `source_hash` column and upsert extracted todos by `(meeting_id, source_hash)`.

For the first fix, add a repository method:

```rust
delete_extracted_by_meeting(pool, meeting_id)
```

Then call it inside extraction before `batch_insert`.

Manual todos should not be deleted by regeneration.

### Phase 3: Refresh Homepage Todo Data After Extraction

Add a global lightweight todo refresh signal or reuse existing sidebar state.

Minimal implementation:

1. Expose `todayUncheckedCount` or a `todoRefreshVersion` from `SidebarProvider`.

2. In `page.tsx`, include that value in the `useEffect` dependency that calls `getTodayTodos()`.

3. When summary polling completes and `fetchTodoDates()` runs, the homepage quick view refreshes too.

Example shape:

```ts
const { todayUncheckedCount } = useSidebar();

useEffect(() => {
  getTodayTodos().then(setTodayTodos).finally(() => setTodosLoading(false));
}, [todayUncheckedCount]);
```

Better implementation:

1. Add `todoRefreshVersion` to `SidebarProvider`.
2. Increment it whenever `fetchTodoDates()` succeeds.
3. Use `todoRefreshVersion` instead of unchecked count, because checked-only changes should also refresh lists.

### Phase 4: Fix Manual Todo Storage

Replace the `meeting_id = "manual"` sentinel with a nullable meeting relationship.

Recommended schema change:

1. Add migration to allow `meeting_id` to be nullable or introduce `source_meeting_id` nullable.

2. Update manual creation to pass `None` / `NULL` for meeting ID.

3. Change read queries from inner join to left join:

```sql
FROM todos t
LEFT JOIN meetings m ON t.meeting_id = m.id
```

4. Return a fallback title for manual todos, such as `Manual` or empty string.

If avoiding schema migration for now, create a real hidden `meetings` row with id `manual`, but this is less clean and can leak into meeting lists unless every meeting query filters it out.

### Phase 5: Add Tests / Verification

Add tests or scripted checks for these cases:

1. Transcript has no tasks, notes contain `### to dos` with two bullets: extractor saves two todos.

2. Transcript contains an explicit commitment, notes are empty: extractor still saves the transcript-derived todo.

3. Transcript discusses possible research topics, notes are empty: extractor saves zero todos.

4. Regenerating cleanup for the same meeting does not duplicate extracted todos.

5. Manual todo appears in `/todos`, homepage quick view, and sidebar counts.

6. Homepage quick view updates after extraction completes without requiring app reload.

## Expected Result For The Reported Meeting

After Phase 1, this meeting should extract and display exactly these todos:

```md
* research more and learn about the open source models that nvidia has to see if it’s truly competitive with openai and anthropic
* figure out if any other company is actually generating meanignful revenue at the model layer
```

The todos should be stored with:

```text
meeting_id = meeting-280c63ad-f994-4f00-8a49-39e8ccefdc27
date = 2026-07-03
source_text = original bullet text
content_markdown = original bullet text
```

And they should appear in:

1. Homepage Today’s To-Dos quick view, if the selected date is today.
2. `/todos?date=2026-07-03`.
3. Sidebar To Do’s section under July 3, 2026.

## Implementation Priority

1. High: Include user notes in todo extraction.
2. High: Prevent duplicate extraction on regeneration.
3. Medium: Refresh homepage todo list when extraction completes.
4. Medium: Fix manual todo storage / joins.
5. Medium: Add focused tests for extraction and read paths.
