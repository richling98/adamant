-- Create folders table for organizing meetings
-- Folders are one level deep (no nested folders)
CREATE TABLE IF NOT EXISTS folders (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

-- Add folder_id FK to meetings table
-- ON DELETE SET NULL: deleting a folder moves its meetings to "unfiled" (root)
ALTER TABLE meetings ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
