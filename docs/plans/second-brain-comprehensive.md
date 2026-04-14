# Second Brain — Comprehensive Implementation Plan

**Overall Progress:** `0%`

> **For agentic workers:** Use `superpowers:subagent-driven-development` or `superpowers:executing-plans`
> to implement this plan. Steps use checkbox syntax for progress tracking.

---

## TLDR

Transform Adamant from a meeting recorder into a Karpathy-style personal knowledge system.
After each meeting, an LLM compiles it into a structured markdown wiki article stored on disk.
A global `_index.md` maps every article in one place. When the user asks a question, the LLM
reads the index to orient itself, identifies relevant meetings, reads those full articles, and
answers with citations — following structured links, not doing similarity search.

This is explicitly **not RAG**. The methodology (Karpathy / Spisak / VibeMarketer) is: flat
markdown files + a maintained index + inter-article `[[links]]` → LLM navigates the index and
follows relationships. No embeddings, no vector DB, no BM25 scoring. That approach is for
enterprise scale. At personal meeting-recorder scale, a well-maintained wiki index outperforms
chunked similarity search and produces more coherent, better-cited answers.

Built Rust-native. Three phases:
1. Wiki compilation + index navigation + cited chat
2. Concept pages + inter-article linking (people, projects, decisions)
3. Wiki browser UI + outputs loop + privacy controls

---

## Critical Decisions

- **Rust-native, not Python backend.** The existing `chat/handler.rs` proves in-process works.
  No server dependency. The original `2026-04-06-second-brain-phase1-rag-chat.md` plan targeted
  the Python backend and is superseded by this plan.

- **Filesystem markdown, not SQLite blobs.** Wiki articles live as `.md` files in
  `~/.adamant/wiki/`. This is the exact structure Karpathy describes and both writeups endorse:
  "just a nested directory of .md files." SQLite tracks metadata only (compiled_at, is_stale,
  is_private, file_path) — the content itself lives on disk where the LLM can navigate it.

- **Index navigation, not search.** The routing mechanism is: give the LLM `_index.md` (one
  line per meeting), ask it to identify the 3–5 most relevant meetings, then read those full
  wiki files. This is structured relationship traversal, not pattern matching on keywords.
  VibeMarketer: "RAG finds chunks that seem similar to your query. The wiki approach follows
  actual structured links." No FTS5 routing, no BM25 scoring, no vector embeddings — those
  are the wrong tool at this scale.

- **`[[concept]]` internal links build the relationship web.** Wiki articles link to each other
  using `[[concept-name]]` notation. This is what makes the system compound: article 20 links
  back to concepts established by articles 1–19, creating a dense web the LLM can trace.

- **`_index.md` and `_log.md` are always maintained.** Every compilation updates both files.
  `_index.md` is a brief directory of every meeting + concept article. `_log.md` records when
  each article was compiled or updated. These are the LLM's navigation layer.

- **Outputs loop completes the system.** Chat answers get saved to `wiki/outputs/` and
  optionally merged back into relevant wiki articles. Spisak: "Every question makes the next
  answer better. That's the loop."

- **No vector embeddings.** This is a deliberate architecture choice, not an omission.
  VibeMarketer: "for personal research, a second brain, a small team's knowledge hub — the wiki
  approach handles it." Karpathy himself: "at ~100 articles and 500k words, well-maintained
  markdown indexes just work." Add embeddings only if the meeting count exceeds ~500.

- **Phase-gated delivery.** Each phase ships independently and builds on the last.

---

## End Result

When all three phases are complete:

- A **Brain icon** in the sidebar opens the **Memory** page
- The user types a question (e.g. "What did we decide about the API redesign?") and gets a
  grounded, well-organized answer in 2–5 seconds — completely on-device
- **Cited meeting cards** appear below each answer — each clickable, linking to that meeting's
  detail page
- Every meeting **auto-compiles** into a structured wiki article after it saves — no user action
- A global `_index.md` maps all articles; `_log.md` tracks every update
- Articles **link to each other** via `[[concept]]` notation — the web compounds over time
- **Concept pages** surface recurring people, projects, and decisions across meetings
- **Saved outputs** feed back into the wiki — each answer makes the next one sharper
- Users can read, edit, or mark any article private in the wiki browser
- A **"Delete all memory"** button gives full control
- Zero data leaves the device

---

## Wiki Folder Structure

```
~/.adamant/wiki/
├── _index.md          ← auto-maintained: one-line summary per article
├── _log.md            ← auto-maintained: update history
├── meetings/          ← one file per meeting
│   ├── {meeting_id}.md
│   └── ...
├── concepts/          ← Phase 2: people, projects, decisions, recurring topics
│   ├── alice-chen.md
│   ├── q3-launch.md
│   └── ...
└── outputs/           ← Phase 3: saved chat answers
    └── {date}-{slug}.md
```

---

## Phase 1: Wiki Compilation + Index Navigation + Cited Chat

**Goal:** Replace the current naive raw-transcript dump with filesystem wiki articles,
index-based routing, and structured citations. The LLM navigates the index like a table of
contents — it does not search.

### What this replaces

`chat/handler.rs` currently concatenates all meeting transcripts + notes into a 60k-character
flat string and sends it as the system prompt. There is no structure, no routing, no citations,
and no way for the LLM to trace which meeting an answer came from.

---

- [ ] 🟥 **Step 1: Add `wiki_metadata` table migration**

  SQLite tracks metadata only. Article content lives on disk.

  **File:** `frontend/src-tauri/migrations/{timestamp}_add_wiki_metadata.sql`

  ```sql
  CREATE TABLE IF NOT EXISTS wiki_metadata (
      meeting_id   TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
      file_path    TEXT NOT NULL,          -- absolute path to the .md file on disk
      is_private   INTEGER NOT NULL DEFAULT 0,
      is_stale     INTEGER NOT NULL DEFAULT 0,
      compiled_at  DATETIME NOT NULL DEFAULT (datetime('now')),
      updated_at   DATETIME NOT NULL DEFAULT (datetime('now'))
  );
  ```

  - [ ] 🟥 Create the migration file (timestamp > latest existing migration)
  - [ ] 🟥 Verify `sqlx::migrate!()` picks it up (`cargo check`)

---

- [ ] 🟥 **Step 2: Add `WikiMetadataRepository` to the database layer**

  **File:** `frontend/src-tauri/src/database/repositories/wiki.rs`

  | Method | Purpose |
  |--------|---------|
  | `upsert(pool, meeting_id, file_path)` | Record that an article exists at this path |
  | `get(pool, meeting_id)` | Fetch metadata row for one meeting |
  | `list_all(pool)` | All non-private metadata rows |
  | `mark_stale(pool, meeting_id)` | Set `is_stale = 1` |
  | `mark_private(pool, meeting_id, private: bool)` | Toggle privacy |
  | `delete(pool, meeting_id)` | Remove metadata row (caller deletes file) |

  - [ ] 🟥 Create `wiki.rs` with all methods
  - [ ] 🟥 Export from `repositories/mod.rs`

---

- [ ] 🟥 **Step 3: Set up wiki folder structure on first run**

  **File:** `frontend/src-tauri/src/chat/wiki_fs.rs`

  On app start (or lazily on first compilation), ensure these exist:
  ```
  ~/.adamant/wiki/
  ~/.adamant/wiki/meetings/
  ~/.adamant/wiki/concepts/
  ~/.adamant/wiki/outputs/
  ```

  Also create stub `_index.md` and `_log.md` if missing:
  - `_index.md`: `# Adamant Wiki Index\n\n*No articles yet.*`
  - `_log.md`: `# Wiki Update Log\n\n`

  Functions:
  - `wiki_dir(app_data_dir) -> PathBuf` — returns `~/.adamant/wiki/`
  - `ensure_wiki_dirs(app_data_dir) -> Result<()>` — creates dirs + stub files
  - `index_path(app_data_dir) -> PathBuf`
  - `log_path(app_data_dir) -> PathBuf`
  - `meeting_article_path(app_data_dir, meeting_id) -> PathBuf`
  - `concept_article_path(app_data_dir, slug) -> PathBuf`
  - `output_path(app_data_dir, slug) -> PathBuf`

  - [ ] 🟥 Create `wiki_fs.rs` with all path helpers and `ensure_wiki_dirs`
  - [ ] 🟥 Call `ensure_wiki_dirs` during app startup (in `lib.rs` setup)
  - [ ] 🟥 Export from `chat/mod.rs`

---

- [ ] 🟥 **Step 4: Build the wiki compiler**

  **File:** `frontend/src-tauri/src/chat/wiki_compiler.rs`

  ```rust
  pub async fn compile_meeting_to_wiki(
      pool: &Pool<Sqlite>,
      app_data_dir: PathBuf,
      meeting_id: &str,
  ) -> Result<(), String>
  ```

  Steps inside:
  1. Fetch meeting title + date + transcripts + notes from DB
  2. Call LLM with compilation prompt (see below)
  3. Write result to `wiki/meetings/{meeting_id}.md`
  4. Update `WikiMetadataRepository` with file path
  5. Regenerate `_index.md` (call `update_index`)
  6. Append to `_log.md` (call `append_log`)

  **Wiki article format:**
  ```markdown
  # {Meeting Title}
  **Date:** {date}

  ## Summary
  One paragraph. What was this meeting about?

  ## Key Decisions
  - Only decisions explicitly made. Never inferred.
  - If none: *None recorded.*

  ## Action Items
  - Who committed to what. Include names.
  - If none: *None recorded.*

  ## People
  - [[Alice Chen]] — product lead
  - [[Bob Kim]] — engineering

  ## Topics
  - [[API Redesign]] — discussed new endpoint structure
  - [[Q3 Launch]] — timeline reviewed

  ## Important Details
  Specific numbers, dates, links, or technical terms worth preserving.
  ```

  Note the `[[Name]]` links — these create the relationship web that compounds over time.
  Even if concept pages don't exist yet (Phase 2), the links are written now.

  **`update_index` function:**
  - Read all `wiki_metadata` rows from SQLite
  - For each, read the first line (title) of its `.md` file
  - Rewrite `_index.md` as a sorted list: `- [[{title}]](meetings/{id}.md) — {summary line}`
  - Keep index concise: one line per article

  **`append_log` function:**
  - Append: `- {ISO datetime} | compiled | {meeting_title} ({meeting_id})`

  - [ ] 🟥 Create `wiki_compiler.rs` with `compile_meeting_to_wiki`, `update_index`, `append_log`
  - [ ] 🟥 Handle notes-only meetings (no transcript) gracefully
  - [ ] 🟥 Export from `chat/mod.rs`

---

- [ ] 🟥 **Step 5: Auto-trigger wiki compilation after meeting saves**

  After a meeting's transcript or notes finish saving, spawn a background task:

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

  - [ ] 🟥 Identify the correct save hook (end-of-recording path in `recording_commands.rs`,
        or the notes autosave path in the summary module)
  - [ ] 🟥 Add background spawn (non-blocking — never delays the UI)
  - [ ] 🟥 Emit `"wiki-article-ready"` Tauri event on success: `{ meeting_id, title }`

---

- [ ] 🟥 **Step 6: Replace chat handler with index-navigation approach**

  **File:** `frontend/src-tauri/src/chat/handler.rs`

  Replace the current raw-transcript dump with:

  **Step A — Give LLM the index:**
  Read `_index.md` in full. This is small (one line per meeting) and fits in context easily.
  Include it in the system prompt as the navigation layer.

  **Step B — Ask LLM to identify relevant meetings:**
  Run a first LLM pass (lightweight, fast) with a focused prompt:
  ```
  The user asked: "{query}"
  Based on this index of available meeting articles, list the IDs of the 3-5 most relevant
  meetings. Return ONLY a JSON array of meeting IDs: ["id1", "id2", ...]
  ```

  **Step C — Read those full wiki articles:**
  For each returned ID, read the full `.md` file from `wiki/meetings/{id}.md`.
  If no article exists for a meeting yet, fall back to a short raw transcript excerpt.

  **Step D — Final LLM call with full context:**
  Send the full wiki articles as context for the actual answer.

  This is index navigation, not search. The LLM reasons over the index the same way a human
  reads a table of contents to decide which chapter to open.

  - [ ] 🟥 Read `_index.md` and include in system prompt
  - [ ] 🟥 First LLM pass: get relevant meeting IDs
  - [ ] 🟥 Read wiki `.md` files for those meetings
  - [ ] 🟥 Second LLM pass: full answer with article context
  - [ ] 🟥 Remove the old flat-concatenation approach entirely

---

- [ ] 🟥 **Step 7: Add structured citations to chat responses**

  **File:** `frontend/src-tauri/src/chat/handler.rs`

  ```rust
  #[derive(Debug, Serialize, Deserialize)]
  pub struct ChatResponse {
      pub answer: String,
      pub cited_meeting_ids: Vec<String>,
  }
  ```

  In the final answer prompt, instruct the LLM:
  ```
  End your response with exactly:
  SOURCES: id1, id2
  Only list meeting IDs you actually drew from.
  ```

  Parse out the `SOURCES:` line, validate IDs against what was loaded, strip from answer,
  return `ChatResponse`. Update the Tauri command return type accordingly.

  - [ ] 🟥 Define `ChatResponse`
  - [ ] 🟥 Add SOURCES instruction to answer prompt
  - [ ] 🟥 Parse, validate, strip cited IDs
  - [ ] 🟥 Update Tauri command signature in `lib.rs`

---

- [ ] 🟥 **Step 8: Memory page + Brain icon in sidebar**

  **Files to create:**
  - `frontend/src/app/memory/page.tsx` — Memory page layout
  - `frontend/src/components/MemoryChat/index.tsx` — chat messages + text input
  - `frontend/src/components/MemoryChat/CitationCard.tsx` — clickable meeting citation card

  **MemoryChat behavior:**
  - Text input at bottom, send on Enter or button click
  - Messages scroll; assistant turns show answer + citation cards below
  - Loading indicator while waiting for LLM

  **CitationCard:** meeting title + date, clicking opens `/meeting-details?id={id}`

  **Sidebar:** Add `Brain` icon from `lucide-react`, navigates to `/memory`, active state
  on any `/memory/*` route.

  **"Re-compile all" button on Memory page:**
  - New Tauri command `recompile_all_wiki_articles`: iterates all meetings sequentially,
    calls `compile_meeting_to_wiki` for each, emits `wiki-article-ready` events
  - Frontend shows progress count

  - [ ] 🟥 Create `memory/page.tsx`
  - [ ] 🟥 Create `MemoryChat/index.tsx`
  - [ ] 🟥 Create `MemoryChat/CitationCard.tsx`
  - [ ] 🟥 Add Brain nav item to sidebar
  - [ ] 🟥 Add `recompile_all_wiki_articles` Tauri command + register in `lib.rs`
  - [ ] 🟥 Wire Tauri invoke, loading/error states, citation rendering

---

## Phase 2: Concept Pages + Inter-Article Linking

**Goal:** Extract recurring people, projects, and decisions as their own concept pages in
`wiki/concepts/`. Articles already link to these via `[[concept]]` notation from Phase 1.
Phase 2 creates the pages those links point to.

---

- [ ] 🟥 **Step 9: Concept page extractor**

  **File:** `frontend/src-tauri/src/chat/concept_extractor.rs`

  After each meeting compiles, run a second LLM pass to extract concepts:

  ```rust
  pub async fn extract_concepts(
      app_data_dir: PathBuf,
      meeting_id: &str,
      article_content: &str,
  ) -> Result<(), String>
  ```

  LLM returns a JSON array:
  ```json
  [
    { "name": "Alice Chen", "type": "person", "slug": "alice-chen",
      "summary": "Product lead. Owns the roadmap.", "context": "Discussed API timeline." },
    { "name": "Q3 Launch", "type": "project", "slug": "q3-launch",
      "summary": "Target release: July 15.", "context": "Timeline reviewed in this meeting." }
  ]
  ```

  For each extracted concept:
  1. If `wiki/concepts/{slug}.md` doesn't exist → create it with a starter template
  2. If it exists → append a new "## Seen in: {Meeting Title}" section with the context snippet
  3. Update `_index.md` to include concept pages (clearly labelled as `[concept]`)
  4. Append to `_log.md`

  **Concept page format:**
  ```markdown
  # Alice Chen
  **Type:** Person
  {summary paragraph}

  ## Appearances
  - [[{Meeting Title}]](../meetings/{id}.md) — {context snippet}
  ```

  - [ ] 🟥 Create `concept_extractor.rs`
  - [ ] 🟥 Create or update concept `.md` file per extracted concept
  - [ ] 🟥 Update `_index.md` with concept entries
  - [ ] 🟥 Chain after `compile_meeting_to_wiki` in the background pipeline (Step 5)

---

- [ ] 🟥 **Step 10: Concept-aware chat routing**

  **File:** `frontend/src-tauri/src/chat/handler.rs`

  When the LLM reads `_index.md` (Step 6A), the index now includes concept pages too.
  The first LLM routing pass can return both meeting IDs and concept slugs:
  ```json
  { "meetings": ["id1", "id2"], "concepts": ["alice-chen", "q3-launch"] }
  ```

  Read the relevant concept `.md` files alongside meeting articles for the final answer pass.
  This surfaces cross-meeting knowledge without any search infrastructure.

  - [ ] 🟥 Update index routing prompt to accept both meetings and concepts
  - [ ] 🟥 Read concept `.md` files for returned slugs
  - [ ] 🟥 Include concept content in final answer context

---

- [ ] 🟥 **Step 11: Concept pages in Memory UI**

  **Files:**
  - `frontend/src/app/memory/concepts/page.tsx` — list all concept pages, grouped by type
  - `frontend/src/app/memory/concepts/[slug]/page.tsx` — single concept with appearance list

  Add a "Concepts" tab or sub-nav on the Memory page alongside Chat.

  New Tauri commands: `list_concept_files`, `get_concept_file` — read from `wiki/concepts/`.

  - [ ] 🟥 Create concept list page
  - [ ] 🟥 Create concept detail page
  - [ ] 🟥 Add Tauri commands + register in `lib.rs`
  - [ ] 🟥 Add "Concepts" tab on Memory page

---

## Phase 3: Wiki Browser + Outputs Loop + Privacy Controls

**Goal:** Users can see and edit all wiki content. Answers get saved back into the wiki.
Periodic health checks catch errors before they compound.

---

- [ ] 🟥 **Step 12: Wiki browser page**

  **Files:**
  - `frontend/src/app/memory/wiki/page.tsx` — list all articles (meetings + concepts)
  - `frontend/src/app/memory/wiki/[...slug]/page.tsx` — article detail + edit

  **Article list page:**
  - Rows: title, type (meeting/concept), compiled date, stale badge, private badge
  - "Re-compile" button per meeting row
  - "Mark private / public" toggle per row

  **Article detail page:**
  - Render the `.md` file content as formatted markdown
  - "Edit" opens a textarea pre-filled with the file content
  - Save writes back to disk (`fs::write`)
  - "Reset to AI version" re-triggers `compile_meeting_to_wiki` for that meeting

  New Tauri commands: `list_wiki_files`, `get_wiki_file`, `save_wiki_file`,
  `toggle_wiki_private`, `recompile_single_article`

  - [ ] 🟥 Create wiki list page
  - [ ] 🟥 Create article detail + edit page
  - [ ] 🟥 Add Tauri commands + register in `lib.rs`
  - [ ] 🟥 Add "Wiki" tab on Memory page

---

- [ ] 🟥 **Step 13: Outputs loop — save answers back into the wiki**

  After each chat answer, offer a "Save to wiki" button in the Memory chat UI.
  Saving writes the answer to `wiki/outputs/{date}-{first-words-of-query}.md`:

  ```markdown
  # {Query}
  **Date:** {date}
  **Sources:** [[{Meeting 1}]], [[{Meeting 2}]]

  {answer text}
  ```

  Also append to `_log.md` and add an entry to `_index.md` under an `Outputs` section.

  This is the compounding loop Spisak describes: "every question makes the next answer better."
  Future chat sessions can route to saved outputs just like meeting articles.

  - [ ] 🟥 Add "Save to wiki" button on assistant chat turns
  - [ ] 🟥 New Tauri command `save_chat_output(query, answer, cited_ids)` — writes the file,
        updates index and log
  - [ ] 🟥 Include `wiki/outputs/` entries in `_index.md` routing

---

- [ ] 🟥 **Step 14: Health check command**

  Spisak: "Tell your AI: review the entire wiki. Flag contradictions. Find topics mentioned
  but never explained. List unsourced claims."

  New Tauri command `run_wiki_health_check`:
  - Read all wiki files
  - Ask LLM: flag contradictions between articles, find broken `[[links]]` (concepts mentioned
    but no concept page exists), list any claims that appear only once with no corroboration
  - Return findings as a structured report
  - Display in Memory page as a "Health" tab with actionable items

  - [ ] 🟥 Add `run_wiki_health_check` Tauri command
  - [ ] 🟥 Register in `lib.rs`
  - [ ] 🟥 Add "Health" tab on Memory page to display findings

---

- [ ] 🟥 **Step 15: Privacy controls + data management**

  **Chat handler:** skip articles where `is_private = 1` (metadata in SQLite) when building
  context. Skip private meetings in concept extractor.

  **Settings page — new "Memory" section:**
  - Toggle: "Auto-compile wiki after meetings" (default on) — stored in settings table
  - Button: "Re-compile all articles"
  - Button: "Delete all memory data" — deletes `~/.adamant/wiki/` directory entirely +
    truncates `wiki_metadata` table. Requires a confirmation dialog.

  - [ ] 🟥 Enforce `is_private` in chat handler and concept extractor
  - [ ] 🟥 Add Memory section to `settings/page.tsx`
  - [ ] 🟥 Add `delete_all_memory` Tauri command (deletes files + DB rows) + confirmation dialog
  - [ ] 🟥 Store auto-compile toggle in settings table

---

## Status Tracking

* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.

---

## Implementation Order

1. Steps 1–5: filesystem structure + wiki compiler + auto-trigger (no UI changes)
2. Steps 6–7: replace chat handler with index navigation + citations
3. Step 8: Memory page + Brain sidebar icon
4. Steps 9–11: concept pages + Phase 2 entity linking
5. Steps 12–15: wiki browser, outputs loop, health check, privacy controls
