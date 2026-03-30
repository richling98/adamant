/// FTS5 keyword search and index maintenance.
///
/// ## Index structure
/// `meeting_search_fts` is a single-row-per-meeting virtual table with columns:
///   meeting_id (UNINDEXED, col 0), title (col 1), transcript_text (col 2),
///   notes_text (col 3), summary_text (col 4)
///
/// ## Query strategy
/// Multi-word queries use OR logic: every token is a separate search term joined
/// with OR. A meeting needs only one token to match to appear in results.
/// BM25 naturally ranks meetings that match more tokens higher.
///
/// ## Maintenance strategy
/// FTS rows are refreshed (DELETE + transactional INSERT) at:
///   - Recording stop / api_save_transcript finalization
///   - AI summary completion
///   - Notes save (api_save_note)
/// Per-chunk transcript saves do NOT trigger a refresh to avoid O(n²) work
/// during long recordings.

use sqlx::SqlitePool;
use tracing::{info, warn};

use super::UnifiedSearchResult;

/// An intermediate FTS hit before returning to the caller.
#[derive(Debug, Clone)]
pub struct FtsMatch {
    pub meeting_id: String,
    pub title: String,
    /// HTML snippet with matched term wrapped in `<b>…</b>`.
    /// For title-only matches this is the title snippet itself.
    pub context: String,
    /// Normalised BM25 score in [0.0, 1.0].  SQLite returns negative BM25
    /// (lower = better), so we convert with `1.0 / (1.0 + abs(raw))`.
    pub score: f64,
    /// Which column produced the best snippet: "transcript" | "notes" | "summary" | "title"
    pub match_source: String,
}

/// Build a safe FTS5 OR query from a user-supplied string.
///
/// Strategy:
///   1. Replace FTS5 special characters (`"`, `*`, `(`, `)`, `-`) with spaces.
///      Replacement (not stripping) prevents hyphenated words like `Q3-results`
///      from fusing into the single mangled token `Q3results`.
///   2. Split on whitespace.
///   3. Drop tokens shorter than 2 characters to avoid matching nearly everything.
///   4. Append `*` to each token for prefix matching (e.g. `quart` → `quart*`
///      matches `quarterly`, `quarter`, `quarters`, etc.).
///   5. Join with ` OR `.
///
/// Returns `None` if no usable tokens remain (caller should return empty results).
fn build_fts_query(raw: &str) -> Option<String> {
    let sanitized = raw.replace(|c| matches!(c, '"' | '*' | '(' | ')' | '-'), " ");

    let tokens: Vec<&str> = sanitized
        .split_whitespace()
        .filter(|t| t.len() >= 2)
        .collect();

    if tokens.is_empty() {
        return None;
    }

    let prefixed: Vec<String> = tokens.iter().map(|t| format!("{}*", t)).collect();
    Some(prefixed.join(" OR "))
}

/// Search the FTS5 index for `query`, returning up to 20 ranked results.
///
/// - Returns `Ok(vec![])` for blank/short queries without touching the DB.
/// - Multi-word queries use OR logic — a meeting matches if any token appears.
/// - BM25 weights: title×4, transcript×2, notes×2, summary×1.
/// - Per-column snippets determine the `match_source` badge shown in the UI.
pub async fn search_fts(pool: &SqlitePool, query: &str) -> Result<Vec<FtsMatch>, sqlx::Error> {
    // Guard: blank or too-short query → empty result.
    // Also catches single-char queries that would match nearly every meeting.
    let trimmed = query.trim();
    if trimmed.len() < 2 {
        return Ok(vec![]);
    }

    // Build the OR-joined FTS5 query string.
    let fts_query = match build_fts_query(trimmed) {
        Some(q) => q,
        None => return Ok(vec![]),
    };

    // Fetch per-column snippets for all 4 indexed columns plus the plain title.
    // Tuple order must exactly match the 7 SELECT columns:
    //   0: meeting_id (String)
    //   1: title      (String)   — plain title from the FTS index
    //   2: title_snip (String)   — snippet(col 1 = title) with <b> highlights
    //   3: trans_snip (String)   — snippet(col 2 = transcript_text)
    //   4: notes_snip (String)   — snippet(col 3 = notes_text)
    //   5: summ_snip  (String)   — snippet(col 4 = summary_text)
    //   6: score      (f64)      — bm25 raw score (negative; lower = better)
    let rows = sqlx::query_as::<_, (String, String, String, String, String, String, f64)>(
        r#"
        SELECT
            meeting_id,
            title,
            snippet(meeting_search_fts, 1, '<b>', '</b>', '…', 32) AS title_snip,
            snippet(meeting_search_fts, 2, '<b>', '</b>', '…', 32) AS trans_snip,
            snippet(meeting_search_fts, 3, '<b>', '</b>', '…', 32) AS notes_snip,
            snippet(meeting_search_fts, 4, '<b>', '</b>', '…', 32) AS summ_snip,
            bm25(meeting_search_fts, 0, 4, 2, 2, 1)                AS score
        FROM meeting_search_fts
        WHERE meeting_search_fts MATCH ?
        ORDER BY score
        LIMIT 20
        "#,
    )
    .bind(&fts_query)
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|(meeting_id, title, title_snip, trans_snip, notes_snip, summ_snip, raw_score)| {
            // Normalise BM25: SQLite returns negative values (lower = better match).
            // `1.0 / (1.0 + |raw|)` maps best match (~0) → near 1.0, weak → near 0.
            // Safe when all scores are equal (no div-by-zero).
            let score = 1.0 / (1.0 + raw_score.abs());

            // Determine match source by checking which snippet contains a highlight
            // marker. FTS5 only inserts `<b>` in snippets where the query matched.
            let (match_source, context) = if trans_snip.contains("<b>") {
                ("transcript", trans_snip)
            } else if notes_snip.contains("<b>") {
                ("notes", notes_snip)
            } else if summ_snip.contains("<b>") {
                ("summary", summ_snip)
            } else {
                // Title-only match: use the title snippet so the highlighted
                // word is visible in the UI rather than an empty context area.
                ("title", title_snip)
            };

            FtsMatch {
                meeting_id,
                title,
                context,
                score,
                match_source: match_source.to_string(),
            }
        })
        .collect();

    Ok(results)
}

/// Convert an `FtsMatch` into a `UnifiedSearchResult`.
pub fn fts_match_to_result(m: FtsMatch) -> UnifiedSearchResult {
    UnifiedSearchResult {
        id: m.meeting_id,
        title: m.title,
        match_context: m.context,
        match_source: m.match_source,
        match_type: "keyword".to_string(),
        score: m.score,
    }
}

/// Refresh the FTS row for `meeting_id` by re-aggregating all its content.
///
/// This is a DELETE + INSERT wrapped in a single transaction so there is no
/// window where the meeting is absent from search results.
///
/// # When to call
/// - After `api_save_transcript` (recording session finalized)
/// - After `api_save_note` (user saved meeting notes)
/// - After AI summary completes (`update_process_completed`)
///
/// # When NOT to call
/// - After each individual Whisper transcript chunk during recording.
///   Call only once at recording stop to avoid O(n²) GROUP_CONCAT cost.
pub async fn refresh_meeting_fts(pool: &SqlitePool, meeting_id: &str) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    // Remove the old FTS row (if any).
    sqlx::query("DELETE FROM meeting_search_fts WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *tx)
        .await?;

    // Re-insert by aggregating current content from all source tables.
    // COALESCE ensures NULL columns (no transcripts yet / no notes / no summary)
    // produce empty strings rather than NULL in the FTS row.
    let rows_inserted = sqlx::query(
        r#"
        INSERT INTO meeting_search_fts (meeting_id, title, transcript_text, notes_text, summary_text)
        SELECT
            m.id,
            m.title,
            COALESCE(GROUP_CONCAT(t.transcript, ' '), '') AS transcript_text,
            COALESCE(mn.notes_markdown, '')               AS notes_text,
            COALESCE(sp.result, '')                       AS summary_text
        FROM meetings m
        LEFT JOIN transcripts   t  ON t.meeting_id  = m.id
        LEFT JOIN meeting_notes mn ON mn.meeting_id = m.id
        LEFT JOIN summary_processes sp ON sp.meeting_id = m.id
        WHERE m.id = ?
        GROUP BY m.id, m.title, mn.notes_markdown, sp.result
        "#,
    )
    .bind(meeting_id)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    tx.commit().await?;

    if rows_inserted > 0 {
        info!("FTS index refreshed for meeting {}", meeting_id);
    } else {
        warn!(
            "FTS refresh for meeting {} inserted 0 rows — meeting may have been deleted",
            meeting_id
        );
    }

    Ok(())
}
