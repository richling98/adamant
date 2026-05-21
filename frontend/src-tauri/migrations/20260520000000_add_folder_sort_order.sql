ALTER TABLE folders ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Preserve the existing visible order within each sibling group.
UPDATE folders
SET sort_order = (
    SELECT COUNT(*)
    FROM folders AS earlier
    WHERE (
        earlier.parent_id = folders.parent_id
        OR (earlier.parent_id IS NULL AND folders.parent_id IS NULL)
    )
    AND (
        earlier.created_at < folders.created_at
        OR (earlier.created_at = folders.created_at AND earlier.id <= folders.id)
    )
) - 1;
