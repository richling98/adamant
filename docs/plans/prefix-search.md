# Feature Implementation Plan: Prefix / Partial Word Matching

**Overall Progress:** `100%`

## TLDR

Currently searching "quart" finds nothing unless a meeting contains the exact word "quart". FTS5 natively supports prefix matching via the `*` operator — `quart*` matches "quarterly", "quarter", "quarters", etc. This plan appends `*` to every search token so partial words always match their completions. The entire change is one line in `build_fts_query()` in `search/fts.rs`.

## End Result

Typing any partial word in the search bar returns meetings where that word appears in any form. "quart" finds "quarterly". "budget" finds "budgeting" and "budgets". "meet" finds "meeting", "meetings", "meets". Search feels instant and forgiving — you never have to type a complete word to get results.

## Critical Decisions

- **Append `*` to every token after sanitization** — FTS5's prefix operator `*` must be at the end of a token (e.g. `quart*`), not at the start. It's appended in `build_fts_query()` after the existing special-char replacement and split, so the sanitization pipeline stays clean.
- **Keep the 2-character minimum guard** — a single-character prefix like `a*` would match almost every meeting (every word containing "a"). The existing `len() >= 2` filter stays, so `a*` is never sent to SQLite.
- **No tokenizer change needed** — `unicode61` (our current tokenizer) fully supports prefix queries. No migration required.
- **No schema or migration changes** — this is purely a query-building change. The FTS5 virtual table and all existing indexed content are unchanged.

---

## Tasks

- [x] 🟩 **Step 1: Add `*` prefix operator to each token in `build_fts_query()`**
  - [x] 🟩 In `frontend/src-tauri/src/search/fts.rs`, in `build_fts_query()`, change the token join line from:
    ```rust
    Some(tokens.join(" OR "))
    ```
    to:
    ```rust
    let prefixed: Vec<String> = tokens.iter().map(|t| format!("{}*", t)).collect();
    Some(prefixed.join(" OR "))
    ```
  - [x] 🟩 Update the doc comment on `build_fts_query()` to mention step 4: "Append `*` to each token for prefix matching (e.g. `quart` → `quart*` matches `quarterly`)."

- [x] 🟩 **Step 2: Verify compilation**
  - [x] 🟩 Run `cargo check` inside `frontend/src-tauri` — zero errors required.

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
