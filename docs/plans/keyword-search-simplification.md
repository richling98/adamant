# Feature Implementation Plan: Keyword-Only Search

**Overall Progress:** `100%`

## TLDR

The current search is broken because: (1) FTS5 treats space-separated words as AND — so "budget Sarah" only finds meetings containing *both* words, silently excluding meetings that contain only one; (2) the Ollama/semantic layer adds latency and noise even though Ollama isn't running for most users.

This plan strips all semantic/Ollama code out of the search stack and rewrites the FTS5 query to use OR logic — so any meeting containing at least one of your typed words appears as a result, ranked by how many words matched. Search covers all four content fields: title, transcript, notes, and AI summary.

## End Result

The user types one or more words in the search bar. Within ~300ms of stopping typing, the sidebar shows every meeting where at least one of those words appears in the title, transcript, meeting notes, or AI summary — ranked by relevance (more words matched = ranked higher). A small badge on each result shows where the match came from (title / transcript / notes / summary). No Ollama, no indexing banner, no semantic layer — pure fast keyword search.

## Critical Decisions

- **OR instead of AND for multi-word queries:** "budget Q3 Sarah" → `budget OR Q3 OR Sarah` in FTS5. A meeting needs only one word to appear. More matches = higher BM25 score = higher rank. This is explicitly what the user asked for.
- **Delete embeddings entirely:** The `meeting_embeddings` migration was never applied (app failed to compile before launch), so it's safe to delete the migration file and the module. No rollback needed.
- **Keep FTS5 index maintenance:** `refresh_meeting_fts()` stays wired into note saves, AI summary completion, and recording stop — so search stays current.
- **Source detection via per-column snippets:** Pull `snippet()` for all 4 indexed columns in a single SQL query. Check which column has `<b>` markers to set the source badge (transcript / notes / summary / title).
- **Keep debounce + stale-result guard on frontend:** These are correct and working — no changes needed to the debounce logic.

---

## Tasks

- [x] 🟩 **Step 1: Rewrite `search_fts()` — OR logic + per-column source detection**
  - [ ] 🟥 In `frontend/src-tauri/src/search/fts.rs`, rewrite the query sanitizer:
    - **Replace** FTS5 special characters (`"`, `*`, `(`, `)`, `-`) with **spaces** first — do NOT strip them from within a token. This prevents hyphenated words like `Q3-results` from fusing into one mangled token. Then split on whitespace.
    - Filter out empty tokens after splitting
    - Guard: if fewer than 2 characters total across all tokens, return `Ok(vec![])` (avoids matching every meeting on single-char queries like "a")
    - Join tokens with ` OR ` → e.g. `"budget Q3-results Sarah"` → `"budget OR Q3 OR results OR Sarah"`
  - [ ] 🟥 Update the SQL query in `search_fts()` to fetch per-column snippets in a single SELECT. The `query_as` tuple must be exactly 6 fields in this order: `(String, String, String, String, String, f64)` → `(meeting_id, title_snip, transcript_snip, notes_snip, summary_snip, score)`:
    - `snippet(meeting_search_fts, 1, '<b>', '</b>', '…', 32)` — title (col index 1)
    - `snippet(meeting_search_fts, 2, '<b>', '</b>', '…', 32)` — transcript_text (col index 2)
    - `snippet(meeting_search_fts, 3, '<b>', '</b>', '…', 32)` — notes_text (col index 3)
    - `snippet(meeting_search_fts, 4, '<b>', '</b>', '…', 32)` — summary_text (col index 4)
    - `bm25(meeting_search_fts, 0, 4, 2, 2, 1)` — score (title×4, transcript×2, notes×2, summary×1)
  - [ ] 🟥 In the Rust result mapping, determine `match_source` and `context` by checking which snippet contains `<b>`:
    - Transcript snippet contains `<b>` → source="transcript", context=transcript_snip
    - Else notes snippet contains `<b>` → source="notes", context=notes_snip
    - Else summary snippet contains `<b>` → source="summary", context=summary_snip
    - Else (title-only match) → source="title", context=title_snip (use title snippet so the highlighted word is visible, not an empty string)
  - [ ] 🟥 Remove the old quote-balance sanitizer (the `trimmed.chars().filter(|&c| c == '"')` block — replaced by the new approach above)

- [x] 🟩 **Step 2: Simplify `api_search_transcripts` — remove all Ollama/semantic code**
  - [ ] 🟥 In `frontend/src-tauri/src/api/api.rs`, delete the entire "Layer 2: Semantic search" block (~lines 470–527)
  - [ ] 🟥 Remove the `HashMap` merge accumulator — results come directly from `search_fts()`, no merging needed
  - [ ] 🟥 Simplify the function body to: call `search_fts()` → map each `FtsMatch` to `TranscriptSearchResult` → sort by score → return
  - [ ] 🟥 Delete the `api_get_search_index_status` function (~lines 1855–1890) from `api.rs`
  - [ ] 🟥 Delete the `SearchIndexStatus` struct from `api.rs`
  - [ ] 🟥 Remove `api::api_get_search_index_status` from the `invoke_handler!` list in `lib.rs`

- [x] 🟩 **Step 3: Delete the embeddings module + clear sqlx cache**
  - [ ] 🟥 Delete `frontend/src-tauri/src/search/embeddings.rs`
  - [ ] 🟥 In `frontend/src-tauri/src/search/mod.rs`, remove `pub mod embeddings;` and the embeddings reference in the doc comment
  - [ ] 🟥 Delete `frontend/src-tauri/migrations/20260327000001_add_embeddings.sql` (safe — never applied; app failed to compile before first launch with this migration)
  - [ ] 🟥 Delete `frontend/src-tauri/.sqlx/` directory if it exists — the offline query cache may contain references to `meeting_embeddings` which no longer exists, causing `cargo check` to fail even though the Rust code is correct. Deleting forces a cache rebuild.

- [x] 🟩 **Step 4: Frontend — remove indexing status banner and state**
  - [ ] 🟥 In `SidebarProvider.tsx`:
    - Remove the `SearchIndexStatus` interface
    - Remove `searchIndexStatus` from `SidebarContextType`
    - Remove `const [searchIndexStatus, setSearchIndexStatus] = useState<SearchIndexStatus | null>(null);`
    - Remove the `useEffect` that calls `invoke('api_get_search_index_status')` (~lines 249–253)
    - Remove `searchIndexStatus` from the context value object
  - [ ] 🟥 In `Sidebar/index.tsx`:
    - Remove `searchIndexStatus` from the `useSidebar()` destructure
    - Delete the entire "Search index status" banner block (~lines 874–890): `{!searchQuery && searchIndexStatus && ( ... )}`
    - In the snippet display, change the "semantic match" italic fallback (the `else` branch of `matchingResult.matchContext`) to render nothing — `null` — rather than the "semantic match" label. This branch still fires for title-only matches (where context is the title snippet) but after Step 1 the context will always be non-empty, so this branch will never render in practice. Keeping it as `null` is the clean silent fallback.

- [x] 🟩 **Step 5: Verify compilation and test**
  - [ ] 🟥 Run `cargo check` inside `frontend/src-tauri` — must compile with zero errors
  - [ ] 🟥 Run `./clean_run.sh` from the `frontend/` directory — app must launch
  - [ ] 🟥 Manually verify: type a single word → matching meetings appear
  - [ ] 🟥 Manually verify: type multiple words → meetings with ANY of the words appear (OR logic)
  - [ ] 🟥 Manually verify: hyphenated query like "Q3-results" works correctly (both "Q3" and "results" match independently)
  - [ ] 🟥 Manually verify: search matches title, transcript, notes, and summary independently
  - [ ] 🟥 Manually verify: source badge shows correct field (transcript / notes / summary / title)
  - [ ] 🟥 Manually verify: single-character query (e.g. "a") returns no results (minimum length guard)

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
