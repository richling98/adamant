use log::{error as log_error, info as log_info};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};

use crate::database::repositories::todos::TodosRepository;
use crate::state::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct TodoResponse {
    pub id: String,
    pub meeting_id: Option<String>,
    pub meeting_title: String,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub is_checked: bool,
    pub sort_order: i64,
    pub source_text: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<crate::database::models::TodoWithMeeting> for TodoResponse {
    fn from(t: crate::database::models::TodoWithMeeting) -> Self {
        TodoResponse {
            id: t.id,
            meeting_id: t.meeting_id,
            meeting_title: t.meeting_title,
            date: t.date,
            content_json: t.content_json,
            content_markdown: t.content_markdown,
            is_checked: t.is_checked,
            sort_order: t.sort_order,
            source_text: t.source_text,
            created_at: t.created_at.0.to_rfc3339(),
            updated_at: t.updated_at.0.to_rfc3339(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodoDateSummaryResponse {
    pub date: String,
    pub count: i64,
    pub unchecked: i64,
}

impl From<crate::database::models::TodoDateSummary> for TodoDateSummaryResponse {
    fn from(s: crate::database::models::TodoDateSummary) -> Self {
        TodoDateSummaryResponse {
            date: s.date,
            count: s.count,
            unchecked: s.unchecked,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TodoModelResponse {
    pub id: String,
    pub meeting_id: Option<String>,
    pub date: String,
    pub content_json: Option<String>,
    pub content_markdown: Option<String>,
    pub is_checked: bool,
    pub sort_order: i64,
    pub source_text: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<crate::database::models::TodoModel> for TodoModelResponse {
    fn from(t: crate::database::models::TodoModel) -> Self {
        TodoModelResponse {
            id: t.id,
            meeting_id: t.meeting_id,
            date: t.date,
            content_json: t.content_json,
            content_markdown: t.content_markdown,
            is_checked: t.is_checked,
            sort_order: t.sort_order,
            source_text: t.source_text,
            created_at: t.created_at.0.to_rfc3339(),
            updated_at: t.updated_at.0.to_rfc3339(),
        }
    }
}

/// Get all todos for a specific date (YYYY-MM-DD), joined with meeting titles.
#[tauri::command]
pub async fn api_get_todos_by_date<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    date: String,
) -> Result<Vec<TodoResponse>, String> {
    log_info!("api_get_todos_by_date called for date: {}", date);
    let pool = state.db_manager.pool();

    TodosRepository::get_by_date(pool, &date)
        .await
        .map(|todos| todos.into_iter().map(TodoResponse::from).collect())
        .map_err(|e| {
            log_error!("Failed to get todos by date: {}", e);
            format!("Failed to get todos: {}", e)
        })
}

/// Get all todos, joined with meeting titles and ordered by date.
#[tauri::command]
pub async fn api_get_all_todos<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TodoResponse>, String> {
    log_info!("api_get_all_todos called");
    let pool = state.db_manager.pool();

    TodosRepository::get_all(pool)
        .await
        .map(|todos| todos.into_iter().map(TodoResponse::from).collect())
        .map_err(|e| {
            log_error!("Failed to get all todos: {}", e);
            format!("Failed to get all todos: {}", e)
        })
}

/// Get all dates that have todos, with counts (for sidebar grouping).
#[tauri::command]
pub async fn api_get_todo_dates<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TodoDateSummaryResponse>, String> {
    log_info!("api_get_todo_dates called");
    let pool = state.db_manager.pool();

    TodosRepository::get_dates(pool)
        .await
        .map(|dates| {
            dates
                .into_iter()
                .map(TodoDateSummaryResponse::from)
                .collect()
        })
        .map_err(|e| {
            log_error!("Failed to get todo dates: {}", e);
            format!("Failed to get todo dates: {}", e)
        })
}

/// Get today's todos, joined with meeting titles.
#[tauri::command]
pub async fn api_get_today_todos<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<TodoResponse>, String> {
    log_info!("api_get_today_todos called");
    let pool = state.db_manager.pool();

    TodosRepository::get_today(pool)
        .await
        .map(|todos| todos.into_iter().map(TodoResponse::from).collect())
        .map_err(|e| {
            log_error!("Failed to get today's todos: {}", e);
            format!("Failed to get today's todos: {}", e)
        })
}

/// Get all todos for a specific meeting.
#[tauri::command]
pub async fn api_get_meeting_todos<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Vec<TodoModelResponse>, String> {
    log_info!("api_get_meeting_todos called for meeting: {}", meeting_id);
    let pool = state.db_manager.pool();

    TodosRepository::get_by_meeting(pool, &meeting_id)
        .await
        .map(|todos| todos.into_iter().map(TodoModelResponse::from).collect())
        .map_err(|e| {
            log_error!("Failed to get meeting todos: {}", e);
            format!("Failed to get meeting todos: {}", e)
        })
}

/// Create a new todo manually.
#[tauri::command]
pub async fn api_create_todo<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: Option<String>,
    date: String,
    content_json: Option<String>,
    content_markdown: Option<String>,
) -> Result<TodoModelResponse, String> {
    log_info!("api_create_todo called for date: {}", date);
    let pool = state.db_manager.pool();

    // Determine sort_order: place at the end of the day's list
    let existing = TodosRepository::get_by_date(pool, &date)
        .await
        .map_err(|e| {
            log_error!("Failed to query existing todos: {}", e);
            format!("Failed to create todo: {}", e)
        })?;
    let sort_order = existing.iter().map(|t| t.sort_order).max().unwrap_or(-1) + 1;

    TodosRepository::create(
        pool,
        meeting_id.as_deref(),
        &date,
        content_json.as_deref(),
        content_markdown.as_deref(),
        sort_order,
        None,
    )
    .await
    .map(TodoModelResponse::from)
    .map_err(|e| {
        log_error!("Failed to create todo: {}", e);
        format!("Failed to create todo: {}", e)
    })
}

/// Update a todo's rich text content.
#[tauri::command]
pub async fn api_update_todo<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    todo_id: String,
    content_json: Option<String>,
    content_markdown: Option<String>,
) -> Result<(), String> {
    log_info!("api_update_todo called for id: {}", todo_id);
    let pool = state.db_manager.pool();

    TodosRepository::update_content(
        pool,
        &todo_id,
        content_json.as_deref(),
        content_markdown.as_deref(),
    )
    .await
    .map(|_| ())
    .map_err(|e| {
        log_error!("Failed to update todo: {}", e);
        format!("Failed to update todo: {}", e)
    })
}

/// Toggle a todo's checked/unchecked state.
#[tauri::command]
pub async fn api_toggle_todo<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    todo_id: String,
    is_checked: bool,
) -> Result<(), String> {
    log_info!(
        "api_toggle_todo called for id: {}, is_checked: {}",
        todo_id,
        is_checked
    );
    let pool = state.db_manager.pool();

    TodosRepository::toggle(pool, &todo_id, is_checked)
        .await
        .map(|_| ())
        .map_err(|e| {
            log_error!("Failed to toggle todo: {}", e);
            format!("Failed to toggle todo: {}", e)
        })
}

/// Delete a todo.
#[tauri::command]
pub async fn api_delete_todo<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    todo_id: String,
) -> Result<(), String> {
    log_info!("api_delete_todo called for id: {}", todo_id);
    let pool = state.db_manager.pool();

    TodosRepository::delete(pool, &todo_id)
        .await
        .map(|_| ())
        .map_err(|e| {
            log_error!("Failed to delete todo: {}", e);
            format!("Failed to delete todo: {}", e)
        })
}
