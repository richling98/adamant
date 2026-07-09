use crate::database::models::{TodoDateSummary, TodoModel, TodoWithMeeting};
use chrono::Utc;
use sqlx::SqlitePool;
use tracing::error;
use uuid::Uuid;

pub struct TodosRepository;

impl TodosRepository {
    pub async fn get_by_date(
        pool: &SqlitePool,
        date: &str,
    ) -> Result<Vec<TodoWithMeeting>, sqlx::Error> {
        sqlx::query_as::<_, TodoWithMeeting>(
            "SELECT t.id, t.meeting_id, COALESCE(m.title, '') AS meeting_title, t.date, \
             t.content_json, t.content_markdown, t.is_checked, t.sort_order, \
             t.source_text, t.created_at, t.updated_at \
             FROM todos t \
             LEFT JOIN meetings m ON t.meeting_id = m.id \
             WHERE t.date = ? \
             ORDER BY t.sort_order ASC, t.created_at ASC",
        )
        .bind(date)
        .fetch_all(pool)
        .await
    }

    pub async fn get_all(pool: &SqlitePool) -> Result<Vec<TodoWithMeeting>, sqlx::Error> {
        sqlx::query_as::<_, TodoWithMeeting>(
            "SELECT t.id, t.meeting_id, COALESCE(m.title, '') AS meeting_title, t.date, \
             t.content_json, t.content_markdown, t.is_checked, t.sort_order, \
             t.source_text, t.created_at, t.updated_at \
             FROM todos t \
             LEFT JOIN meetings m ON t.meeting_id = m.id \
             ORDER BY t.date DESC, t.sort_order ASC, t.created_at ASC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn get_dates(pool: &SqlitePool) -> Result<Vec<TodoDateSummary>, sqlx::Error> {
        sqlx::query_as::<_, TodoDateSummary>(
            "SELECT date, COUNT(*) as count, \
             SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked \
             FROM todos \
             GROUP BY date \
             ORDER BY date DESC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn get_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<TodoModel>, sqlx::Error> {
        sqlx::query_as::<_, TodoModel>(
            "SELECT * FROM todos WHERE meeting_id = ? ORDER BY sort_order ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn get_today(pool: &SqlitePool) -> Result<Vec<TodoWithMeeting>, sqlx::Error> {
        sqlx::query_as::<_, TodoWithMeeting>(
            "SELECT t.id, t.meeting_id, COALESCE(m.title, '') AS meeting_title, t.date, \
             t.content_json, t.content_markdown, t.is_checked, t.sort_order, \
             t.source_text, t.created_at, t.updated_at \
             FROM todos t \
             LEFT JOIN meetings m ON t.meeting_id = m.id \
             WHERE t.date = date('now', 'localtime') \
             ORDER BY t.sort_order ASC, t.created_at ASC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        meeting_id: Option<&str>,
        date: &str,
        content_json: Option<&str>,
        content_markdown: Option<&str>,
        sort_order: i64,
        source_text: Option<&str>,
    ) -> Result<TodoModel, sqlx::Error> {
        let id = format!("todo-{}", Uuid::new_v4());
        let now = Utc::now().to_rfc3339();

        sqlx::query_as::<_, TodoModel>(
            "INSERT INTO todos (id, meeting_id, date, content_json, content_markdown, \
             is_checked, sort_order, source_text, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?) \
             RETURNING *",
        )
        .bind(&id)
        .bind(meeting_id)
        .bind(date)
        .bind(content_json)
        .bind(content_markdown)
        .bind(sort_order)
        .bind(source_text)
        .bind(&now)
        .bind(&now)
        .fetch_one(pool)
        .await
    }

    pub async fn update_content(
        pool: &SqlitePool,
        id: &str,
        content_json: Option<&str>,
        content_markdown: Option<&str>,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let rows = sqlx::query(
            "UPDATE todos SET content_json = ?, content_markdown = ?, updated_at = ? WHERE id = ?",
        )
        .bind(content_json)
        .bind(content_markdown)
        .bind(&now)
        .bind(id)
        .execute(pool)
        .await?
        .rows_affected();

        Ok(rows > 0)
    }

    pub async fn toggle(
        pool: &SqlitePool,
        id: &str,
        is_checked: bool,
    ) -> Result<bool, sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        let rows = sqlx::query("UPDATE todos SET is_checked = ?, updated_at = ? WHERE id = ?")
            .bind(is_checked)
            .bind(&now)
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected();

        Ok(rows > 0)
    }

    pub async fn delete(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
        let rows = sqlx::query("DELETE FROM todos WHERE id = ?")
            .bind(id)
            .execute(pool)
            .await?
            .rows_affected();

        Ok(rows > 0)
    }

    pub async fn reorder(
        pool: &SqlitePool,
        date: &str,
        todo_ids: &[String],
    ) -> Result<(), sqlx::Error> {
        let now = Utc::now().to_rfc3339();
        for (index, todo_id) in todo_ids.iter().enumerate() {
            sqlx::query(
                "UPDATE todos SET sort_order = ?, updated_at = ? WHERE id = ? AND date = ?",
            )
            .bind(index as i64)
            .bind(&now)
            .bind(todo_id)
            .bind(date)
            .execute(pool)
            .await?;
        }
        Ok(())
    }

    pub async fn batch_insert(
        pool: &SqlitePool,
        items: &[NewTodoItem],
    ) -> Result<usize, sqlx::Error> {
        let mut count = 0usize;
        for item in items {
            let id = format!("todo-{}", Uuid::new_v4());
            let now = Utc::now().to_rfc3339();
            let result = sqlx::query(
                "INSERT INTO todos (id, meeting_id, date, content_json, content_markdown, \
                 is_checked, sort_order, source_text, created_at, updated_at) \
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&item.meeting_id)
            .bind(&item.date)
            .bind(&item.content_json)
            .bind(&item.content_markdown)
            .bind(item.sort_order)
            .bind(&item.source_text)
            .bind(&now)
            .bind(&now)
            .execute(pool)
            .await;

            match result {
                Ok(_) => count += 1,
                Err(e) => {
                    error!("Failed to batch-insert todo: {}", e);
                }
            }
        }
        Ok(count)
    }

    pub async fn delete_extracted_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<u64, sqlx::Error> {
        let result =
            sqlx::query("DELETE FROM todos WHERE meeting_id = ? AND source_text IS NOT NULL")
                .bind(meeting_id)
                .execute(pool)
                .await?;

        Ok(result.rows_affected())
    }

    /// Get a single todo by ID
    pub async fn get_by_id(pool: &SqlitePool, id: &str) -> Result<Option<TodoModel>, sqlx::Error> {
        sqlx::query_as::<_, TodoModel>("SELECT * FROM todos WHERE id = ?")
            .bind(id)
            .fetch_optional(pool)
            .await
    }
}

pub struct NewTodoItem {
    pub meeting_id: Option<String>,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub sort_order: i64,
    pub source_text: Option<String>,
}
