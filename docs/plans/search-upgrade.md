# Feature Implementation Plan: Unified Meeting Search (FTS5 + Semantic)

**Overall Progress:** `100%`

---

## TLDR

Replace the current broken search (SQL LIKE scans over transcripts only) with a two-layer system: (1) **SQLite FTS5** for instant, ranked keyword search across all meeting content (title, transcripts, AI summary, notes), and (2) **semantic search** using Ollama embeddings stored as BLOBs in SQLite so "product roadmap" finds "Q3 feature planning". Both layers run locally, no network required beyond Ollama on localhost.

---

## Architecture Overview

```
User types query
       ↓
api_search_unified (Tauri command)
       ├── FTS5 query → ranked keyword matches (BM25)
       └── Ollama embedding → cosine similarity → semantic matches
              ↓
       Merge + deduplicate by meeting_id (boost if in both)
              ↓
       Vec<UnifiedSearchResult> { id, title, match_context, match_source, score, match_type }
              ↓
Frontend sidebar: show matched meetings with source label (transcript / notes / summary)
```

**What gets indexed per meeting:**
- `title` — the meeting title
- `transcript_text` — all transcript segments concatenated
- `notes_text` — `meeting_notes.notes_markdown`
- `summary_text` — plain text extracted from `summary_processes.result` JSON

**Embedding content** (one per meeting, truncated to ~6000 chars to fit Ollama context):
```
Title: {title}
Summary: {summary_text}
Notes: {notes_text}
Transcript: {first 4000 chars of transcript_text}
```

---

## End Result

The search bar finds meetings by keyword OR meaning across all content — transcripts, AI summaries, and your own notes. Typing "budget discussion" surfaces a meeting where you wrote "we need to review Q3 spend" even without the word "budget". Results show which part of the meeting matched (transcript / notes / summary). Fully local and private — no data leaves the machine.

---

## Critical Decisions

* **FTS5 external-content table** (not a content= mirror): We aggregate from 3 different tables (transcripts, meeting_notes, summary_processes), so we manage FTS rows ourselves rather than relying on SQLite's content= triggers. A single FTS row per meeting holds concatenated content from all sources.

* **One embedding per meeting (not per chunk)**: Per-chunk embeddings give better precision but 100× more storage and Ollama calls. Per-meeting is sufficient for a personal notes app (< 1000 meetings) and search latency stays under 100ms for up to 5000 meetings.

* **BLOB storage for embeddings, pure-Rust cosine similarity**: Avoids the `sqlite-vec` native extension (complex to load in Tauri). Loading all embeddings for a 1000-meeting library is ~3MB RAM — completely fine.

* **reqwest async (already in Cargo.toml)**: Use the existing `reqwest` async client pattern from `llm_client.rs` for Ollama calls. No new Rust dependencies needed.

* **Graceful degradation**: If Ollama is unreachable or `nomic-embed-text` is not pulled, semantic search silently skips and FTS5 still returns full results. Never block the user.

* **Background embedding indexer**: On app start, missing/stale embeddings are generated one-at-a-time in a background tokio task (throttled to avoid overwhelming Ollama). No UI blocking.

* **FTS maintenance deferred to recording completion** (not per transcript chunk): Refreshing the FTS index after every Whisper chunk fires too frequently during active recording (every ~5s). Instead, `refresh_meeting_fts()` is called once when recording stops and the transcript session is finalized. Mid-recording search will return slightly stale results for the current session — acceptable tradeoff. Notes and summary saves still refresh inline (low-frequency events).

* **Keep `api_search_transcripts` command alive**: It's registered in `lib.rs` and used in frontend. We'll replace its implementation to use the new unified search. No breaking rename needed.

* **content_hash algorithm**: SHA256 of `{title}|{transcript_text}|{notes_text}|{summary_text}` (pipe-delimited concatenation, hex-encoded). Used to detect stale embeddings. If any source changes, the hash changes and the embedding is regenerated.

* **BM25 normalization formula**: SQLite returns negative BM25 values (lower = better match). Normalize to 0–1 using `score = 1.0 / (1.0 + raw_bm25.abs())`. This maps a perfect match (raw ≈ 0) → 1.0 and weak matches → near 0.

* **Frontend request cancellation**: Debounce (300ms) reduces frequency but doesn't cancel an in-flight Tauri invoke. Use an `AbortController`-style ref: store the most recent search query string; when the response arrives, only apply it if the query hasn't changed. Effectively drops stale results without needing true cancellation.

* **Deep-link to transcript position**: Results include a `transcript_segment_id: Option<String>` field. For FTS matches against `transcript_text`, store the meeting_id of the best-matching transcript segment. Frontend uses this to scroll the TranscriptPanel to that segment on result click.

* **Indexing progress is visible**: Show a non-blocking status indicator (small badge or toast) while background embedding indexing is running. Use `api_get_search_index_status` to poll progress. Users who don't have Ollama see "Semantic search unavailable — keyword search active."

* **sqlx must use bundled SQLite** (not system): Add `bundled` to sqlx features in `Cargo.toml`. Without it, system SQLite on macOS (pre-Sonoma) and some Linux distros does not have FTS5 compiled in — the migration fails at app launch with "no such module: fts5". This is a blocker.

* **`unicode61` tokenizer, not `porter ascii`**: The Porter stemmer is harmful for technical terms — `Kubernetes` → `kubernet`, `OAuth` → `oauth`. Use `tokenize='unicode61'` (FTS5 default) which handles Unicode correctly and leaves technical terms intact.

* **`refresh_meeting_fts()` must be atomic**: Wrap the DELETE + INSERT in a single SQLite transaction. If DELETE succeeds and INSERT fails without a transaction, the meeting vanishes from search results until the next content save.

* **BM25 normalization formula**: Use `score = 1.0 / (1.0 + raw_bm25.abs())`. Maps best match (raw ≈ 0) → close to 1.0, weak matches → near 0. Avoids the min-max approach which produces NaN when all scores are equal (single-result set).

* **Cosine similarity zero-norm guard**: Return 0.0 if either vector has zero norm. Prevents NaN from polluting sort order.

* **Empty/special query guard in `search_fts()`**: Return `Ok(vec![])` immediately if `query.trim().is_empty()`. FTS5 `MATCH ""` returns a SQLite syntax error, not empty results. Also sanitize unmatched quotes.

* **Delete dead code in transcript.rs**: `search_transcripts()` and `get_match_context()` in `transcript.rs` become unreachable after the unified search replaces the implementation. Delete both to avoid maintenance confusion.

* **Summary JSON extraction**: Extract plain text from `summary_processes.result` using the existing `SummaryProcess` model's parsed output. The `result` field is a JSON string — extract the concatenated section values (title + content fields) as plain text. Use `COALESCE(result, '')` for NULL safety in the SQL aggregation.

* **COALESCE all nullable FTS columns**: `GROUP_CONCAT(transcript)` returns NULL for meetings with no transcripts; `notes_markdown` is nullable; `summary_processes.result` is nullable. All must be wrapped in `COALESCE(..., '')` in the FTS INSERT query.

---

## Tasks

- [x] 🟩 **Step 1: Enable bundled SQLite + FTS5 migration**
  - [x] 🟩 In `frontend/src-tauri/Cargo.toml`: add `"bundled"` to sqlx features — e.g. `sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "chrono", "bundled"] }` — this ensures FTS5 is compiled in on all platforms (system SQLite on older macOS/Linux may lack it)
  - [x] 🟩 Create migration `20260327000000_add_search_fts5.sql`:
    ```sql
    CREATE VIRTUAL TABLE IF NOT EXISTS meeting_search_fts
    USING fts5(meeting_id UNINDEXED, title, transcript_text, notes_text, summary_text, tokenize='unicode61');
    ```
  - [x] 🟩 In the same migration, populate the FTS table using a single INSERT that JOINs meetings → transcripts (`GROUP_CONCAT`) → meeting_notes → summary_processes with `COALESCE(..., '')` on all nullable columns; extract plain text from `summary_processes.result` JSON using `json_extract(result, '$.sections')` or a full column concat

- [x] 🟩 **Step 2: Embeddings migration — create storage table**
  - [x] 🟩 Create migration `20260327000001_add_embeddings.sql`:
    ```sql
    CREATE TABLE IF NOT EXISTS meeting_embeddings (
      meeting_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      embedding_dim INTEGER NOT NULL,
      model TEXT NOT NULL DEFAULT 'nomic-embed-text',
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
    );
    ```
    Note: `embedding_dim` added to enable dimension mismatch detection at load time.

- [x] 🟩 **Step 3: New search module (`src/search/`)**
  - [x] 🟩 Create `src/search/mod.rs` — exports `fts`, `embeddings`, and the `UnifiedSearchResult` struct with fields: `id: String`, `title: String`, `match_context: String`, `match_source: String` (`"transcript"|"notes"|"summary"|"title"`), `score: f64`, `match_type: String` (`"keyword"|"semantic"`)
  - [x] 🟩 Create `src/search/fts.rs`:
    - `search_fts(pool, query: &str) -> Result<Vec<FtsMatch>>`: guard empty/blank queries first (`if query.trim().is_empty() { return Ok(vec![]) }`), then run `SELECT meeting_id, title, snippet(meeting_search_fts, 2, '<b>', '</b>', '...', 32) as context, bm25(meeting_search_fts) as score FROM meeting_search_fts WHERE meeting_search_fts MATCH ? ORDER BY score LIMIT 20`. Normalize score: `normalized = 1.0 / (1.0 + raw_bm25.abs())`
    - `refresh_meeting_fts(pool, meeting_id: &str) -> Result<()>`: DELETE then INSERT wrapped in a single `BEGIN`/`COMMIT` transaction (or sqlx `pool.begin()` transaction). Use `COALESCE` on all nullable columns. Aggregate title + `COALESCE(GROUP_CONCAT(t.transcript), '')` + `COALESCE(mn.notes_markdown, '')` + `COALESCE(sp.result, '')`.
  - [x] 🟩 Create `src/search/embeddings.rs` — functions:
    1. `generate_embedding(ollama_url: &str, model: &str, text: &str) -> Result<Vec<f32>>`: POST to `{ollama_url}/api/embeddings`, parse `embedding` array, convert f64→f32. Validate `ollama_url` starts with `http://127.0.0.1` or `http://localhost` before making the request.
    2. `store_embedding(pool, meeting_id, embedding: &[f32], model, content_hash)`: record `embedding_dim = embedding.len()`, serialize as LE bytes, upsert.
    3. `load_all_embeddings(pool) -> Result<Vec<(String, Vec<f32>, usize)>>`: return `(meeting_id, embedding, dim)` — caller checks all dims match query embedding dim before running cosine.
    4. `cosine_similarity(a: &[f32], b: &[f32]) -> f32`: guard zero-norm — `if norm_a == 0.0 || norm_b == 0.0 { return 0.0 }`. Return dot product / (norm_a * norm_b).
    5. `build_content_hash(title, transcript_text, notes_text, summary_text) -> String`: SHA256 of `"{title}|{transcript_text}|{notes_text}|{summary_text}"`, hex-encoded. Use the `sha2` crate (add to Cargo.toml if not present).

- [x] 🟩 **Step 4: FTS index maintenance — refresh on recording stop + low-frequency saves**
  - [x] 🟩 In the recording stop handler (in `recording_commands.rs` or wherever the session is finalized after Whisper processes the last chunk): call `refresh_meeting_fts(pool, meeting_id)` once — do **not** call per-chunk in `save_transcript()`
  - [x] 🟩 In `src/database/repositories/summary.rs` summary save path: call `refresh_meeting_fts()` after result is written
  - [x] 🟩 In `api_save_note` command (api.rs): call `refresh_meeting_fts()` after note is written to DB
  - [x] 🟩 In `src/database/repositories/transcript.rs`: **delete** `search_transcripts()` and `get_match_context()` — they become dead code after the unified search replaces the implementation

- [x] 🟩 **Step 5: Unified search Tauri command**
  - [x] 🟩 In `src/api/api.rs`: replace `api_search_transcripts` implementation — call `search_fts(pool, &query)` first; then, if Ollama available, generate query embedding → `load_all_embeddings()` → filter to matching dims → compute cosine similarities → keep top 10
  - [x] 🟩 Merge FTS + semantic results: deduplicate by `meeting_id`, if meeting appears in both layers add 0.3 bonus to score, sort descending
  - [x] 🟩 Update `TranscriptSearchResult` struct: keep `id`, `title`, `match_context`, `timestamp`; add `match_source: Option<String>`, `match_type: Option<String>`
  - [x] 🟩 Frontend stale-result guard: in `SidebarProvider.tsx`, store the latest query in a ref; when the Tauri response arrives, only apply results if `latestQueryRef.current === query` — drops stale responses from previous keystrokes without needing true cancellation

- [x] 🟩 **Step 6: Background embedding indexer + status**
  - [x] 🟩 In `src/search/embeddings.rs`: create `index_missing_embeddings(pool, ollama_url, model)` — SELECT meeting_ids where `meeting_id NOT IN (SELECT meeting_id FROM meeting_embeddings)` OR `content_hash` has changed; for each: build content string → `build_content_hash()` → `generate_embedding()` → validate dim → `store_embedding()`. Limit to 50 per run.
  - [x] 🟩 In `src/lib.rs` or `src/database/setup.rs` startup: after DB init, `tokio::spawn` a background task calling `index_missing_embeddings()` once. Read `ollamaEndpoint` from settings (fallback `http://localhost:11434`). Log result: `info!("Search index: {}/{} meetings embedded", indexed, total)`.
  - [x] 🟩 Add Tauri command `api_get_search_index_status() -> SearchIndexStatus { indexed: usize, total: usize, model: String, ollama_available: bool }` — query `meeting_embeddings` count vs `meetings` count; probe Ollama with a HEAD request to set `ollama_available`

- [x] 🟩 **Step 7: Frontend — debounce, source labels, indexing status**
  - [x] 🟩 In `SidebarProvider.tsx`: add 300ms debounce to `searchTranscripts` calls; add stale-result guard (see Step 5); update `TranscriptSearchResult` interface to include `matchSource?: string` and `matchType?: string`
  - [x] 🟩 In `Sidebar/index.tsx`: show a small source badge next to each result (e.g., "transcript", "notes", "AI summary") using `matchSource`; show "searching..." state during async call using existing `isSearching` flag
  - [x] 🟩 In `Sidebar/index.tsx` or a settings panel: poll `api_get_search_index_status` on mount; if `!ollama_available`, show "Keyword search active · Semantic search requires Ollama"; if indexing in progress (`indexed < total`), show "Indexing {indexed}/{total} meetings for semantic search..."

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
