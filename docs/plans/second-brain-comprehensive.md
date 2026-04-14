# Second Brain — Comprehensive Implementation Plan

**Overall Progress:** `0%`

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to implement this plan. Steps use checkbox syntax for progress tracking.

---

## TLDR

Transform Adamant from a meeting recorder into a Karpathy-style personal knowledge system.
After each meeting, an LLM compiles it into a structured wiki article (decisions, people, action
items, topics). A Memory chat page lets users ask questions and get cited, grounded answers drawn
from those articles — not raw transcript fragments. Over time, cross-cutting entities (people,
projects, decisions) surface knowledge that spans multiple meetings. Users can browse, edit, and
control what gets remembered.

Built entirely in Rust/SQLite. No new infrastructure, no backend server. Three phases:
1. Wiki compilation + cited chat (replaces naive raw-dump chat)
2. Entity extraction + cross-meeting knowledge
3. Wiki browser UI + user privacy controls

---

## Critical Decisions

- **Rust-native, not Python backend.** The existing `chat/handler.rs` already proves the in-process
  path works. Staying Rust avoids any backend server dependency and keeps the app self-contained.
  The Phase 1 plan in `2026-04-06-second-brain-phase1-rag-chat.md` was written before the Rust chat
  handler existed — that plan is superseded by this one.

- **SQLite for wiki storage, not filesystem markdown.** Wiki articles live in a `wiki_articles`
  table alongside all other app data. Consistent with existing patterns, portable, and queryable
  without filesystem assumptions.

- **FTS5 for routing, not vector embeddings.** The app already has `meeting_search_fts` with BM25
  scoring. Use it to identify the 3–5 most relevant meetings before reading their wiki articles.
  Achieves the Karpathy routing goal with zero new dependencies. Vector embeddings can be added
  later if scale demands it.

- **Structured citations returned as JSON.** The chat response becomes
  `{ answer: string, cited_meeting_ids: string[] }`. The frontend renders cited meetings as
  clickable cards below each assistant reply.

- **LLM compiles wiki — users can override.** Articles are LLM-generated. Users can edit or
  delete them. A `user_content` field stores overrides; if set, it replaces the LLM content in
  chat context. A `is_private` flag excludes articles from chat entirely.

- **Phase-gated delivery.** Each phase is independently shippable. Phase 1 is the highest-value
  change (better answers + citations). Phases 2 and 3 build on it without breaking it.

---

## End Result

When all three phases are complete, the user experiences:

- A **Brain icon** in the sidebar that opens a **Memory** page
- A chat input where they ask questions like "What did we decide about the API last week?" and
  receive a grounded, well-structured answer in 2–5 seconds — entirely on-device
- **Cited meeting cards** beneath each answer, each clickable, opening that meeting's detail page
- Every saved meeting **auto-compiles** into a structured wiki article in the background — no user
  action needed
- A **wiki browser** where they can read, edit, or mark articles private
- **Entity pages** for recurring people, projects, and decisions — showing which meetings each
  entity appeared in
- A **"Delete all memory"** option so users retain full control over what the system retains
- Everything runs locally. Zero data leaves the device.

---

## Phase 1: Wiki Compilation + Cited Chat

**Goal:** Replace the current naive "dump all raw transcripts into context" chat with
LLM-compiled wiki articles and structured citations. This alone dramatically improves answer
quality and adds meeting traceability.

### Current state (what this replaces)

`chat/handler.rs` currently fetches all meeting transcripts + notes, concatenates them into a
60k-character flat string, and sends that string as the system prompt. There is no structure,
no routing, and no citations. The LLM reads fragmented transcript text instead of organized
summaries.

---

- [ ] 🟥 **Step 1: Add `wiki_articles` migration**

  **File:** `frontend/src-tauri/migrations/{timestamp}_add_wiki_articles.sql`

  ```sql
  CREATE TABLE IF NOT EXISTS wiki_articles (
      id            TEXT PRIMARY KEY,
      meeting_id    TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      content       TEXT NOT NULL,           -- LLM-compiled markdown article
      user_content  TEXT,                    -- User override; if set, used instead of content
      is_private    INTEGER NOT NULL DEFAULT 0,
      is_stale      INTEGER NOT NULL DEFAULT 0,
      compiled_at   DATETIME NOT NULL DEFAULT (datetime('now')),
      updated_at    DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_articles_meeting
      ON wiki_articles(meeting_id);
  ```

  - [ ] 🟥 Create the migration file with a timestamp greater than the latest existing migration
  - [ ] 🟥 Verify `sqlx::migrate!()` picks it up on next app start (`cargo check`)

---

- [ ] 🟥 **Step 2: Add `WikiRepository` to the database layer**

  **File:** `frontend/src-tauri/src/database/repositories/wiki.rs`

  Methods to implement (all `async`, take `&Pool<Sqlite>`):

  | Method | Purpose |
  |--------|---------|
  | `upsert_article(pool, meeting_id, content)` | Insert or replace LLM content |
  | `get_article(pool, meeting_id)` | Fetch article for one meeting |
  | `get_all_articles(pool)` | Fetch all non-private articles |
  | `save_user_edit(pool, meeting_id, user_content)` | Store user override |
  | `mark_stale(pool, meeting_id)` | Set `is_stale = 1` |
  | `mark_private(pool, meeting_id, private: bool)` | Toggle privacy |
  | `delete_article(pool, meeting_id)` | Hard delete |

  - [ ] 🟥 Create `wiki.rs` with all methods
  - [ ] 🟥 Export from `repositories/mod.rs`: `pub mod wiki;`

---

- [ ] 🟥 **Step 3: Build the wiki compiler**

  **File:** `frontend/src-tauri/src/chat/wiki_compiler.rs`

  Core function signature:
  ```rust
  pub async fn compile_meeting_to_wiki(
      pool: &Pool<Sqlite>,
      app_data_dir: Option<PathBuf>,
      meeting_id: &str,
  ) -> Result<String, String>
  ```

  Compilation steps inside:
  1. Fetch meeting title + transcripts + notes from DB
  2. Build a tightly-scoped system prompt (see below)
  3. Call `generate_summary` (already used by summary engine)
  4. Store result via `WikiRepository::upsert_article`
  5. Return the compiled markdown

  **System prompt for wiki compilation:**
  ```
  You are a meeting editor. From the raw meeting transcript and notes below,
  produce a structured markdown wiki article with these exact sections:

  ## Summary
  One paragraph. What was this meeting about?

  ## Key Decisions
  Bullet list. Only decisions explicitly made — never inferred.

  ## Action Items
  Bullet list. Each item: who is responsible and what they committed to.
  If none, write: - None recorded.

  ## People Mentioned
  Bullet list of names and their role or affiliation if stated.

  ## Topics Discussed
  Bullet list of main topics, with a one-line description each.

  ## Important Details
  Any specific numbers, dates, links, or technical terms worth preserving.

  Rules: Use only information from the source. Never invent. Bullet points only — no tables.
  ```

  - [ ] 🟥 Create `wiki_compiler.rs` with `compile_meeting_to_wiki`
  - [ ] 🟥 Export from `chat/mod.rs`
  - [ ] 🟥 Handle missing transcript gracefully (notes-only meetings should still compile)

---

- [ ] 🟥 **Step 4: Auto-trigger wiki compilation after meeting content saves**

  **Files to modify:**
  - Identify the Tauri command that is called when a meeting's transcript or notes finish saving
    (likely in `recording_commands.rs` end-of-recording path, or the notes autosave path in the
    summary module)
  - After the save completes, spawn a background tokio task:

  ```rust
  let pool_clone = pool.clone();
  let dir_clone = app_data_dir.clone();
  let id_clone = meeting_id.to_string();
  tokio::spawn(async move {
      if let Err(e) = compile_meeting_to_wiki(&pool_clone, dir_clone, &id_clone).await {
          log::warn!("Wiki compilation failed for {}: {}", id_clone, e);
      }
  });
  ```

  - [ ] 🟥 Locate the correct save hook point
  - [ ] 🟥 Add background spawn (non-blocking — never blocks the UI)
  - [ ] 🟥 Emit `"wiki-article-ready"` Tauri event to frontend on success, with `{ meeting_id }`

---

- [ ] 🟥 **Step 5: Upgrade chat handler to wiki-first context**

  **File:** `frontend/src-tauri/src/chat/handler.rs`

  Replace the current raw-transcript approach with:

  1. **FTS routing** — run BM25 query against `meeting_search_fts` to find top-5 relevant meetings:
     ```sql
     SELECT meeting_id, bm25(meeting_search_fts) AS score
     FROM meeting_search_fts
     WHERE meeting_search_fts MATCH ?
     ORDER BY score
     LIMIT 5
     ```
     If the FTS query is empty or fails, fall back to most-recent 5 meetings.

  2. **Wiki read** — for each routed meeting, fetch its wiki article via `WikiRepository::get_article`.
     If no article exists yet (not yet compiled), fall back to raw transcript snippet for that meeting.

  3. **Build context** — combine wiki articles within `MAX_CONTEXT_CHARS` budget.
     Wiki articles are ~5–10x more information-dense than raw transcripts, so the budget goes further.

  4. **Retain existing multi-provider LLM call** — no changes to the `generate_summary` call itself.

  - [ ] 🟥 Add FTS routing query
  - [ ] 🟥 Read wiki articles for routed meetings
  - [ ] 🟥 Fall back gracefully when articles are missing
  - [ ] 🟥 Remove old flat-concatenation approach

---

- [ ] 🟥 **Step 6: Add structured citations to chat responses**

  **File:** `frontend/src-tauri/src/chat/handler.rs`

  Add `ChatResponse` struct:
  ```rust
  #[derive(Debug, Serialize, Deserialize)]
  pub struct ChatResponse {
      pub answer: String,
      pub cited_meeting_ids: Vec<String>,
  }
  ```

  In the system prompt, instruct the LLM:
  ```
  At the very end of your response, on a new line, write exactly:
  SOURCES: meeting_id_1, meeting_id_2
  Only list meeting IDs you actually drew from. Omit if not applicable.
  ```

  After receiving the LLM response:
  1. Parse out the `SOURCES:` line
  2. Validate that each ID exists in the meetings we injected
  3. Strip the `SOURCES:` line from `answer`
  4. Return `ChatResponse { answer, cited_meeting_ids }`

  Update the Tauri command in `lib.rs` to return `ChatResponse` instead of `String`.

  - [ ] 🟥 Define `ChatResponse` struct
  - [ ] 🟥 Add SOURCES instruction to system prompt
  - [ ] 🟥 Parse and validate cited IDs
  - [ ] 🟥 Update Tauri command return type

---

- [ ] 🟥 **Step 7: Memory page — frontend**

  **Files to create:**
  - `frontend/src/app/memory/page.tsx` — page layout and route
  - `frontend/src/components/MemoryChat/index.tsx` — chat message list + text input
  - `frontend/src/components/MemoryChat/CitationCard.tsx` — per-meeting citation card

  **`MemoryChat` component behavior:**
  - Text input at bottom, send on Enter or button click
  - Messages list above, scrolls to bottom on new message
  - Assistant turns show answer text + `CitationCard` list below
  - Loading state while waiting for LLM response
  - Invokes `api_chat_with_meetings` via Tauri `invoke`

  **`CitationCard` component:**
  - Shows meeting title + date
  - Clicking navigates to `/meeting-details?id={meeting_id}`
  - Visually distinct from chat bubbles (e.g. a small chip or card below the answer)

  - [ ] 🟥 Create `memory/page.tsx`
  - [ ] 🟥 Create `MemoryChat/index.tsx`
  - [ ] 🟥 Create `MemoryChat/CitationCard.tsx`
  - [ ] 🟥 Wire Tauri invoke + handle loading/error states
  - [ ] 🟥 Render citation cards from `cited_meeting_ids`

---

- [ ] 🟥 **Step 8: Add Brain icon + Memory nav to sidebar**

  **File:** `frontend/src/components/Sidebar/index.tsx`

  - Add `Brain` icon from `lucide-react` to the sidebar nav (below the Home/Meetings button)
  - Navigates to `/memory` on click
  - Active state highlight when on any `/memory/*` route

  **On Memory page, add a "Re-compile all" button:**
  - Calls a new Tauri command `recompile_all_wiki_articles`
  - Triggers `compile_meeting_to_wiki` for every meeting sequentially in background
  - Shows progress via `wiki-article-ready` events

  - [ ] 🟥 Add Brain nav item to sidebar
  - [ ] 🟥 Add `recompile_all_wiki_articles` Tauri command
  - [ ] 🟥 Register command in `lib.rs`
  - [ ] 🟥 Add Re-compile button + progress indicator on Memory page

---

## Phase 2: Entity Extraction + Cross-Meeting Knowledge

**Goal:** Extract named entities (people, projects, decisions, concepts) from wiki articles and
build entity pages — knowledge that spans multiple meetings and surfaces connections the user
didn't explicitly organize.

---

- [ ] 🟥 **Step 9: Add `wiki_entities` and `wiki_entity_mentions` tables**

  ```sql
  CREATE TABLE IF NOT EXISTS wiki_entities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('person','project','concept','decision')),
      description TEXT,
      created_at  DATETIME NOT NULL DEFAULT (datetime('now')),
      updated_at  DATETIME NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_entities_name_type
      ON wiki_entities(name, type);

  CREATE TABLE IF NOT EXISTS wiki_entity_mentions (
      id              TEXT PRIMARY KEY,
      entity_id       TEXT NOT NULL REFERENCES wiki_entities(id) ON DELETE CASCADE,
      meeting_id      TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      context_snippet TEXT,
      mentioned_at    DATETIME NOT NULL DEFAULT (datetime('now'))
  );
  ```

  - [ ] 🟥 Create migration file
  - [ ] 🟥 Add `EntityRepository` with: `upsert_entity`, `add_mention`, `get_entity_meetings`,
        `get_meeting_entities`, `list_all_entities`

---

- [ ] 🟥 **Step 10: Build entity extractor**

  **File:** `frontend/src-tauri/src/chat/entity_extractor.rs`

  ```rust
  pub async fn extract_entities(
      pool: &Pool<Sqlite>,
      app_data_dir: Option<PathBuf>,
      meeting_id: &str,
  ) -> Result<Vec<ExtractedEntity>, String>
  ```

  LLM system prompt instructs the model to return **only** a JSON array:
  ```json
  [
    { "name": "Alice Chen", "type": "person", "context": "Product lead, discussed roadmap" },
    { "name": "Q3 Launch", "type": "project", "context": "Target: July 15" }
  ]
  ```

  After receiving the response:
  1. Parse JSON
  2. Upsert each entity (merge by `name + type`)
  3. Insert `wiki_entity_mentions` rows

  Run this **after** wiki compilation in the same background pipeline (Step 4).

  - [ ] 🟥 Create `entity_extractor.rs`
  - [ ] 🟥 Parse LLM JSON response safely (handle malformed output)
  - [ ] 🟥 Upsert entities and mentions
  - [ ] 🟥 Chain after wiki compilation in the background task

---

- [ ] 🟥 **Step 11: Entity-aware chat context**

  **File:** `frontend/src-tauri/src/chat/handler.rs`

  Before the FTS routing step, scan the user's query for known entity names
  (simple substring match against `EntityRepository::list_all_entities`).

  For matched entities, fetch their associated meeting IDs and **union** them with the
  FTS routing results — ensuring meetings where that person/project appears are always
  included in context.

  Add `mentioned_entities` to `ChatResponse`:
  ```rust
  pub struct ChatResponse {
      pub answer: String,
      pub cited_meeting_ids: Vec<String>,
      pub mentioned_entities: Vec<EntitySummary>, // name, type, meeting_count
  }
  ```

  - [ ] 🟥 Entity name scan on incoming query
  - [ ] 🟥 Union entity meeting IDs with FTS results
  - [ ] 🟥 Add `mentioned_entities` to response struct

---

- [ ] 🟥 **Step 12: Entity pages — frontend**

  **Files:**
  - `frontend/src/app/memory/entities/page.tsx` — list all entities grouped by type
  - `frontend/src/app/memory/entities/[id]/page.tsx` — single entity detail

  **Entity detail page shows:**
  - Entity name, type badge, description
  - List of all meetings where this entity appears, with the context snippet
  - Each meeting is a clickable link to the meeting detail page

  **On Memory page:** add an "Entities" section or tab alongside Chat.

  - [ ] 🟥 Create entity list page
  - [ ] 🟥 Create entity detail page
  - [ ] 🟥 Add Tauri commands: `get_all_entities`, `get_entity_detail`
  - [ ] 🟥 Wire entity mentions in Memory page UI

---

## Phase 3: Wiki Browser + User Privacy Controls

**Goal:** Give users full visibility and control over what the system remembers. Users can read,
edit, and delete wiki articles, mark them private, and clear all memory data.

---

- [ ] 🟥 **Step 13: Wiki browser page**

  **Files:**
  - `frontend/src/app/memory/wiki/page.tsx` — list of all compiled articles
  - `frontend/src/app/memory/wiki/[meeting_id]/page.tsx` — single article view + edit

  **Article list page:**
  - Table/card list: meeting title, compilation date, stale indicator, private badge
  - "Re-compile" button per row
  - "Mark private" / "Make public" toggle per row
  - Sort by date, filter by private/stale

  **Article detail page:**
  - Render compiled markdown (or user override if set)
  - "Edit" button opens a textarea pre-filled with current content
  - Save stores to `user_content` column
  - "Reset to AI version" button clears `user_content`
  - "Mark private" toggle

  - [ ] 🟥 Create wiki list page
  - [ ] 🟥 Create wiki article detail + edit page
  - [ ] 🟥 Add Tauri commands: `get_wiki_articles`, `get_wiki_article`, `save_wiki_edit`,
        `toggle_wiki_private`, `recompile_wiki_article`
  - [ ] 🟥 Register all commands in `lib.rs`

---

- [ ] 🟥 **Step 14: Add wiki browser nav to Memory page**

  - [ ] 🟥 Add "Wiki" tab or sub-nav on Memory page alongside "Chat" and "Entities"
  - [ ] 🟥 Brain icon in sidebar now covers all three sub-sections

---

- [ ] 🟥 **Step 15: Privacy controls + data management**

  **Chat handler changes:**
  - Skip articles where `is_private = 1` when building LLM context
  - Skip private meetings in entity extraction pipeline

  **Settings page — new "Memory" section:**
  - Toggle: "Auto-compile wiki articles" (default on)
    - When off, skip the background compilation task entirely
  - Button: "Re-compile all articles"
  - Button: "Delete all memory data" — `DELETE FROM wiki_articles; DELETE FROM wiki_entities;`
    with a confirmation dialog

  - [ ] 🟥 Enforce `is_private` filter in `chat/handler.rs`
  - [ ] 🟥 Enforce `is_private` filter in `entity_extractor.rs`
  - [ ] 🟥 Add "Memory" section to `settings/page.tsx`
  - [ ] 🟥 Add `delete_all_memory` Tauri command with confirmation from frontend
  - [ ] 🟥 Store auto-compile preference in settings table

---

## Status Tracking

* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.

---

## Implementation Order Recommendation

Ship Phase 1 first — it delivers the biggest user-visible improvement (cited answers, better
quality) and builds the wiki foundation that Phases 2 and 3 depend on.

1. Steps 1–4: data layer + compiler (pure Rust, no UI)
2. Steps 5–6: upgrade chat handler (visible improvement to existing chat)
3. Steps 7–8: Memory page + sidebar nav (new UI surface)
4. Step 9–12: entity extraction (Phase 2, adds depth)
5. Steps 13–15: wiki browser + privacy controls (Phase 3, adds user control)
