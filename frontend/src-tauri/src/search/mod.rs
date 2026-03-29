/// Search module: FTS5 keyword search across all meeting content.
///
/// Architecture:
///   fts.rs — SQLite FTS5 keyword search (OR logic, BM25 ranking) + index maintenance
///
/// The search command `api_search_transcripts` in api.rs calls `search_fts()`
/// and returns results directly — no merging, no external services required.
pub mod fts;

use serde::{Deserialize, Serialize};

/// A single unified search result returned to the frontend.
///
/// The frontend uses `match_source` to show a badge (transcript / notes /
/// summary / title) indicating where in the meeting the keyword was found.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnifiedSearchResult {
    /// Meeting UUID.
    pub id: String,
    /// Meeting title (plain text).
    pub title: String,
    /// HTML snippet with matched term wrapped in `<b>…</b>` for highlighting.
    pub match_context: String,
    /// Which content field matched: "transcript" | "notes" | "summary" | "title"
    pub match_source: String,
    /// Always "keyword" — semantic search removed.
    pub match_type: String,
    /// Normalised BM25 relevance score in [0.0, 1.0].
    pub score: f64,
}
