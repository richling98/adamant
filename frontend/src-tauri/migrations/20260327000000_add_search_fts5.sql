-- FTS5 virtual table for fast keyword search across all meeting content.
--
-- Uses unicode61 tokenizer (not porter) to preserve technical terms like
-- "Kubernetes", "OAuth", etc. that porter stemmer would mangle.
--
-- Columns:
--   meeting_id    — stored but not indexed (just identifies the row)
--   title         — meeting title
--   transcript_text — all transcript segments concatenated with spaces
--   notes_text    — meeting notes markdown
--   summary_text  — AI summary result (raw JSON string; FTS5 still finds
--                   keywords within JSON values without special handling)
CREATE VIRTUAL TABLE IF NOT EXISTS meeting_search_fts
USING fts5(
    meeting_id UNINDEXED,
    title,
    transcript_text,
    notes_text,
    summary_text,
    tokenize = 'unicode61'
);

-- Populate FTS with all existing meetings at migration time.
-- COALESCE ensures NULL values (no transcripts yet, no notes, no summary)
-- produce empty strings rather than NULL columns in the FTS row.
-- GROUP BY aggregates all transcript segments per meeting into one row.
INSERT INTO meeting_search_fts (meeting_id, title, transcript_text, notes_text, summary_text)
SELECT
    m.id,
    m.title,
    COALESCE(GROUP_CONCAT(t.transcript, ' '), '') AS transcript_text,
    COALESCE(mn.notes_markdown, '')               AS notes_text,
    COALESCE(sp.result, '')                       AS summary_text
FROM meetings m
LEFT JOIN transcripts  t  ON t.meeting_id  = m.id
LEFT JOIN meeting_notes mn ON mn.meeting_id = m.id
LEFT JOIN summary_processes sp ON sp.meeting_id = m.id
GROUP BY m.id, m.title, mn.notes_markdown, sp.result;
