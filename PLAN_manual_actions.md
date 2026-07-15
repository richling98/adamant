# Feature Implementation Plan

**Overall Progress:** `90%`

## TLDR
Add a clean plus-icon manual action entry flow to the Actions/To-dos page, including All Actions and individual date views. Manual actions should be created as standalone todos with `meeting_id = null` and `source_text = null`, so AI cleanup and meeting-based extraction can continue replacing only extracted meeting actions without deleting or overwriting user-entered actions. Also fix the production action-capture bug where clear manually written takeaways like `Mike, to send us a quick blurb...` are rejected and where transcript extraction is skipped whenever notes produce any action items.

## Current State
The Actions page lives in `frontend/src/components/Todos/TodosPage.tsx` and is routed through `frontend/src/app/todos/page.tsx`.

The data API already supports manual todo creation:

- Frontend wrapper: `frontend/src/lib/todoApi.ts` calls `api_create_todo`.
- Tauri command: `frontend/src-tauri/src/api/todos_api.rs::api_create_todo` creates todos with `source_text = None`.
- Repository: `frontend/src-tauri/src/database/repositories/todos.rs::create` inserts arbitrary todos and accepts nullable `meeting_id` and `source_text`.

The AI extraction flow already distinguishes extracted actions from manual actions:

- `frontend/src-tauri/src/summary/todo_extractor.rs::save_todos_to_db` inserts extracted meeting actions with `meeting_id = Some(meeting_id)` and `source_text = Some(item.text)`.
- `frontend/src-tauri/src/summary/todo_extractor.rs::extract_todos_from_sources` calls `TodosRepository::delete_extracted_by_meeting` before re-inserting extracted actions.
- `TodosRepository::delete_extracted_by_meeting` deletes only `WHERE meeting_id = ? AND source_text IS NOT NULL`, so manual standalone actions with `meeting_id = null` and `source_text = null` are not touched.

The daily view already has a basic `AddTodoRow`, but All Actions does not. The requested feature should formalize this into a cleaner plus-icon affordance and make it available in both All Actions and per-date action sessions.

## Production Action Capture Bug
The current extractor in `frontend/src-tauri/src/summary/todo_extractor.rs` has two important behavior gaps that explain the missed actions in the `v0.8.8` DMG:

- `extract_todos_from_sources` uses deterministic note parsing first, then only runs LLM transcript extraction when `note_items.is_empty()`. This means transcript actions are not pulled when notes contain at least one accepted action.
- `is_action_item` only accepts lines that start with a known action verb or phrase. Clear notes-style assignments such as `Mike, to send us a quick blurb describing the physical AI program` and `Chris, to tell Cha-Cha and Sue Mai about the blurb that Mike sends over` do not start with `send` or `tell`, so they are rejected.
- `Ask for a meeting with Jeff` and `Draft follow-up email and send over` should already match the accepted action verbs after normalization, so if they were missed, the plan must verify whether the notes section heading was recognized as an action/takeaways section and whether the note markdown being passed into extraction contains these lines.

## Critical Decisions
- **Manual todos remain standalone records:** Create manual actions with `meeting_id: null` and `source_text: null`. This preserves the existing extracted-vs-manual distinction and avoids schema changes.
- **Do not merge manual todos into meeting notes:** Manual actions should not be stored in note markdown or transcript-derived data, because AI cleanup may regenerate those sources.
- **Keep AI extraction replace-only-for-extracted behavior:** Preserve `delete_extracted_by_meeting(meeting_id)` semantics so regenerated AI actions replace prior AI actions for that meeting but leave manual actions untouched.
- **All Actions plus defaults to today:** In the global All Actions view, the header-level plus button should create a manual action for `localDateKey()` unless the user opens a specific date group plus button, which should create for that group’s date.
- **Use inline creation instead of a modal:** A compact inline draft row is fastest, matches the current todo editing model, and avoids adding new dialog state.
- **Plus icon should be thematic but accessible:** Use `Plus` from `lucide-react`, styled with `text-primary`, subtle border/background, hover states, `aria-label`, and keyboard focus rings.
- **Notes and transcript extraction should both contribute actions:** Deterministic notes extraction should not suppress transcript extraction. The extractor should merge note-derived and transcript-derived actions, then de-duplicate before saving.
- **Accept owner-assignment note syntax:** Manual notes commonly use `Name, to do X`, `Name to do X`, or `Name: do X`. Treat these as action items when the post-owner phrase contains an accepted action verb or `to + action verb` construction.

## Tasks

- [x] 🟩 **Step 1: Preserve And Document Data Invariants**
  - [x] 🟩 Confirm `api_create_todo(null, date, json, markdown)` persists `meeting_id = null` and `source_text = null` through `todos_api.rs` and `TodosRepository::create`.
  - [x] 🟩 Confirm `TodoExtractor::save_todos_to_db` continues to set extracted actions to `meeting_id = Some(...)` and `source_text = Some(...)`.
  - [x] 🟩 Confirm `TodosRepository::delete_extracted_by_meeting` remains scoped to `meeting_id = ? AND source_text IS NOT NULL`.
  - [x] 🟩 Add or update a small repository/extractor test if there is existing test infrastructure for DB behavior; otherwise add a targeted unit test around the deletion query behavior if feasible.

- [x] 🟩 **Step 2: Fix Notes Action Recognition**
  - [x] 🟩 Update `TodoExtractor::is_todo_heading` to recognize `takeaway`, `takeaways`, `next step`, `next steps`, `action`, and `actions` if those are used in AI-cleanup/manual-note output.
  - [x] 🟩 Update `TodoExtractor::normalize_todo_line` or `is_action_item` to accept owner-assignment formats:
    - `Mike, to send us a quick blurb describing the physical AI program.`
    - `Chris, to tell Cha-Cha and Sue Mai about the blurb that Mike sends over.`
    - `Mike: send us a quick blurb describing the physical AI program.`
    - `Chris - tell Cha-Cha and Sue Mai about the blurb that Mike sends over.`
  - [x] 🟩 Implement this without broadly accepting random declarative sentences. Only accept the owner-assignment form when the action phrase after the owner marker starts with `to <known action verb>` or a known action verb.
  - [x] 🟩 Keep existing rejection filters for questions, meta-commentary, and obviously personal/off-topic tasks.
  - [x] 🟩 Add unit tests in `frontend/src-tauri/src/summary/todo_extractor.rs` for the exact reported examples:
    - `Mike, to send us a quick blurb describing the physical AI program.`
    - `Chris, to tell Cha-Cha and Sue Mai about the blurb that Mike sends over.`
    - `Ask for a meeting with Jeff.`
    - `Draft follow-up email and send over.`
  - [x] 🟩 Add negative tests showing non-action meeting facts under takeaways are still rejected.

- [x] 🟩 **Step 3: Always Pull Actions From Transcript Too**
  - [x] 🟩 Change `extract_todos_from_sources` so transcript LLM extraction runs whenever transcript text is non-empty, regardless of whether deterministic notes extraction found items.
  - [x] 🟩 Preserve deterministic notes extraction because it is cheaper and catches explicit written tasks reliably.
  - [x] 🟩 Merge `note_items` and filtered `transcript_items` before saving.
  - [x] 🟩 De-duplicate merged items using normalized text so the same action in notes and transcript does not appear twice.
  - [x] 🟩 Keep the existing corporate-action and personal-task filters for LLM transcript items.
  - [x] 🟩 Ensure transcript extraction remains best-effort and non-fatal, matching the current `tokio::spawn` cleanup flow in `summary/service.rs`.
  - [x] 🟩 Add tests or a small helper-level test for merge/de-duplication behavior if feasible.

- [x] 🟩 **Step 4: Add Extraction Diagnostics For Production Debugging**
  - [x] 🟩 Log whether notes markdown was present, whether a recognized action heading was found, and how many note-derived actions were accepted/rejected.
  - [x] 🟩 Log whether transcript extraction ran, how many transcript actions were accepted after filtering, and how many were removed as duplicates.
  - [x] 🟩 Avoid logging full private meeting content in production logs; use counts and short redacted previews only when debug logging is enabled.

- [x] 🟩 **Step 5: Refactor Manual Add UI Into A Reusable Plus Flow**
  - [x] 🟩 Update imports in `frontend/src/components/Todos/TodosPage.tsx` to include `Plus` from `lucide-react`.
  - [x] 🟩 Replace the always-visible daily `AddTodoRow` with a plus-button-triggered inline draft row.
  - [x] 🟩 Rename or refactor `AddTodoRow` into a reusable component such as `ManualActionComposer` or `AddActionRow` that supports:
    - Closed state showing only a clean plus affordance and short label like `Add action`.
    - Open state showing an editable input with checkbox-aligned spacing.
    - Enter to save.
    - Escape to cancel.
    - Blur-safe behavior that does not accidentally create blank todos.
    - Auto-focus when opened.
  - [x] 🟩 Keep creation payload as markdown text with `json = null`, consistent with existing `TodoRow` update behavior.

- [x] 🟩 **Step 6: Add Manual Creation To Date Views**
  - [x] 🟩 In non-All date view, render the new plus composer above unchecked actions, including when the day has no actions.
  - [x] 🟩 Use `handleAddForDate(activeDate, markdown, null)` so the todo is created for the selected date, not always today.
  - [x] 🟩 Optimistically append the returned todo to local `todos` and call `fetchTodoDates()` so sidebar counts refresh.
  - [x] 🟩 Set `focusedTodoId` to the newly created todo ID if creation results in a row that should be immediately editable.
  - [x] 🟩 Preserve existing checkbox toggle, delete, debounced update, and Enter-to-create-below behavior.

- [x] 🟩 **Step 7: Add Manual Creation To All Actions**
  - [x] 🟩 Add a header-level plus button near the `All Actions` title/help icon or in the right header rail, styled consistently with the theme.
  - [x] 🟩 On click, reveal an inline composer for `localDateKey()` at the top of the All Actions list.
  - [x] 🟩 If the All Actions page is empty, show the plus composer in the empty state so users can add the first standalone action without needing a meeting.
  - [x] 🟩 After creating a today action from All Actions, insert it into local state and ensure today’s group exists.
  - [x] 🟩 Default-expand the newly created action’s date group or force-open today’s group so the user can see the action they just added.

- [x] 🟩 **Step 8: Add Per-Date Group Creation In All Actions**
  - [x] 🟩 Add a small plus button to each `TodosDateGroup` header, separate from the expand/collapse click target.
  - [x] 🟩 Stop propagation from the group plus button so adding a todo does not toggle the group open/closed unexpectedly.
  - [x] 🟩 When clicked, expand that group and show the inline composer inside that group.
  - [x] 🟩 Create the new todo using the group’s `date`, not today.
  - [x] 🟩 Insert the returned todo into the correct date group and set focus to the new row.

- [x] 🟩 **Step 9: Make Local State Updates Additive And Race-Safe**
  - [x] 🟩 Replace the current `handleAdd(markdown, json)` with `handleAddForDate(date, markdown, json)` so creation is explicit by date.
  - [x] 🟩 Use functional `setTodos(prev => [...prev, newTodo])` or date-aware insertion; never replace the full list after manual creation unless refetching because of an error.
  - [x] 🟩 In All Actions, keep grouping derived from `todos` so manual and extracted actions naturally appear together.
  - [x] 🟩 Avoid any UI code that filters out `meeting_id = null`; standalone manual actions must appear alongside extracted actions.
  - [x] 🟩 Ensure failure handling does not lose current local todos: if creation fails, show `toast.error("Failed to create action")` and leave the existing list unchanged.

- [x] 🟩 **Step 10: Guard AI Cleanup Additive Behavior**
  - [x] 🟩 Do not modify `delete_extracted_by_meeting` to delete all meeting todos or all date todos.
  - [x] 🟩 Do not set `source_text` for manual todos.
  - [x] 🟩 Do not attach manually created Actions-page todos to the most recent meeting by default.
  - [x] 🟩 Verify this scenario manually or with tests:
    - User creates standalone manual action for today.
    - User runs AI cleanup on a meeting from today.
    - Extracted meeting actions are added to today.
    - Manual action remains visible and unchanged.
    - User regenerates AI cleanup for that meeting.
    - Old extracted actions for that meeting are replaced.
    - Manual action remains visible and unchanged.

- [x] 🟩 **Step 11: Polish Empty, Loading, And Accessibility States**
  - [x] 🟩 Update empty-state copy in All Actions to mention both automatic capture and manual action creation.
  - [x] 🟩 Update empty-state copy in date view to use “actions” consistently and point to the plus button.
  - [x] 🟩 Add `aria-label="Add action"` or date-specific labels such as `Add action for July 10, 2026`.
  - [x] 🟩 Ensure buttons have visible focus states and minimum clickable area.
  - [x] 🟩 Ensure the plus composer is usable on narrow/mobile widths.

- [ ] 🟥 **Step 12: Verification**
  - [x] 🟩 Run frontend lint or typecheck if available from `frontend`.
  - [x] 🟩 Run Rust tests/checks for the Tauri crate after extractor changes.
  - [x] 🟩 Verify notes extraction catches the reported production examples.
  - [x] 🟩 Verify transcript extraction still runs when notes extraction also finds items.
  - [ ] 🟥 Manually verify daily view:
    - Plus opens composer.
    - Enter creates a new unchecked action.
    - Blank input does not create an action.
    - Escape cancels.
    - Sidebar date counts update.
  - [ ] 🟥 Manually verify All Actions:
    - Header plus creates a today action.
    - Empty All Actions can create first action.
    - Date-group plus creates an action for that specific date.
    - Created action appears in the expected group.
  - [ ] 🟥 Manually verify AI cleanup coexistence with manually added actions.

## Files Expected To Change
- `frontend/src/components/Todos/TodosPage.tsx`
- Possibly `frontend/src/lib/todoApi.ts` only if the frontend API wrapper needs a clearer helper name; not required for functionality.
- Possibly `frontend/src-tauri/src/database/repositories/todos.rs` tests only if adding DB-level coverage.
- `frontend/src-tauri/src/summary/todo_extractor.rs`
- Possibly `frontend/src-tauri/src/summary/service.rs` only if additional non-sensitive diagnostics need to be surfaced around the existing extraction call.

## Non-Goals
- No database schema migration is required.
- No separate “manual action” table is required.
- No changes to meeting note markdown storage are required.
- No AI cleanup summary prompt changes are required. The transcript action-extraction prompt may be adjusted only if tests show the current prompt still misses explicit transcript commitments after always-running transcript extraction.
- No modal, command palette, or multi-field task editor is required for this feature.

## Risks And Mitigations
- **Risk:** Manual actions accidentally disappear after AI cleanup regeneration.
  - **Mitigation:** Keep manual actions as `source_text = null` and preserve the existing `delete_extracted_by_meeting` filter.
- **Risk:** All Actions header plus creates an action for an unexpected date.
  - **Mitigation:** Define the default as `localDateKey()` and use date-group plus buttons for specific historical dates.
- **Risk:** Plus button inside a date group toggles expansion instead of opening composer.
  - **Mitigation:** Separate the plus button from the group toggle and call `event.stopPropagation()`.
- **Risk:** New inline composer creates blank todos.
  - **Mitigation:** Trim text and no-op on empty input.
- **Risk:** Newly created items are hidden inside a collapsed group.
  - **Mitigation:** Expand the target group after creation and focus the newly created row.
- **Risk:** Relaxing notes parsing accepts non-action takeaways.
  - **Mitigation:** Only accept owner-assignment syntax when the action portion starts with `to <known action verb>` or an existing known action verb, and add negative tests.
- **Risk:** Running both notes and transcript extraction creates duplicate actions.
  - **Mitigation:** Normalize and de-duplicate merged action text before saving.

**Status Tracking:**
- 🟩 Done
- 🟨 In Progress
- 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.
