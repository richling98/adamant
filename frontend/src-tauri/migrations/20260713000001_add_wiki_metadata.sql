-- Tracks per-meeting wiki article compilation metadata.
-- Every compiled meeting gets one row; ON DELETE CASCADE removes it
-- when the meeting is deleted.
CREATE TABLE IF NOT EXISTS wiki_metadata (
    meeting_id   TEXT PRIMARY KEY REFERENCES meetings(id) ON DELETE CASCADE,
    compiled_at  TEXT NOT NULL,
    is_stale     INTEGER NOT NULL DEFAULT 0,
    token_count  INTEGER,
    model        TEXT,
    version      INTEGER NOT NULL DEFAULT 1,
    error        TEXT
);
