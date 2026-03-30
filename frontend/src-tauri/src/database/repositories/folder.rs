use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use tracing::{error, info};

use crate::database::models::FolderModel;

pub struct FoldersRepository;

impl FoldersRepository {
    /// Insert a new folder. The caller is responsible for generating a unique `id` (UUID).
    /// `parent_id` is `None` for top-level folders, `Some(id)` for subfolders.
    pub async fn create_folder(
        pool: &SqlitePool,
        id: &str,
        name: &str,
        parent_id: Option<&str>,
    ) -> Result<FolderModel, SqlxError> {
        let now = Utc::now().naive_utc();

        sqlx::query(
            "INSERT INTO folders (id, name, created_at, updated_at, parent_id) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(now)
        .bind(now)
        .bind(parent_id)
        .execute(pool)
        .await?;

        info!("Created folder '{}' with id {} (parent: {:?})", name, id, parent_id);

        // Return the freshly created row
        let folder = sqlx::query_as::<_, FolderModel>(
            "SELECT id, name, created_at, updated_at, parent_id FROM folders WHERE id = ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await?;

        Ok(folder)
    }

    /// Return all folders ordered by creation time (oldest first).
    pub async fn get_all_folders(pool: &SqlitePool) -> Result<Vec<FolderModel>, SqlxError> {
        let folders = sqlx::query_as::<_, FolderModel>(
            "SELECT id, name, created_at, updated_at, parent_id FROM folders ORDER BY created_at ASC",
        )
        .fetch_all(pool)
        .await?;

        Ok(folders)
    }

    /// Rename a folder. Returns `false` if no row was found.
    pub async fn rename_folder(
        pool: &SqlitePool,
        folder_id: &str,
        new_name: &str,
    ) -> Result<bool, SqlxError> {
        if folder_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "folder_id cannot be empty".to_string(),
            ));
        }

        let now = Utc::now().naive_utc();
        let result =
            sqlx::query("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
                .bind(new_name)
                .bind(now)
                .bind(folder_id)
                .execute(pool)
                .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Delete a folder. Any meetings inside it have their `folder_id` set to NULL first
    /// (so they become "unfiled") — both operations run inside a transaction.
    pub async fn delete_folder(
        pool: &SqlitePool,
        folder_id: &str,
    ) -> Result<bool, SqlxError> {
        if folder_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "folder_id cannot be empty".to_string(),
            ));
        }

        let mut tx = pool.begin().await?;

        // Move contained meetings to root (unfiled)
        sqlx::query("UPDATE meetings SET folder_id = NULL WHERE folder_id = ?")
            .bind(folder_id)
            .execute(&mut *tx)
            .await?;

        // Delete the folder itself
        let result = sqlx::query("DELETE FROM folders WHERE id = ?")
            .bind(folder_id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            tx.rollback().await?;
            error!("Folder {} not found for deletion", folder_id);
            return Ok(false);
        }

        tx.commit().await?;
        info!("Deleted folder {} (meetings moved to root)", folder_id);
        Ok(true)
    }
}
