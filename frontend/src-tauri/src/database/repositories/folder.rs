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

        info!(
            "Created folder '{}' with id {} (parent: {:?})",
            name, id, parent_id
        );

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
            return Err(SqlxError::Protocol("folder_id cannot be empty".to_string()));
        }

        let now = Utc::now().naive_utc();
        let result = sqlx::query("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?")
            .bind(new_name)
            .bind(now)
            .bind(folder_id)
            .execute(pool)
            .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Move a folder under a new parent, or to the top level when `parent_id` is `None`.
    /// Rejects cycles so the frontend can safely render the folder tree recursively.
    pub async fn move_folder(
        pool: &SqlitePool,
        folder_id: &str,
        parent_id: Option<&str>,
    ) -> Result<bool, SqlxError> {
        if folder_id.trim().is_empty() {
            return Err(SqlxError::Protocol("folder_id cannot be empty".to_string()));
        }

        if let Some(parent_id) = parent_id {
            if parent_id.trim().is_empty() {
                return Err(SqlxError::Protocol("parent_id cannot be empty".to_string()));
            }

            if parent_id == folder_id {
                return Err(SqlxError::Protocol(
                    "Cannot move a folder into itself".to_string(),
                ));
            }
        }

        let mut tx = pool.begin().await?;

        let source_exists: Option<(String,)> =
            sqlx::query_as("SELECT id FROM folders WHERE id = ?")
                .bind(folder_id)
                .fetch_optional(&mut *tx)
                .await?;

        if source_exists.is_none() {
            tx.rollback().await?;
            return Ok(false);
        }

        if let Some(parent_id) = parent_id {
            let mut current_parent = Some(parent_id.to_string());

            while let Some(current_id) = current_parent {
                if current_id == folder_id {
                    tx.rollback().await?;
                    return Err(SqlxError::Protocol(
                        "Cannot move a folder into one of its descendants".to_string(),
                    ));
                }

                let parent_row: Option<(Option<String>,)> =
                    sqlx::query_as("SELECT parent_id FROM folders WHERE id = ?")
                        .bind(&current_id)
                        .fetch_optional(&mut *tx)
                        .await?;

                match parent_row {
                    Some((next_parent,)) => current_parent = next_parent,
                    None => {
                        tx.rollback().await?;
                        return Err(SqlxError::Protocol(format!(
                            "Target parent folder not found: {}",
                            parent_id
                        )));
                    }
                }
            }
        }

        let now = Utc::now().naive_utc();
        let result = sqlx::query("UPDATE folders SET parent_id = ?, updated_at = ? WHERE id = ?")
            .bind(parent_id)
            .bind(now)
            .bind(folder_id)
            .execute(&mut *tx)
            .await?;

        if result.rows_affected() == 0 {
            tx.rollback().await?;
            return Ok(false);
        }

        tx.commit().await?;
        info!("Moved folder {} to parent {:?}", folder_id, parent_id);
        Ok(true)
    }

    /// Delete a folder. Any meetings inside it have their `folder_id` set to NULL first
    /// (so they become "unfiled") — both operations run inside a transaction.
    pub async fn delete_folder(pool: &SqlitePool, folder_id: &str) -> Result<bool, SqlxError> {
        if folder_id.trim().is_empty() {
            return Err(SqlxError::Protocol("folder_id cannot be empty".to_string()));
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

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");

        sqlx::query(
            r#"
            CREATE TABLE folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("Failed to create folders table");

        pool
    }

    async fn create_test_folder(pool: &SqlitePool, id: &str, parent_id: Option<&str>) {
        FoldersRepository::create_folder(pool, id, id, parent_id)
            .await
            .expect("Failed to create test folder");
    }

    async fn folder_parent(pool: &SqlitePool, id: &str) -> Option<String> {
        let row: (Option<String>,) = sqlx::query_as("SELECT parent_id FROM folders WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .expect("Failed to fetch folder parent");

        row.0
    }

    #[tokio::test]
    async fn move_folder_moves_top_level_folder_under_parent() {
        let pool = test_pool().await;
        create_test_folder(&pool, "folder-a", None).await;
        create_test_folder(&pool, "folder-b", None).await;

        let moved = FoldersRepository::move_folder(&pool, "folder-a", Some("folder-b"))
            .await
            .expect("move should succeed");

        assert!(moved);
        assert_eq!(
            folder_parent(&pool, "folder-a").await.as_deref(),
            Some("folder-b")
        );
    }

    #[tokio::test]
    async fn move_folder_moves_nested_folder_back_to_root() {
        let pool = test_pool().await;
        create_test_folder(&pool, "folder-a", None).await;
        create_test_folder(&pool, "folder-b", Some("folder-a")).await;

        let moved = FoldersRepository::move_folder(&pool, "folder-b", None)
            .await
            .expect("move should succeed");

        assert!(moved);
        assert_eq!(folder_parent(&pool, "folder-b").await, None);
    }

    #[tokio::test]
    async fn move_folder_rejects_self_parent() {
        let pool = test_pool().await;
        create_test_folder(&pool, "folder-a", None).await;

        let err = FoldersRepository::move_folder(&pool, "folder-a", Some("folder-a"))
            .await
            .expect_err("self move should fail");

        assert!(err.to_string().contains("Cannot move a folder into itself"));
    }

    #[tokio::test]
    async fn move_folder_rejects_descendant_parent() {
        let pool = test_pool().await;
        create_test_folder(&pool, "folder-a", None).await;
        create_test_folder(&pool, "folder-b", Some("folder-a")).await;
        create_test_folder(&pool, "folder-c", Some("folder-b")).await;

        let err = FoldersRepository::move_folder(&pool, "folder-a", Some("folder-c"))
            .await
            .expect_err("descendant move should fail");

        assert!(err
            .to_string()
            .contains("Cannot move a folder into one of its descendants"));
        assert_eq!(folder_parent(&pool, "folder-a").await, None);
    }

    #[tokio::test]
    async fn move_folder_rejects_missing_target_parent() {
        let pool = test_pool().await;
        create_test_folder(&pool, "folder-a", None).await;

        let err = FoldersRepository::move_folder(&pool, "folder-a", Some("missing-folder"))
            .await
            .expect_err("missing target should fail");

        assert!(err
            .to_string()
            .contains("Target parent folder not found: missing-folder"));
        assert_eq!(folder_parent(&pool, "folder-a").await, None);
    }
}
