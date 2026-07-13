ALTER TABLE summary_processes ADD COLUMN todo_extraction_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE summary_processes ADD COLUMN todo_extraction_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE summary_processes ADD COLUMN todo_extraction_error TEXT;
ALTER TABLE summary_processes ADD COLUMN todo_extraction_run_id TEXT;
