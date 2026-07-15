use chrono::Utc;
use sqlx::SqlitePool;
use tracing::info;

use crate::database::models::WikiMetadata;

pub struct WikiMetadataRepository;

impl WikiMetadataRepository {
    /// Upsert a wiki metadata row. If the meeting_id already exists, update
    /// it; otherwise insert a new row.
    pub async fn upsert(
        pool: &SqlitePool,
        meeting_id: &str,
        is_stale: bool,
        token_count: Option<i64>,
        model: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        sqlx::query(
            r#"
            INSERT INTO wiki_metadata (meeting_id, compiled_at, is_stale, token_count, model, version, error)
            VALUES (?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(meeting_id) DO UPDATE SET
                compiled_at = excluded.compiled_at,
                is_stale = excluded.is_stale,
                token_count = excluded.token_count,
                model = excluded.model,
                version = version + 1,
                error = excluded.error
            "#,
        )
        .bind(meeting_id)
        .bind(&now)
        .bind(is_stale)
        .bind(token_count)
        .bind(model)
        .bind(error)
        .execute(pool)
        .await?;
        info!(meeting_id, "wiki_metadata upserted");
        Ok(())
    }

    /// Mark a meeting's wiki article as stale (e.g. after re-transcription).
    pub async fn mark_stale(pool: &SqlitePool, meeting_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE wiki_metadata SET is_stale = 1 WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Fetch metadata for a single meeting.
    pub async fn get(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<WikiMetadata>, sqlx::Error> {
        let row = sqlx::query_as::<_, WikiMetadata>(
            "SELECT * FROM wiki_metadata WHERE meeting_id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// Fetch all metadata rows (for re-compile-all or index building).
    pub async fn get_all(pool: &SqlitePool) -> Result<Vec<WikiMetadata>, sqlx::Error> {
        let rows =
            sqlx::query_as::<_, WikiMetadata>("SELECT * FROM wiki_metadata").fetch_all(pool).await?;
        Ok(rows)
    }

    /// Fetch meeting IDs that have no wiki_metadata entry at all.
    pub async fn get_uncached_meeting_ids(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
        let rows: Vec<(String,)> = sqlx::query_as(
            "SELECT m.id FROM meetings m LEFT JOIN wiki_metadata w ON m.id = w.meeting_id WHERE w.meeting_id IS NULL"
        )
        .fetch_all(pool)
        .await?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    /// Fetch metadata for all stale articles (is_stale = 1).
    pub async fn get_stale(pool: &SqlitePool) -> Result<Vec<WikiMetadata>, sqlx::Error> {
        let rows = sqlx::query_as::<_, WikiMetadata>(
            "SELECT * FROM wiki_metadata WHERE is_stale = 1",
        )
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Delete metadata row (called when a meeting is deleted).
    pub async fn delete(pool: &SqlitePool, meeting_id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM wiki_metadata WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Returns the number of non-stale, compiled articles.
    pub async fn count_ready(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
        let (count,): (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM wiki_metadata WHERE is_stale = 0 AND error IS NULL",
        )
        .fetch_one(pool)
        .await?;
        Ok(count)
    }
}
