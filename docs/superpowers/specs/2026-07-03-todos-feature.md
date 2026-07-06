# To-Do's Feature Specification

**Date:** 2026-07-03
**Status:** Draft

---

## TLDR

Add a daily consolidated to-do list view to Adamant. When the user runs AI cleanup on a meeting note, the same LLM extracts action items/todos from that meeting. Todos are grouped by day in a new "To Do's" sidebar section with date-nested folders. Each todo is a rich-text checklist item with a hyperlink back to its source meeting note.

---

## Data Model

### New SQLite Table: `todos`

```sql
CREATE TABLE todos (
    id              TEXT PRIMARY KEY NOT NULL,
    meeting_id      TEXT NOT NULL,
    date            TEXT NOT NULL,              -- ISO-8601 date: "2026-07-03"
    content_json    TEXT,                        -- BlockNote JSON (rich text)
    content_markdown TEXT,                       -- Markdown fallback
    is_checked      INTEGER NOT NULL DEFAULT 0,  -- 0 = unchecked, 1 = checked
    sort_order      INTEGER NOT NULL DEFAULT 0,
    source_text     TEXT,                        -- The original extracted sentence (for reference)
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX idx_todos_date ON todos(date);
CREATE INDEX idx_todos_meeting ON todos(meeting_id);
```

### Migration File

**File:** `frontend/src-tauri/migrations/20260703000000_add_todos.sql`

Follows the same naming convention as existing migrations. The migration is additive-only (no destructive changes).

### Rust Model

**File:** `frontend/src-tauri/src/database/models.rs`

Add a `TodoModel` struct:

```rust
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TodoModel {
    pub id: String,
    pub meeting_id: String,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub is_checked: bool,
    pub sort_order: i64,
    pub source_text: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}
```

### API Response Types (Frontend)

**File:** `frontend/src/types/index.ts`

Add:

```typescript
export interface Todo {
  id: string;
  meeting_id: string;
  meeting_title: string;       // Denormalized for display
  date: string;                // "2026-07-03"
  content_json?: BlockNoteBlock[];
  content_markdown?: string;
  is_checked: boolean;
  sort_order: number;
  source_text?: string;
  created_at: string;
  updated_at: string;
}

export interface TodoDateGroup {
  date: string;               // "2026-07-03"
  display_label: string;      // "7/3/2026" (for sidebar)
  todos: Todo[];
  total_count: number;
  unchecked_count: number;
}
```

---

## LLM Integration: Todo Extraction

### Overview

When the summary generation completes successfully, the system automatically runs an additional lightweight LLM pass to extract todos from the *same transcript*. This runs as a continuation of the existing `process_transcript_background` function in `summary/service.rs`.

### Flow

```
api_process_transcript called
  → process_transcript_background (existing)
    → generate_meeting_summary (existing)
    → If successful:
        → extract_todos_from_transcript (NEW)
          → Uses same LLM provider + model
          → Sends focused extraction prompt
          → Parses structured JSON response
          → Saves todos to `todos` table
    → Update process status to "completed" (existing)
```

### Extraction Prompt (in `processor.rs` or a new `todo_extractor.rs`)

A focused, lightweight prompt:

```
SYSTEM:
You are an action-item extractor. Your task is to read a meeting transcript and
extract every action item, to-do, commitment, task, deadline, or follow-up
mentioned. Return the results as a JSON array of objects.

Each object must have:
  "text": a clear, self-contained description of the to-do
  "owner": the person responsible (if explicitly stated; otherwise null)
  "deadline": any specific deadline mentioned (if stated; otherwise null)

Rules:
- Only extract items that are explicitly stated as to-dos or commitments
- Do NOT extract general discussion topics, decisions, or opinions
- Do NOT invent owners or deadlines
- If nothing qualifies, return an empty array []
- Output ONLY valid JSON. No preamble, no markdown fences.

USER PROMPT:

=== MEETING METADATA ===
Title: {title}
Date: {date}

=== TRANSCRIPT ===
{transcript}
```

### Implementation: `TodoExtractorService`

**New file:** `frontend/src-tauri/src/summary/todo_extractor.rs`

A new module containing:

| Function | Description |
|----------|-------------|
| `extract_todos(...)` | Calls the LLM with the extraction prompt, parses JSON response |
| `save_extracted_todos(...)` | Batch-inserts todos into the DB, linked to the meeting |

The extraction uses the same `generate_summary()` function from `llm_client.rs` (reuses the HTTP client, provider resolution, and auth flow).

### Configuration

Todo extraction:
- Uses the **same model and provider** as the summary generation
- Runs a separate LLM call (not combined into the summary prompt) to keep concerns separated
- Max tokens for extraction: `512` (small output — just a JSON array)
- Temperature: `0.1` (deterministic extraction)
- Timeout: `60 seconds`

### Hook into `service.rs`

After `generate_meeting_summary()` succeeds (around line 231), add:

```rust
// After summary is saved successfully, extract todos
let todo_result = TodoExtractor::extract_todos(
    client,
    provider,
    model_name,
    api_key,
    &meeting_id,
    &text,
    &title,
    &date_str,
    ollama_endpoint,
    custom_openai_endpoint,
    cancellation_token.clone(),
    &pool,
).await;

match todo_result {
    Ok(count) => info!("Extracted {} todos for meeting {}", count, meeting_id),
    Err(e) => warn!("Todo extraction failed (non-fatal): {}", e),
    // Extraction failure does NOT fail the summary — it's best-effort
}
```

Key design decision: **Todo extraction failure is non-fatal**. If the LLM call fails or returns unparseable JSON, the summary still completes successfully. The user can always manually add todos.

---

## Rust Backend: Tauri Commands

### New Commands

All new commands go in a new file `frontend/src-tauri/src/api/todos_api.rs`.

| Command | Signature | Description |
|---------|-----------|-------------|
| `api_get_todos_by_date` | `(date: String) → Vec<Todo>` | Get all todos for a specific date |
| `api_get_todo_dates` | `() → Vec<{date: String, count: i32, unchecked: i32}>` | Get all dates that have todos (for sidebar grouping) |
| `api_get_meeting_todos` | `(meeting_id: String) → Vec<Todo>` | Get all todos linked to a specific meeting |
| `api_create_todo` | `(meeting_id, date, content_json, content_markdown) → Todo` | Create a new todo (manual) |
| `api_update_todo` | `(todo_id, content_json, content_markdown) → Todo` | Update todo content |
| `api_toggle_todo` | `(todo_id, is_checked) → Todo` | Toggle checklist state |
| `api_delete_todo` | `(todo_id) → ()` | Delete a todo |
| `api_reorder_todos` | `(date: String, todo_ids: Vec<String>) → ()` | Save new sort order for all todos on a date |

### Command Registration

**File:** `frontend/src-tauri/src/lib.rs`

Add to the `invoke_handler`:

```rust
// Todo commands
todos_api::api_get_todos_by_date,
todos_api::api_get_todo_dates,
todos_api::api_get_meeting_todos,
todos_api::api_create_todo,
todos_api::api_update_todo,
todos_api::api_toggle_todo,
todos_api::api_delete_todo,
todos_api::api_reorder_todos,
```

### Module Structure

```
frontend/src-tauri/src/
├── api/
│   ├── mod.rs              → Add `pub mod todos_api;`
│   └── todos_api.rs        → NEW: todo Tauri commands
├── summary/
│   ├── mod.rs              → Add `pub mod todo_extractor;`
│   ├── todo_extractor.rs   → NEW: LLM extraction logic
│   ├── service.rs          → Modify: hook todo extraction after summary
│   └── ...
└── database/
    ├── models.rs           → Add TodoModel
    ├── repositories/
    │   ├── mod.rs          → Add `pub mod todos;`
    │   └── todos.rs        → NEW: TodoRepository (CRUD operations)
    └── ...
```

### TodoRepository

**File:** `frontend/src-tauri/src/database/repositories/todos.rs`

| Method | SQL |
|--------|-----|
| `get_by_date(pool, date)` | `SELECT t.*, m.title as meeting_title FROM todos t JOIN meetings m ON t.meeting_id = m.id WHERE t.date = ? ORDER BY t.sort_order ASC` |
| `get_dates(pool)` | `SELECT date, COUNT(*) as count, SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked FROM todos GROUP BY date ORDER BY date DESC` |
| `get_by_meeting(pool, meeting_id)` | Filter by meeting_id |
| `create(...)` | `INSERT INTO todos ...` |
| `update(pool, todo_id, content_json, content_markdown)` | `UPDATE todos SET ...` |
| `toggle(pool, todo_id, is_checked)` | `UPDATE todos SET is_checked = ? ...` |
| `delete(pool, todo_id)` | `DELETE FROM todos WHERE id = ?` |
| `reorder(pool, date, todo_ids)` | Batch update sort_order based on array position |
| `batch_insert(pool, todos)` | Used by the extractor to insert multiple todos at once |

---

## Frontend: New Route & UI

### New Route: `/todos`

**File:** `frontend/src/app/todos/page.tsx`

A new Next.js route. Query parameter:

| Param | Type | Description |
|-------|------|-------------|
| `date` | `YYYY-MM-DD` | The day to display. Defaults to today. |

### Todo Page Component

**File:** `frontend/src/components/Todos/TodosPage.tsx`

This is the main todo view for a given day. It mirrors the layout and feel of the existing meeting notes page.

Layout:
```
┌─────────────────────────────────────┐
│ ← Back arrow  [Today]  [7/3/2026]  │  ← Header with date picker/arrows
├─────────────────────────────────────┤
│                                     │
│  ☐ Ship v0.6.1 by Friday            │  ← Each todo = checkbox + rich text
│    ─ from "Standup 7/3" → 📎       │  ← Source meeting hyperlink
│                                     │
│  ☐ Review PR #42                    │
│    ─ from "Standup 7/3" → 📎       │
│                                     │
│  ☐ [type your own todo...]          │  ← Empty row for manual addition
│                                     │
│  ──────── Completed ────────        │  ← Collapsible completed section
│  ✅ Update docs (checked 2h ago)    │
│                                     │
├─────────────────────────────────────┤
│  [Today's Summary]                   │
│  3 unchecked · 1 completed          │  ← Footer stats bar
└─────────────────────────────────────┘
```

Behavior:
- **Checkbox**: Clicking a checkbox calls `api_toggle_todo` and visually strikes through the item
- **Rich text**: Each todo uses an inline BlockNote editor (single line or short paragraph)
- **Source link**: Each todo row shows the meeting title as a clickable link → navigates to `/meeting-details?id=<meeting_id>`
- **Manual add**: A blank row at the top/bottom for typing new todos manually
- **Date navigation**: Left/right arrows to navigate between days
- **Today button**: Jumps to today's date
- **Auto-save**: Content changes are debounced and auto-saved (same pattern as NotesPanel)

### BlockNote Editor per Todo

Each todo item uses a mini BlockNote editor instance. This gives us:
- Rich text: bold, italic, links, bullet lists inside the todo
- Consistent with the existing note-taking UX
- Slash commands for quick formatting

Implementation approach:
- Single `useCreateBlockNote` per todo row (or a shared editor with per-row state)
- Constrained height (max 3 lines, with expand-on-focus)
- Same auto-save pattern (2-second debounce)

### Sidebar: "To Do's" Section

**File:** `frontend/src/components/Sidebar/index.tsx`

Add a new collapsible section between `Meeting Notes` and `By Date`:

```
▼ To Do's                               (3 unchecked today)
  ├── 📋 Today (2)                      ← Always visible, quick link
  ├── 📅 7/3/2026 (3)                   ← Date folders (newest first)
  ├── 📅 7/2/2026 (1)
  └── 📅 7/1/2026 (5)
```

Behavior (mirrors the "By Date" section):

| Feature | Implementation |
|---------|---------------|
| Collapse state | Persisted in localStorage: `sidebar-todos-collapsed` |
| Date groups | Each date with todos becomes a collapsible sub-group |
| Per-date collapse | Persisted: `sidebar-todos-date-<dateLabel>` |
| Date format | Same as "By Date": `M/D/YYYY` |
| Sort order | Newest first |
| Count badge | Shows unchecked count (e.g., "3") |
| Click behavior | Clicking a date → navigates to `/todos?date=2026-07-03` |
| Data source | Fetched from `api_get_todo_dates` (lightweight, just dates + counts) |
| Refresh | Re-fetched when sidebar mounts and after summary/todo mutations |

### Sidebar todo preview

When a date group is expanded, show the first 3 unchecked todos as inline previews:

```
  ▼ 📅 7/3/2026 (3)
     ☐ Ship v0.6.1 by Friday
     ☐ Review PR #42
     ☐ Write release notes
     + 3 more →        (if > 3 items)
```

Each preview is truncated to one line. Clicking a preview navigates to `/todos?date=2026-07-03`.

### Homepage Access

**File:** `frontend/src/app/page.tsx`

Add a "To Do's" section below the welcome message:

```typescript
// On the homepage, show a quick summary of today's todos
{/* Todo Quick View */}
<div className="mt-8 w-full max-w-md">
  <div className="flex items-center justify-between mb-3">
    <h2 className="text-sm font-medium text-zinc-300">Today's To-Dos</h2>
    <Link href="/todos" className="text-xs text-emerald-500 hover:text-emerald-400">
      View all →
    </Link>
  </div>
  
  {todayTodos.length === 0 ? (
    <p className="text-xs text-zinc-500">No todos for today. Run AI cleanup on a meeting to get started.</p>
  ) : (
    <div className="space-y-1">
      {todayTodos.slice(0, 5).map(todo => (
        <div key={todo.id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={todo.is_checked}
            onChange={() => toggleTodo(todo.id, !todo.is_checked)} />
          <span className={todo.is_checked ? 'line-through text-zinc-500' : 'text-zinc-300'}>
            {todo.content_markdown || todo.source_text}
          </span>
        </div>
      ))}
      {todayTodos.length > 5 && (
        <p className="text-xs text-zinc-500">+{todayTodos.length - 5} more</p>
      )}
    </div>
  )}
</div>
```

### SidebarProvider Changes

**File:** `frontend/src/components/Sidebar/SidebarProvider.tsx`

Add to context:

```typescript
interface SidebarContextType {
  // ... existing fields ...
  
  // Todo state
  todoDates: TodoDateSummary[];       // {date, count, unchecked}
  todayTodos: Todo[];
  fetchTodoDates: () => Promise<void>;
  refreshTodoDates: () => Promise<void>;
}
```

- `todoDates` — fetched from `api_get_todo_dates` on mount
- `todayTodos` — filtered from full data or fetched separately
- `refreshTodoDates` — called after successful summary generation to refresh the sidebar

---

## UI States

| State | Behavior |
|-------|----------|
| **No todos exist** | Sidebar "To Do's" section shows "No todos yet. AI cleanup will generate them." Homepage shows similar empty state |
| **Loading** | Skeleton placeholders (3 lines shimmer) for sidebar date list and todo page |
| **Error fetching** | Toast notification: "Failed to load todos." Sidebar section collapses gracefully |
| **Empty day** | `/todos?date=2026-07-03` shows "No todos for this day" with a manual add prompt |
| **Todo extraction in progress** | Sidebar shows subtle "Extracting todos..." note below the meeting in "By Date" section |
| **Extraction fails** | No user-visible error. The meeting summary still succeeded. User can manually add todos |
| **Meeting deleted** | CASCADE deletes its todos. Sidebar refreshes automatically |

---

## Implementation Plan

Each step is a small, check-off-able unit of work. Steps within a phase can be done in order; phases should be completed in sequence.

---

### Phase 1: Data Layer (Rust — Migration + Model + Repository)

#### Step 1.1 — Create SQL migration file

**File:** `frontend/src-tauri/migrations/20260703000000_add_todos.sql`

Write the `CREATE TABLE` statement with all columns, indexes, and foreign key. Follow the exact formatting of existing migrations (e.g., `20260520000000_add_folder_sort_order.sql`).

```sql
CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    content_json TEXT,
    content_markdown TEXT,
    is_checked INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);
CREATE INDEX IF NOT EXISTS idx_todos_meeting ON todos(meeting_id);
```

**Verify:** Run `cargo check` — the SQL file itself is not compiled, but confirm it parses in SQLite (`sqlite3 :memory: < migration_file`).

#### Step 1.2 — Add `TodoModel` to `database/models.rs`

**File:** `frontend/src-tauri/src/database/models.rs`

Add a new struct after `FolderModel`:

```rust
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TodoModel {
    pub id: String,
    pub meeting_id: String,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub is_checked: bool,
    pub sort_order: i64,
    pub source_text: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoWithMeeting {
    pub id: String,
    pub meeting_id: String,
    pub meeting_title: String,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub is_checked: bool,
    pub sort_order: i64,
    pub source_text: Option<String>,
    pub created_at: DateTimeUtc,
    pub updated_at: DateTimeUtc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TodoDateSummary {
    pub date: String,
    pub count: i64,
    pub unchecked: i64,
}
```

Note: `TodoWithMeeting` is the JOIN result (todos + meetings.title). `TodoDateSummary` is the GROUP BY result for the sidebar date list.

**Verify:** `cargo check` compiles.

#### Step 1.3 — Create `database/repositories/todos.rs`

**File:** `frontend/src-tauri/src/database/repositories/todos.rs`

Implement 9 methods on a `TodosRepository` struct, plus a helper for the upsert-style `batch_insert`:

| Method | Signature | SQL Pattern |
|--------|-----------|-------------|
| `get_by_date` | `async fn get_by_date(pool: &SqlitePool, date: &str) -> Result<Vec<TodoWithMeeting>>` | `SELECT t.*, m.title as meeting_title FROM todos t JOIN meetings m ON t.meeting_id = m.id WHERE t.date = ? ORDER BY t.sort_order ASC, t.created_at ASC` |
| `get_dates` | `async fn get_dates(pool: &SqlitePool) -> Result<Vec<TodoDateSummary>>` | `SELECT date, COUNT(*) as count, SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked FROM todos GROUP BY date ORDER BY date DESC` |
| `get_by_meeting` | `async fn get_by_meeting(pool: &SqlitePool, meeting_id: &str) -> Result<Vec<TodoModel>>` | `SELECT * FROM todos WHERE meeting_id = ? ORDER BY sort_order ASC` |
| `get_today` | `async fn get_today(pool: &SqlitePool) -> Result<Vec<TodoWithMeeting>>` | Same as `get_by_date` with `date('now', 'localtime')` |
| `create` | `async fn create(pool: &SqlitePool, todo: &NewTodo) -> Result<TodoModel>` | `INSERT INTO todos (id, meeting_id, date, content_json, content_markdown, sort_order, source_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)` |
| `update_content` | `async fn update_content(pool: &SqlitePool, id: &str, content_json: Option<&str>, content_markdown: Option<&str>) -> Result<()>` | `UPDATE todos SET content_json = ?, content_markdown = ?, updated_at = ? WHERE id = ?` |
| `toggle` | `async fn toggle(pool: &SqlitePool, id: &str, is_checked: bool) -> Result<()>` | `UPDATE todos SET is_checked = ?, updated_at = ? WHERE id = ?` |
| `delete` | `async fn delete(pool: &SqlitePool, id: &str) -> Result<()>` | `DELETE FROM todos WHERE id = ?` |
| `reorder` | `async fn reorder(pool: &SqlitePool, date: &str, todo_ids: &[String]) -> Result<()>` | Iterate with index, `UPDATE todos SET sort_order = ? WHERE id = ? AND date = ?` |
| `batch_insert` | `async fn batch_insert(pool: &SqlitePool, todos: &[NewTodo]) -> Result<usize>` | For each: `INSERT OR IGNORE INTO todos ...` (dedup by source_text hash or meeting_id+text) |

**New helper types** (also define in this file or in a types module):

```rust
pub struct NewTodo {
    pub id: String,
    pub meeting_id: String,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub sort_order: i64,
    pub source_text: Option<String>,
}
```

All methods take `&SqlitePool` (not a transaction) unless batch operations need a transaction. Use `sqlx::query_as` for reads and `sqlx::query` for writes.

**Verify:** `cargo check` compiles.

#### Step 1.4 — Register repository module

**File:** `frontend/src-tauri/src/database/repositories/mod.rs`

Add: `pub mod todos;`

**Verify:** `cargo check` compiles.

---

### Phase 2: Rust API Commands (Tauri)

#### Step 2.1 — Create `api/todos_api.rs`

**File:** `frontend/src-tauri/src/api/todos_api.rs`

Create a new file. The structure follows the pattern in `api/api.rs` — each command is a `#[tauri::command] pub async fn` that receives `state: tauri::State<'_, AppState>` and delegates to the repository.

Implement these 8 commands:

| Command | Signature | Impl Pattern |
|---------|-----------|--------------|
| `api_get_todos_by_date` | `(state, date: String) -> Result<Vec<TodoWithMeeting>, String>` | `TodosRepository::get_by_date(pool, &date).await.map_err(...)` |
| `api_get_todo_dates` | `(state) -> Result<Vec<TodoDateSummary>, String>` | `TodosRepository::get_dates(pool).await.map_err(...)` |
| `api_get_today_todos` | `(state) -> Result<Vec<TodoWithMeeting>, String>` | `TodosRepository::get_today(pool).await.map_err(...)` |
| `api_get_meeting_todos` | `(state, meeting_id: String) -> Result<Vec<TodoModel>, String>` | `TodosRepository::get_by_meeting(pool, &meeting_id).await.map_err(...)` |
| `api_create_todo` | `(state, meeting_id, date, content_json, content_markdown) -> Result<TodoModel, String>` | Generate UUID, call `TodosRepository::create(...)` |
| `api_update_todo` | `(state, todo_id, content_json, content_markdown) -> Result<(), String>` | `TodosRepository::update_content(pool, &todo_id, ...).await.map_err(...)` |
| `api_toggle_todo` | `(state, todo_id, is_checked: bool) -> Result<(), String>` | `TodosRepository::toggle(pool, &todo_id, is_checked).await.map_err(...)` |
| `api_delete_todo` | `(state, todo_id) -> Result<(), String>` | `TodosRepository::delete(pool, &todo_id).await.map_err(...)` |

UUID generation: `format!("todo-{}", uuid::Uuid::new_v4())` — match the pattern used for meeting IDs (e.g., `meeting-<uuid>`).

Date derivation: For manually created todos, the frontend passes the date string `YYYY-MM-DD`. For extracted todos, derive from the meeting's `created_at` date.

**Verify:** `cargo check` compiles.

#### Step 2.2 — Register API module

**File:** `frontend/src-tauri/src/api/mod.rs`

Add: `pub mod todos_api;`

**Verify:** `cargo check` compiles.

#### Step 2.3 — Register Tauri commands in `lib.rs`

**File:** `frontend/src-tauri/src/lib.rs`

Add to the `invoke_handler` array (around line 754, after folder commands, before summary commands):

```rust
// Todo commands
todos_api::api_get_todos_by_date,
todos_api::api_get_todo_dates,
todos_api::api_get_today_todos,
todos_api::api_get_meeting_todos,
todos_api::api_create_todo,
todos_api::api_update_todo,
todos_api::api_toggle_todo,
todos_api::api_delete_todo,
```

**Verify:** `cargo check` compiles.

#### Step 2.4 — Smoke-test the commands

```bash
cd frontend && cargo check
cd src-tauri && cargo build 2>&1 | tail -20
```

If the build succeeds, the commands are wired correctly. Full integration testing requires the frontend to call them.

---

### Phase 3: LLM Extraction (Rust)

#### Step 3.1 — Create `summary/todo_extractor.rs`

**File:** `frontend/src-tauri/src/summary/todo_extractor.rs`

This module contains:

```rust
pub struct TodoExtractor;
```

Two public methods:

**`extract_todos_from_transcript`** — the orchestrator:

```rust
pub async fn extract_todos_from_transcript<R: tauri::Runtime>(
    _app: AppHandle<R>,
    pool: &SqlitePool,
    meeting_id: &str,
    title: &str,
    date: &str,
    transcript_text: &str,
    provider: LLMProvider,
    model_name: &str,
    api_key: &Option<String>,
    ollama_endpoint: &Option<String>,
    custom_openai_endpoint: &Option<String>,
    cancellation_token: Option<CancellationToken>,
) -> Result<usize, String> {
    // 1. Build the extraction prompt
    // 2. Call generate_summary (reuse from llm_client.rs)
    // 3. Parse the JSON response
    // 4. Call save_todos_to_db
    // 5. Return count of extracted todos
}
```

**`build_extraction_prompt`** — builds system + user prompt:

```rust
fn build_extraction_prompt(title: &str, date: &str, transcript: &str) -> (String, String) {
    let system_prompt = r#"You are an action-item extractor. Your task is to read a meeting transcript and extract every action item, to-do, commitment, task, deadline, or follow-up mentioned. Return ONLY a JSON array of objects, each with:
  "text": a clear, self-contained description (max 120 chars)
  "owner": person responsible (null if not stated)
  "deadline": specific deadline mentioned (null if not stated)

Rules:
- Only extract items explicitly stated as to-dos, commitments, or action items
- Do NOT extract general topics, decisions, or opinions
- Do NOT invent owners or deadlines
- If nothing qualifies, return []
- Output ONLY valid JSON. No preamble, no markdown fences."#;

    let user_prompt = format!(
        "=== MEETING METADATA ===\nTitle: {title}\nDate: {date}\n\n=== TRANSCRIPT ===\n{transcript}\n\nExtract action items:",
        title = title, date = date, transcript = transcript
    );

    (system_prompt.to_string(), user_prompt)
}
```

**`parse_extraction_response`** — parse the LLM output into structured items:

```rust
fn parse_extraction_response(raw: &str) -> Result<Vec<ExtractedTodo>, String> {
    // Strip any markdown code fences if present
    // Parse JSON array
    // Validate each item has "text" field
    // Return Vec<ExtractedTodo>
}

struct ExtractedTodo {
    text: String,
    owner: Option<String>,
    deadline: Option<String>,
}
```

**`save_todos_to_db`** — batch-insert extracted todos:

```rust
async fn save_todos_to_db(pool: &SqlitePool, meeting_id: &str, date: &str, items: &[ExtractedTodo]) -> Result<usize, String> {
    // Map ExtractedTodo -> NewTodo
    // Generate deterministic IDs (or UUIDs)
    // Build content_markdown from text (with owner/deadline appended if present)
    // Build content_json as simple BlockNote paragraph
    // Call TodosRepository::batch_insert
    // Return count
}
```

Content mapping:
- `content_markdown` = `text` (if no owner/deadline) or `text (owner: {owner}, deadline: {deadline})`
- `content_json` = simple BlockNote JSON: `[{"id":"...", "type":"paragraph", "content":[{"type":"text", "text":"...", "styles":{}}]}]`
- `source_text` = `text` (original extracted sentence)
- `sort_order` = index in the array

**Verify:** `cargo check` compiles.

#### Step 3.2 — Register the module

**File:** `frontend/src-tauri/src/summary/mod.rs`

Add: `pub mod todo_extractor;`

**Verify:** `cargo check` compiles.

#### Step 3.3 — Hook into `summary/service.rs`

**File:** `frontend/src-tauri/src/summary/service.rs`

After successful summary saving (after line ~231 where `update_meeting_summary` succeeds), insert:

```rust
use crate::summary::todo_extractor::TodoExtractor;

// ... inside process_transcript_background, after summary is saved ...

// --- Todo Extraction ---
// Best-effort: failure is non-fatal to the summary
let todo_extraction_future = async {
    // Build the date string from the meeting's created_at
    // Fetch meeting metadata if needed for date
    let meeting_repo = MeetingsRepository;
    let meeting = match meeting_repo.get_by_id(&pool, &meeting_id).await {
        Ok(Some(m)) => m,
        _ => return, // skip extraction if we can't find the meeting
    };
    let meeting_date = meeting.created_at.0.format("%Y-%m-%d").to_string();

    match TodoExtractor::extract_todos_from_transcript(
        _app.clone(),
        &pool,
        &meeting_id,
        &title,           // meeting title
        &meeting_date,
        &text,            // the full transcript text
        provider,
        &model_name,
        &api_key,
        &ollama_endpoint,
        &custom_openai_endpoint,
        Some(cancellation_token.clone()),
    ).await {
        Ok(count) => info!("Extracted {} todos for meeting {}", count, meeting_id),
        Err(e) => warn!("Todo extraction skipped for {} (non-fatal): {}", meeting_id, e),
    }
};

// Spawn extraction as a separate task so it doesn't delay the summary response
// (The summary status is already set to "completed" at this point)
tokio::spawn(todo_extraction_future);
```

Key nuance: The extraction should be spawned as a **separate `tokio::spawn`** so that the summary completion is not delayed. The summary status is already set to `completed` before this runs.

Also add a brief note in the summary result so the frontend knows extraction is pending:

```rust
// In the summary result JSON, add an extraction_status field
let result_json = serde_json::json!({
    "markdown": final_markdown,
    "summary_json": parsed_blocks,
    "extraction_status": "pending",  // NEW: signals that todo extraction was kicked off
});
```

**Verify:** `cargo check` compiles.

---

### Phase 4: Frontend — Types

#### Step 4.1 — Add frontend type definitions

**File:** `frontend/src/types/index.ts`

Add at the end of the file:

```typescript
export interface Todo {
  id: string;
  meeting_id: string;
  meeting_title: string;
  date: string;
  content_json?: BlockNoteBlock[] | null;
  content_markdown?: string | null;
  is_checked: boolean;
  sort_order: number;
  source_text?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TodoDateSummary {
  date: string;
  count: number;
  unchecked: number;
}
```

**Verify:** TypeScript compiles (`pnpm run dev` or `npx tsc --noEmit`).

#### Step 4.2 — Add todo invoke helpers

**File:** `frontend/src/lib/api.ts` (or create `frontend/src/lib/todoApi.ts` if no centralized API file exists)

Add a set of helper functions that wrap `invoke()` calls:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { Todo, TodoDateSummary } from '@/types';

export async function getTodosByDate(date: string): Promise<Todo[]> {
  return invoke('api_get_todos_by_date', { date });
}

export async function getTodoDates(): Promise<TodoDateSummary[]> {
  return invoke('api_get_todo_dates');
}

export async function getTodayTodos(): Promise<Todo[]> {
  return invoke('api_get_today_todos');
}

export async function getMeetingTodos(meetingId: string): Promise<Todo[]> {
  return invoke('api_get_meeting_todos', { meetingId });
}

export async function createTodo(
  meetingId: string,
  date: string,
  contentJson: string | null,
  contentMarkdown: string | null
): Promise<Todo> {
  return invoke('api_create_todo', { meetingId, date, contentJson, contentMarkdown });
}

export async function updateTodo(
  todoId: string,
  contentJson: string | null,
  contentMarkdown: string | null
): Promise<void> {
  return invoke('api_update_todo', { todoId, contentJson, contentMarkdown });
}

export async function toggleTodo(todoId: string, isChecked: boolean): Promise<void> {
  return invoke('api_toggle_todo', { todoId, isChecked });
}

export async function deleteTodo(todoId: string): Promise<void> {
  return invoke('api_delete_todo', { todoId });
}
```

**Verify:** TypeScript compiles.

---

### Phase 5: Frontend — Todo Page

#### Step 5.1 — Create the Next.js route

**File:** `frontend/src/app/todos/page.tsx`

Minimal route component:

```typescript
'use client';

import { Suspense } from 'react';
import { TodosPage } from '@/components/Todos/TodosPage';

export default function TodosRoute() {
  return (
    <Suspense fallback={<div className="p-8 text-zinc-500">Loading...</div>}>
      <TodosPage />
    </Suspense>
  );
}
```

Must be a `'use client'` component because it uses `useSearchParams()` and hooks.

Place it at the same level as `meeting-details/page.tsx` and `settings/page.tsx`.

**Verify:** App runs, route `/todos` is accessible without 404.

#### Step 5.2 — Create TodosPage component shell

**File:** `frontend/src/components/Todos/TodosPage.tsx`

Initial shell with:

- `'use client'` directive
- `useSearchParams()` to read `date` param (default to today)
- State: `todos: Todo[]`, `loading: boolean`
- `useEffect` to fetch `getTodosByDate(date)` on mount and when date changes
- Basic render: header with date title, list of todos, loading state

Layout structure:

```typescript
export function TodosPage() {
  const searchParams = useSearchParams();
  const dateParam = searchParams.get('date');
  const todayStr = new Date().toISOString().split('T')[0];
  const activeDate = dateParam || todayStr;

  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getTodosByDate(activeDate).then(setTodos).finally(() => setLoading(false));
  }, [activeDate]);

  if (loading) return <LoadingSkeleton />;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <Header date={activeDate} />
      <TodoList todos={todos} onToggle={...} onUpdate={...} onDelete={...} />
      <AddTodoRow onAdd={...} />
    </div>
  );
}
```

**Verify:** Page loads and shows todos for a given date (even if empty).

#### Step 5.3 — Implement date header with navigation

Build the header component within `TodosPage.tsx`:

```typescript
function Header({ date }: { date: string }) {
  const router = useRouter();
  const prevDate = subtractDay(date);
  const nextDate = addDay(date);
  const isToday = date === new Date().toISOString().split('T')[0];

  return (
    <div className="flex items-center justify-between mb-6">
      <button onClick={() => router.back()}>
        <ArrowLeft className="w-5 h-5" />
      </button>
      <div className="flex items-center gap-3">
        <button onClick={() => router.push(`/todos?date=${prevDate}`)}>
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-semibold">{formatDateLabel(date)}</h1>
        <button onClick={() => router.push(`/todos?date=${nextDate}`)}>
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
      {!isToday && (
        <button onClick={() => router.push('/todos')} className="text-sm text-emerald-500">
          Today
        </button>
      )}
      {isToday && <div className="w-16" /> /* spacer */}
    </div>
  );
}
```

Helper functions:
- `formatDateLabel(date: string): string` — converts `"2026-07-03"` to `"Friday, July 3, 2026"`
- `subtractDay(date: string): string` — returns previous day in YYYY-MM-DD
- `addDay(date: string): string` — returns next day in YYYY-MM-DD

**Verify:** Date header renders, arrows navigate between days, "Today" button jumps to current date.

#### Step 5.4 — Implement todo list with checkboxes

Build the `TodoList` component:

```typescript
function TodoList({
  todos,
  onToggle,
  onUpdate,
  onDelete,
}: {
  todos: Todo[];
  onToggle: (id: string, checked: boolean) => void;
  onUpdate: (id: string, markdown: string, json: any) => void;
  onDelete: (id: string) => void;
}) {
  const unchecked = todos.filter(t => !t.is_checked);
  const checked = todos.filter(t => t.is_checked);

  return (
    <div className="space-y-1">
      {unchecked.map(todo => (
        <TodoRow key={todo.id} todo={todo} onToggle={onToggle} onUpdate={onUpdate} onDelete={onDelete} />
      ))}
      {checked.length > 0 && (
        <>
          <div className="border-t border-zinc-800 pt-3 mt-4">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Completed</span>
          </div>
          {checked.map(todo => (
            <TodoRow key={todo.id} todo={todo} onToggle={onToggle} onUpdate={onUpdate} onDelete={onDelete} />
          ))}
        </>
      )}
    </div>
  );
}
```

TodoRow renders:
- Checkbox input (`type="checkbox"`)
- Rich text content (placeholder for now — use plain text `content_markdown` until Step 5.6)
- Source meeting link
- Delete button

```typescript
function TodoRow({ todo, onToggle }: { todo: Todo; onToggle: (id: string, checked: boolean) => void }) {
  return (
    <div className={`flex items-start gap-3 py-1.5 group ${todo.is_checked ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={todo.is_checked}
        onChange={() => onToggle(todo.id, !todo.is_checked)}
        className="mt-1 accent-emerald-500 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className={todo.is_checked ? 'line-through text-zinc-500' : 'text-zinc-200'}>
          {todo.content_markdown || todo.source_text}
        </div>
        {todo.meeting_title && (
          <SourceLink meetingId={todo.meeting_id} meetingTitle={todo.meeting_title} />
        )}
      </div>
      <button
        onClick={() => deleteTodo(todo.id)}
        className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-opacity"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}
```

**SourceLink component:**

```typescript
function SourceLink({ meetingId, meetingTitle }: { meetingId: string; meetingTitle: string }) {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push(`/meeting-details?id=${meetingId}`)}
      className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors mt-0.5"
    >
      from {meetingTitle} ↗
    </button>
  );
}
```

**Verify:** Todos render with checkboxes, checking/unchecking toggles style, source link navigates to meeting.

#### Step 5.5 — Wire up toggle/delete callbacks

In `TodosPage`, implement the event handlers:

```typescript
const handleToggle = async (id: string, checked: boolean) => {
  // Optimistic update
  setTodos(prev => prev.map(t => t.id === id ? { ...t, is_checked: checked } : t));
  try {
    await invokeToggleTodo(id, checked);
  } catch (e) {
    // Revert on failure
    setTodos(prev => prev.map(t => t.id === id ? { ...t, is_checked: !checked } : t));
    toast.error('Failed to update todo');
  }
};

const handleDelete = async (id: string) => {
  setTodos(prev => prev.filter(t => t.id !== id));
  try {
    await invokeDeleteTodo(id);
  } catch (e) {
    // Refetch on failure
    getTodosByDate(activeDate).then(setTodos);
    toast.error('Failed to delete todo');
  }
};
```

**Verify:** Checkbox toggles work with optimistic UI, delete removes the row.

#### Step 5.6 — Implement rich text editing with BlockNote

Replace the plain text `<div>` in `TodoRow` with a BlockNote editor:

```typescript
function TodoEditor({ todo, onUpdate }: { todo: Todo; onUpdate: (id: string, markdown: string, json: any) => void }) {
  const editor = useCreateBlockNote({
    initialContent: todo.content_json ? (typeof todo.content_json === 'string' ? JSON.parse(todo.content_json) : todo.content_json) : undefined,
  });

  const debouncedSave = useRef(
    debounce(async () => {
      const blocks = await editor.blocksToTrustedHtml(); // or editorToMarkdown equivalent
      const markdown = await editor.blocksToMarkdown();
      const json = await editor.blocksToJson();
      onUpdate(todo.id, markdown, json);
    }, 2000)
  ).current;

  return (
    <BlockNoteView
      editor={editor}
      theme="dark"
      className="todo-editor"
      onChange={() => {
        debouncedSave();
      }}
    />
  );
}
```

Import from `@blocknote/react` and `@blocknote/shadcn`. Use the same CSS import as `NotesPanel.tsx`.

Constraint: Set `max-height` and `overflow-y: auto` via CSS class `todo-editor`:

```css
.todo-editor .bn-editor {
  max-height: 3em; /* ~3 lines */
  overflow-y: auto;
}
.todo-editor .bn-editor:focus-within {
  max-height: 200px; /* expand on focus */
}
```

**Verify:** Each todo shows a mini BlockNote editor. Clicking expands it. Typing auto-saves.

#### Step 5.7 — Implement manual todo creation

Add an "Add Todo" row at the top of the unchecked list:

```typescript
function AddTodoRow({ onAdd }: { onAdd: (markdown: string) => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const editor = useCreateBlockNote();

  const handleSubmit = async () => {
    const markdown = await editor.blocksToMarkdown();
    if (markdown.trim()) {
      onAdd(markdown);
      // Reset editor
      editor.replaceBlocks(editor.document, [{ type: 'paragraph', content: [] }]);
      setIsEditing(false);
    }
  };

  if (!isEditing) {
    return (
      <button onClick={() => setIsEditing(true)} className="text-sm text-zinc-500 hover:text-zinc-300 mt-2">
        + Add a to-do
      </button>
    );
  }

  return (
    <div className="flex items-start gap-3 py-1.5">
      <Square className="mt-1 w-4 h-4 text-zinc-500" />
      <div className="flex-1">
        <BlockNoteView editor={editor} theme="dark" className="todo-editor" />
      </div>
      <button onClick={handleSubmit} className="text-xs text-emerald-500">Add</button>
    </div>
  );
}
```

In `TodosPage`, the `handleAdd` callback:

```typescript
const handleAdd = async (markdown: string) => {
  const meetingId = 'manual'; // special sentinel for user-created todos
  const json = await editor.blocksToJson(); // from the add-row editor
  try {
    const newTodo = await invokeCreateTodo(meetingId, activeDate, JSON.stringify(json), markdown);
    setTodos(prev => [...prev, newTodo]);
  } catch (e) {
    toast.error('Failed to create todo');
  }
};
```

**Verify:** "+ Add a to-do" button appears, clicking shows editor, typing and clicking "Add" creates a new todo.

#### Step 5.8 — Loading and empty states

**Loading skeleton:**

```typescript
function LoadingSkeleton() {
  return (
    <div className="p-6 max-w-3xl mx-auto animate-pulse">
      <div className="h-8 w-48 bg-zinc-800 rounded mb-6" />
      {[1,2,3].map(i => (
        <div key={i} className="flex items-start gap-3 py-2">
          <div className="w-4 h-4 bg-zinc-800 rounded mt-0.5" />
          <div className="flex-1 h-6 bg-zinc-800 rounded" />
        </div>
      ))}
    </div>
  );
}
```

**Empty state:**

```typescript
function EmptyState({ date, onAdd }: { date: string; onAdd: () => void }) {
  return (
    <div className="text-center py-16 text-zinc-500">
      <p className="text-sm">No to-dos for {formatDateLabel(date)}</p>
      <p className="text-xs mt-1">Run AI cleanup on a meeting to extract action items, or add one manually.</p>
      <button onClick={onAdd} className="mt-4 text-sm text-emerald-500 hover:text-emerald-400">
        + Add a to-do
      </button>
    </div>
  );
}
```

**Verify:** Loading state shows skeleton. Empty day shows empty state with CTA.

---

### Phase 6: Frontend — Sidebar Integration

#### Step 6.1 — Add todo state to SidebarProvider

**File:** `frontend/src/components/Sidebar/SidebarProvider.tsx`

Add to the context interface:

```typescript
interface SidebarContextType {
  // ... existing fields ...

  // Todo state
  todoDates: TodoDateSummary[];
  todayUncheckedCount: number;
  fetchTodoDates: () => Promise<void>;
}
```

Implement:

```typescript
const [todoDates, setTodoDates] = useState<TodoDateSummary[]>([]);
const [todayUncheckedCount, setTodayUncheckedCount] = useState(0);

const fetchTodoDates = useCallback(async () => {
  try {
    const dates = await invoke<TodoDateSummary[]>('api_get_todo_dates');
    setTodoDates(dates);
    const today = new Date().toISOString().split('T')[0];
    const todayGroup = dates.find(d => d.date === today);
    setTodayUncheckedCount(todayGroup?.unchecked ?? 0);
  } catch (e) {
    console.error('Failed to fetch todo dates:', e);
  }
}, []);
```

Call `fetchTodoDates` in an effect on mount (alongside the existing meetings/folders fetch).

Expose in context value:

```typescript
const contextValue: SidebarContextType = {
  // ... existing ...
  todoDates,
  todayUncheckedCount,
  fetchTodoDates,
};
```

**Verify:** Sidebar provider exposes todo dates without errors.

#### Step 6.2 — Add "To Do's" section to sidebar

**File:** `frontend/src/components/Sidebar/index.tsx`

Add a new section between "Meeting Notes" and "By Date" (around line 1538). Structure:

```typescript
{/* === TO DO'S SECTION === */}
{isTodosExpanded && (
  <div className="px-3">
    {/* Section header */}
    <div className="flex items-center justify-between py-1 cursor-pointer"
      onClick={() => setTodosExpanded(!isTodosExpanded)}>
      <div className="flex items-center gap-2">
        <CheckSquare className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-medium">To Do's</span>
        {todayUncheckedCount > 0 && (
          <Badge>{todayUncheckedCount}</Badge>
        )}
      </div>
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${!isTodosExpanded ? '-rotate-90' : ''}`} />
    </div>

    {/* "Today" quick link */}
    <div className="ml-6 py-1">
      <button
        onClick={() => router.push('/todos')}
        className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-2"
      >
        <span className="text-xs">📋</span>
        <span>Today</span>
        {todayUncheckedCount > 0 && (
          <span className="text-xs text-zinc-500">({todayUncheckedCount})</span>
        )}
      </button>
    </div>

    {/* Date groups */}
    {todoDates.map(dateSummary => (
      <TodoDateGroup key={dateSummary.date} dateSummary={dateSummary} />
    ))}
  </div>
)}
```

TodoDateGroup component (inline or imported):

```typescript
function TodoDateGroup({ dateSummary }: { dateSummary: TodoDateSummary }) {
  const dateLabel = formatSidebarDate(dateSummary.date); // "7/3/2026"
  const storageKey = `sidebar-todos-date-${dateLabel}`;
  const [isExpanded, setIsExpanded] = useState(
    localStorage.getItem(storageKey) !== 'false' // default expanded
  );

  const toggleExpand = () => {
    const next = !isExpanded;
    setIsExpanded(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <div className="ml-6">
      <button
        onClick={toggleExpand}
        className="flex items-center gap-1.5 py-0.5 text-sm text-zinc-400 hover:text-zinc-200 w-full text-left"
      >
        <ChevronRight className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
        <span>{dateLabel}</span>
        <span className="text-xs text-zinc-600">({dateSummary.unchecked})</span>
      </button>
      {isExpanded && (
        <div className="ml-4 space-y-0.5">
          {/* Show first 3 unchecked todos as one-line previews */}
          {dateSummary.preview_items?.slice(0, 3).map(item => (
            <button
              key={item.id}
              onClick={() => router.push(`/todos?date=${dateSummary.date}`)}
              className="block text-xs text-zinc-500 hover:text-zinc-300 truncate w-full text-left"
            >
              {item.text}
            </button>
          ))}
          {(dateSummary.unchecked > 3) && (
            <button
              onClick={() => router.push(`/todos?date=${dateSummary.date}`)}
              className="text-xs text-emerald-500/70 hover:text-emerald-400"
            >
              + {dateSummary.unchecked - 3} more →
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

Note: `preview_items` needs to be added to `TodoDateSummary` or fetched separately. Two approaches:
1. Extend `TodoDateSummary` with a `preview_items: Vec<{id, text}>` field, populate in the SQL query
2. Fetch preview items lazily when a date group is expanded

Approach 1 is simpler. Modify the `get_dates` SQL to also return the first 3 items per date (could use a subquery or window function, or just fetch all todos and group in Rust).

**Verify:** "To Do's" section appears in sidebar, shows dates with counts, clicking a date navigates to `/todos`.

#### Step 6.3 — Collapse state persistence

**File:** `frontend/src/components/Sidebar/index.tsx`

Add `isTodosExpanded` state persisted to localStorage:

```typescript
const [isTodosExpanded, setIsTodosExpanded] = useState(() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('sidebar-todos-collapsed') !== 'false';
  }
  return true;
});

const toggleTodosExpanded = () => {
  const next = !isTodosExpanded;
  setIsTodosExpanded(next);
  localStorage.setItem('sidebar-todos-collapsed', String(next));
};
```

**Verify:** Collapsing/expanding persists across page reloads.

#### Step 6.4 — Refresh sidebar on summary completion

**File:** `frontend/src/components/Sidebar/SidebarProvider.tsx`

After the summary polling detects `completed` status, call `fetchTodoDates()`:

```typescript
// Inside the summary polling handler (around line 320-380)
if (status === 'completed') {
  // ... existing completion logic ...
  fetchTodoDates(); // NEW: refresh todos sidebar
}
```

Also expose `fetchTodoDates` via context so any component can trigger a refresh (e.g., after manual todo CRUD).

**Verify:** After AI cleanup finishes, sidebar "To Do's" section updates with new items.

---

### Phase 7: Homepage Integration

#### Step 7.1 — Add todo quick view to homepage

**File:** `frontend/src/app/page.tsx`

After the welcome section (around the "Start New Meeting" button), add:

```typescript
// In page.tsx, import todo API
import { getTodayTodos, toggleTodo } from '@/lib/todoApi';

export default function HomePage() {
  const [todayTodos, setTodayTodos] = useState<Todo[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);

  useEffect(() => {
    getTodayTodos().then(setTodayTodos).finally(() => setTodosLoading(false));
  }, []);

  const handleToggle = async (id: string, checked: boolean) => {
    setTodayTodos(prev => prev.map(t => t.id === id ? { ...t, is_checked: checked } : t));
    await toggleTodo(id, checked).catch(() => {
      setTodayTodos(prev => prev.map(t => t.id === id ? { ...t, is_checked: !checked } : t));
    });
  };

  return (
    // ... existing welcome content ...

    {/* Todo Quick View */}
    <div className="mt-8 w-full max-w-md mx-auto">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-medium text-zinc-300">Today's To-Dos</h2>
        <Link href="/todos" className="text-xs text-emerald-500 hover:text-emerald-400">
          View all →
        </Link>
      </div>

      {todosLoading ? (
        <div className="space-y-2 animate-pulse">
          {[1,2,3].map(i => <div key={i} className="h-4 bg-zinc-800 rounded w-3/4" />)}
        </div>
      ) : todayTodos.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No to-dos for today. Run AI cleanup on a meeting to get started.
        </p>
      ) : (
        <div className="space-y-1.5">
          {todayTodos.slice(0, 5).map(todo => (
            <div key={todo.id} className="flex items-center gap-2 text-sm group">
              <input
                type="checkbox"
                checked={todo.is_checked}
                onChange={() => handleToggle(todo.id, !todo.is_checked)}
                className="accent-emerald-500 cursor-pointer"
              />
              <span className={`truncate ${todo.is_checked ? 'line-through text-zinc-500' : 'text-zinc-300'}`}>
                {todo.content_markdown || todo.source_text}
              </span>
              {todo.meeting_id && (
                <Link
                  href={`/meeting-details?id=${todo.meeting_id}`}
                  className="text-xs text-zinc-600 hover:text-emerald-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                >
                  ↗
                </Link>
              )}
            </div>
          ))}
          {todayTodos.length > 5 && (
            <p className="text-xs text-zinc-500">+{todayTodos.length - 5} more</p>
          )}
        </div>
      )}
    </div>
  );
}
```

**Verify:** Homepage shows today's todos with inline checkbox toggles. Empty state shows instructional text.

---

### Phase 8: Polish & Edge Cases

#### Step 8.1 — Auto-refresh after mutation

After any todo CRUD operation (create, update, toggle, delete), call `refreshTodoDates()` from the sidebar context to keep the sidebar counts in sync.

The cleanest approach: expose a `notifyTodoChanged` method on the SidebarProvider that re-fetches `todoDates`. Call it from `TodosPage` after mutations:

```typescript
const { refreshTodoDates } = useSidebar();

// After create/update/toggle/delete:
await someMutation();
refreshTodoDates();
```

**Verify:** Sidebar counts update live after todo changes.

#### Step 8.2 — Error toasts

Use the existing toast system to show user-friendly messages:

| Scenario | Toast |
|----------|-------|
| Failed to load todos | "Failed to load to-dos" |
| Failed to toggle | "Failed to update to-do" |
| Failed to create | "Failed to create to-do" |
| Failed to delete | "Failed to delete to-do" |
| Extraction in progress | (subtle, not a toast — shown in summary result) |

**Verify:** Error cases show appropriate toasts.

#### Step 8.3 — Keyboard navigation

| Key | Action |
|-----|--------|
| `Tab` | Navigate between todo rows |
| `Space` | Toggle checkbox on focused todo |
| `Enter` | Focus the BlockNote editor on the current row |
| `Escape` | Blur editor, collapse to compact view |

**Verify:** Keyboard navigation works without mouse.

#### Step 8.4 — Handling edge cases

| Case | Behavior |
|------|----------|
| Meeting deleted | `ON DELETE CASCADE` removes its todos. Sidebar refreshes on next poll. |
| Date with no todos | `/todos?date=...` shows empty state. Sidebar does not show date. |
| Very long todo text | Truncated to 3 lines in editor, full text on focus |
| 100+ todos in a day | Paginate or virtualize the list (defer if unlikely) |
| Concurrent extraction + manual add | No conflict — new todos append at sort_order = max+1 |
| Midnight rollover | Date is determined at extraction time from meeting's `created_at` |
| Offline mode | Todos API fails gracefully with toast. No offline caching needed for v1. |

**Verify:** Each edge case behaves correctly.

---

### Summary: All Implementation Steps

| # | Step | File/Area | Est. Effort |
|---|------|-----------|-------------|
| 1.1 | Create SQL migration | `migrations/20260703000000_add_todos.sql` | 15 min |
| 1.2 | Add TodoModel to models.rs | `database/models.rs` | 15 min |
| 1.3 | Create TodosRepository | `database/repositories/todos.rs` | 1 hr |
| 1.4 | Register repository module | `database/repositories/mod.rs` | 5 min |
| 2.1 | Create todos_api.rs | `api/todos_api.rs` | 1.5 hr |
| 2.2 | Register API module | `api/mod.rs` | 5 min |
| 2.3 | Register commands in lib.rs | `lib.rs` | 10 min |
| 2.4 | Smoke-test build | `cargo check && cargo build` | 10 min |
| 3.1 | Create todo_extractor.rs | `summary/todo_extractor.rs` | 2 hr |
| 3.2 | Register extractor module | `summary/mod.rs` | 5 min |
| 3.3 | Hook into service.rs | `summary/service.rs` | 30 min |
| 4.1 | Add frontend types | `types/index.ts` | 10 min |
| 4.2 | Add invoke helpers | `lib/todoApi.ts` | 20 min |
| 5.1 | Create `/todos` route | `app/todos/page.tsx` | 10 min |
| 5.2 | Create TodosPage shell | `components/Todos/TodosPage.tsx` | 1 hr |
| 5.3 | Date header with navigation | `TodosPage.tsx` | 30 min |
| 5.4 | Todo list with checkboxes | `TodosPage.tsx` | 1 hr |
| 5.5 | Wire up toggle/delete | `TodosPage.tsx` | 30 min |
| 5.6 | BlockNote rich text | `TodosPage.tsx` | 2 hr |
| 5.7 | Manual todo creation | `TodosPage.tsx` | 1 hr |
| 5.8 | Loading & empty states | `TodosPage.tsx` | 30 min |
| 6.1 | Todo state in SidebarProvider | `SidebarProvider.tsx` | 30 min |
| 6.2 | "To Do's" sidebar section | `Sidebar/index.tsx` | 2 hr |
| 6.3 | Collapse persistence | `Sidebar/index.tsx` | 15 min |
| 6.4 | Refresh on summary complete | `SidebarProvider.tsx` | 15 min |
| 7.1 | Homepage todo quick view | `page.tsx` | 1 hr |
| 8.1 | Auto-refresh after mutation | `TodosPage.tsx` + `SidebarProvider.tsx` | 20 min |
| 8.2 | Error toasts | Various | 20 min |
| 8.3 | Keyboard navigation | `TodosPage.tsx` | 30 min |
| 8.4 | Edge case handling | Various | 30 min |


---

## Key Design Decisions

### 1. Separate LLM Call (not integrated into summary prompt)

The current summary prompt explicitly forbids action items (`"Hard rules: Do not include Action Items"`). Rather than modifying this established prompt (which could degrade summary quality), we run a **separate, focused extraction pass**. This keeps both outputs clean and independently debuggable.

### 2. Extraction failure is non-fatal

If the LLM returns invalid JSON or fails entirely, the summary still completes. Todo extraction is additive value, not critical path. The user can always manually add todos.

### 3. Todos are keyed to dates, not meetings

The `date` field on the `todos` table matches the meeting's `created_at` date. This allows a single meeting's todos to appear on their appropriate daily view. A meeting that spans midnight would still have all its todos on its creation date.

### 4. Rich text per-todo via BlockNote

Using the same BlockNote editor that powers meeting notes ensures consistent UX. Each todo gets its own lightweight editor instance (constrained to ~1-3 lines, expandable on focus).

### 5. Source links reference the meeting detail page

The hyperlink on each todo navigates to `/meeting-details?id=<meeting_id>`. From there, the user can see the full transcript, notes, and summary — everything they need for context.

---

## Appendix: File Manifest

### New Files

| File | Purpose |
|------|---------|
| `frontend/src-tauri/migrations/20260703000000_add_todos.sql` | Migration |
| `frontend/src-tauri/src/database/repositories/todos.rs` | Todo CRUD |
| `frontend/src-tauri/src/api/todos_api.rs` | Tauri commands |
| `frontend/src-tauri/src/summary/todo_extractor.rs` | LLM extraction |
| `frontend/src/components/Todos/TodosPage.tsx` | Todo page component |
| `frontend/src/app/todos/page.tsx` | Next.js route |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src-tauri/src/database/models.rs` | Add `TodoModel` |
| `frontend/src-tauri/src/database/repositories/mod.rs` | Add `pub mod todos;` |
| `frontend/src-tauri/src/api/mod.rs` | Add `pub mod todos_api;` |
| `frontend/src-tauri/src/summary/mod.rs` | Add `pub mod todo_extractor;` |
| `frontend/src-tauri/src/summary/service.rs` | Hook todo extraction after summary |
| `frontend/src-tauri/src/lib.rs` | Register todo commands |
| `frontend/src/components/Sidebar/index.tsx` | Add "To Do's" section |
| `frontend/src/components/Sidebar/SidebarProvider.tsx` | Add todo state |
| `frontend/src/app/page.tsx` | Add todo quick view |
| `frontend/src/types/index.ts` | Add `Todo` / `TodoDateGroup` types |
