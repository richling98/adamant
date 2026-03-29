use crate::api::TranscriptSegment;
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use tracing::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

impl TranscriptsRepository {
    /// Saves transcript segments for a meeting.
    ///
    /// If `existing_meeting_id` is `Some(id)`, the transcripts are attached to that
    /// existing meeting (only its `updated_at` and `folder_path` are touched, no new
    /// row is inserted into `meetings`).  This is the "start recording from the notes
    /// page" path where we want notes + transcripts to live in the same meeting.
    ///
    /// If `existing_meeting_id` is `None`, a brand-new meeting row is created first
    /// (backward-compatible with the classic home-page recording flow).
    ///
    /// The function uses a transaction so that either all writes succeed or none do.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
        existing_meeting_id: Option<String>,
    ) -> Result<String, SqlxError> {
        // Resolve the meeting ID: reuse the provided one or mint a new UUID.
        let is_existing = existing_meeting_id.is_some();
        let meeting_id = existing_meeting_id
            .unwrap_or_else(|| format!("meeting-{}", Uuid::new_v4()));

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        if is_existing {
            // 1a. Update the existing meeting's metadata (touch updated_at; merge folder_path).
            let result = sqlx::query(
                "UPDATE meetings SET updated_at = ?, folder_path = COALESCE(?, folder_path) WHERE id = ?",
            )
            .bind(now)
            .bind(&folder_path)
            .bind(&meeting_id)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!("Failed to update existing meeting '{}': {}", meeting_id, e);
                transaction.rollback().await?;
                return Err(e);
            }

            info!("Updated existing meeting metadata for id: {}", meeting_id);
        } else {
            // 1b. Create a brand-new meeting row.
            let result = sqlx::query(
                "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
            )
            .bind(&meeting_id)
            .bind(meeting_title)
            .bind(now)
            .bind(now)
            .bind(&folder_path)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!("Failed to create meeting '{}': {}", meeting_title, e);
                transaction.rollback().await?;
                return Err(e);
            }

            info!("Successfully created meeting with id: {}", meeting_id);
        }

        // 2. Save each transcript segment with audio timing fields
        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration)
                 VALUES (?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!(
                    "Failed to save transcript segment for meeting {}: {}",
                    meeting_id, e
                );
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

}
// search_transcripts() and get_match_context() removed — replaced by
// crate::search::fts::search_fts() (FTS5 keyword search) and
// crate::search::embeddings (semantic search) in the unified search pipeline.
