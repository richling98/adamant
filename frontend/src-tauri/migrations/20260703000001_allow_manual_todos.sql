-- Allow manually-created todos to exist without a backing meeting row.
-- SQLite cannot directly drop NOT NULL from a column, so rebuild the table.
PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS todos_new (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT,
    date TEXT NOT NULL,
    content_json TEXT,
    content_markdown TEXT,
    is_checked INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    source_text TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

INSERT INTO todos_new (
    id,
    meeting_id,
    date,
    content_json,
    content_markdown,
    is_checked,
    sort_order,
    source_text,
    created_at,
    updated_at
)
SELECT
    id,
    NULLIF(meeting_id, 'manual'),
    date,
    content_json,
    content_markdown,
    is_checked,
    sort_order,
    source_text,
    created_at,
    updated_at
FROM todos;

DROP TABLE todos;
ALTER TABLE todos_new RENAME TO todos;

CREATE INDEX IF NOT EXISTS idx_todos_date ON todos(date);
CREATE INDEX IF NOT EXISTS idx_todos_meeting ON todos(meeting_id);

PRAGMA foreign_keys = ON;
