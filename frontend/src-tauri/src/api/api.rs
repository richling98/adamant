use log::{debug as log_debug, error as log_error, info as log_info, warn as log_warn};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_store::StoreExt;

use crate::{
    database::{
        models::MeetingModel,
        repositories::{
            folder::FoldersRepository,
            meeting::MeetingsRepository,
            setting::SettingsRepository,
            transcript::TranscriptsRepository,
        },
    },
    state::AppState,
    summary::CustomOpenAIConfig,
};

// Hardcoded server URL
const APP_SERVER_URL: &str = "http://localhost:5167";

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Meeting {
    pub id: String,
    pub title: String,
    /// ISO 8601 creation timestamp — used by the frontend "By Date" grouping view.
    pub created_at: String,
    /// FK into the folders table; None if the meeting is unfiled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_id: Option<String>,
}

/// A user-created sidebar folder returned to the frontend.
#[derive(Debug, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CreateFolderRequest {
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameFolderRequest {
    pub folder_id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MoveMeetingRequest {
    pub meeting_id: String,
    /// None = move meeting to root (unfiled)
    pub folder_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
}

/// A unified search result returned to the frontend.
///
/// Shape is a superset of the old transcript-only result so that existing
/// frontend code that reads `id`, `title`, `matchContext`, `timestamp`
/// continues to work while the new `matchSource` / `matchType` fields
/// power the source badge and semantic indicator.
#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSearchResult {
    pub id: String,
    pub title: String,
    /// HTML snippet for keyword hits (FTS5 `<b>…</b>` markup) or plain
    /// text excerpt for semantic hits.
    #[serde(rename = "matchContext")]
    pub match_context: String,
    /// ISO 8601 timestamp of the meeting (empty string for semantic-only hits
    /// where no specific segment is targeted — the frontend ignores it).
    pub timestamp: String,
    /// Which content field matched: "transcript" | "notes" | "summary" | "title"
    /// Used by the frontend to render a source badge.
    #[serde(rename = "matchSource")]
    pub match_source: Option<String>,
    /// "keyword" (FTS5) or "semantic" (cosine similarity).
    #[serde(rename = "matchType")]
    pub match_type: Option<String>,
    /// Normalised relevance score in [0.0, 1.0] (higher = better).
    pub score: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProfileRequest {
    pub email: String,
    pub license_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveProfileRequest {
    pub id: String,
    pub email: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UpdateProfileRequest {
    pub email: String,
    pub license_key: String,
    pub company: String,
    pub position: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "hasApiKey")]
    pub has_api_key: bool,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveModelConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "whisperModel")]
    pub whisper_model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "ollamaEndpoint")]
    pub ollama_endpoint: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GetApiKeyRequest {
    pub provider: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptConfig {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "hasApiKey")]
    pub has_api_key: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CustomOpenAIConfigResponse {
    pub endpoint: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
    #[serde(rename = "hasApiKey")]
    pub has_api_key: bool,
    #[serde(rename = "maxTokens")]
    pub max_tokens: Option<i32>,
    pub temperature: Option<f32>,
    #[serde(rename = "topP")]
    pub top_p: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTranscriptConfigRequest {
    pub provider: String,
    pub model: String,
    #[serde(rename = "apiKey")]
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeleteMeetingRequest {
    pub meeting_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingDetails {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub transcripts: Vec<MeetingTranscript>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingTranscript {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    // Recording-relative timestamps for audio-transcript synchronization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

/// Meeting metadata without transcripts (for pagination)
#[derive(Debug, Serialize, Deserialize)]
pub struct MeetingMetadata {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub folder_path: Option<String>,
}

/// Paginated transcripts response with total count
#[derive(Debug, Serialize, Deserialize)]
pub struct PaginatedTranscriptsResponse {
    pub transcripts: Vec<MeetingTranscript>,
    pub total_count: i64,
    pub has_more: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveMeetingTitleRequest {
    pub meeting_id: String,
    pub title: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveMeetingSummaryRequest {
    pub meeting_id: String,
    pub summary: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SaveTranscriptRequest {
    pub meeting_title: String,
    pub transcripts: Vec<TranscriptSegment>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TranscriptSegment {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    // NEW: Recording-relative timestamps for playback synchronization
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_start_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audio_end_time: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: Option<String>,
    pub email: String,
    pub license_key: String,
    pub company: Option<String>,
    pub position: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_licensed: bool,
}

// Helper function to get auth token from store (optional)
#[allow(dead_code)]
async fn get_auth_token<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let store = match app.store("store.json") {
        Ok(store) => store,
        Err(_) => return None,
    };

    match store.get("authToken") {
        Some(token) => {
            if let Some(token_str) = token.as_str() {
                let truncated = token_str.chars().take(20).collect::<String>();
                log_info!("Found auth token: {}", truncated);
                Some(token_str.to_string())
            } else {
                log_warn!("Auth token is not a string");
                None
            }
        }
        None => {
            log_warn!("No auth token found in store");
            None
        }
    }
}

// Helper function to get server address - now hardcoded
async fn get_server_address<R: Runtime>(_app: &AppHandle<R>) -> Result<String, String> {
    log_info!("Using hardcoded server URL: {}", APP_SERVER_URL);
    Ok(APP_SERVER_URL.to_string())
}

// Generic API call function with optional authentication
async fn make_api_request<R: Runtime, T: for<'de> Deserialize<'de>>(
    app: &AppHandle<R>,
    endpoint: &str,
    method: &str,
    body: Option<&str>,
    additional_headers: Option<HashMap<String, String>>,
    auth_token: Option<String>, // Pass auth token from frontend
) -> Result<T, String> {
    let client = reqwest::Client::new();
    let server_url = get_server_address(app).await?;

    let url = format!("{}{}", server_url, endpoint);
    log_info!("Making {} request to: {}", method, url);

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    // Add authorization header if auth token is provided
    if let Some(token) = auth_token {
        log_info!("Adding authorization header");
        request = request.header("Authorization", format!("Bearer {}", token));
    } else {
        log_warn!("No auth token provided, making unauthenticated request");
    }

    request = request.header("Content-Type", "application/json");

    // Add additional headers if provided
    if let Some(headers) = additional_headers {
        for (key, value) in headers {
            request = request.header(&key, &value);
        }
    }

    // Add body if provided
    if let Some(body_str) = body {
        request = request.body(body_str.to_string());
    }

    let response = request.send().await.map_err(|e| {
        let error_msg = format!("Request failed: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })?;

    let status = response.status();
    log_info!("Response status: {}", status);

    if !status.is_success() {
        let error_text = response
            .text()
            .await
            .unwrap_or_else(|_| "Unknown error".to_string());
        let error_msg = format!("HTTP {}: {}", status, error_text);
        log_error!("{}", error_msg);
        return Err(error_msg);
    }

    let response_text = response.text().await.map_err(|e| {
        let error_msg = format!("Failed to read response: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })?;

    // Safely truncate response for logging, respecting UTF-8 character boundaries
    let truncated = response_text.chars().take(200).collect::<String>();
    log_info!("Response body: {}", truncated);

    serde_json::from_str(&response_text).map_err(|e| {
        let error_msg = format!("Failed to parse JSON: {}", e);
        log_error!("{}", error_msg);
        error_msg
    })
}

// API Commands for Tauri

#[tauri::command]
pub async fn api_get_meetings<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<Vec<Meeting>, String> {
    log_info!(
        "api_get_meetings called with auth_token(native) : {}",
        auth_token.is_some()
    );
    let pool = state.db_manager.pool();
    let meetings: Result<Vec<MeetingModel>, sqlx::Error> =
        MeetingsRepository::get_meetings(pool).await;

    match meetings {
        Ok(meeting_models) => {
            log_info!("Successfully got {} meetings", meeting_models.len());

            let result: Vec<Meeting> = meeting_models
                .into_iter()
                .map(|m| Meeting {
                    id: m.id,
                    title: m.title,
                    // Serialize as RFC3339 string; frontend parses with new Date()
                    created_at: m.created_at.0.to_rfc3339(),
                    folder_id: m.folder_id,
                })
                .collect();
            Ok(result)
        }
        Err(e) => {
            log_error!("Error getting meetings: {}", e);
            Err(e.to_string())
        }
    }
}

/// Keyword search across all meeting content: title, transcript, notes, and AI summary.
///
/// Uses FTS5 with OR logic — each space-separated word is a separate search term.
/// A meeting appears in results if it contains ANY of the typed words.
/// BM25 scoring naturally ranks meetings that match more words higher.
///
/// Returns up to 20 results sorted by relevance score descending.
#[tauri::command]
pub async fn api_search_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    query: String,
    auth_token: Option<String>,
) -> Result<Vec<TranscriptSearchResult>, String> {
    log_info!(
        "api_search_transcripts called with query: '{}', auth_token: {}",
        query,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();

    // search_fts() handles the empty/short-query guard internally.
    let fts_results = match crate::search::fts::search_fts(pool, &query).await {
        Ok(r) => r,
        Err(e) => {
            log_error!("FTS search error for query '{}': {}", query, e);
            vec![]
        }
    };

    // Map FTS hits directly to the result type — no merging needed (single source).
    let mut results: Vec<TranscriptSearchResult> = fts_results
        .into_iter()
        .map(|hit| TranscriptSearchResult {
            id: hit.meeting_id,
            title: hit.title,
            match_context: hit.context,
            timestamp: String::new(),
            match_source: Some(hit.match_source),
            match_type: Some("keyword".to_string()),
            score: Some(hit.score),
        })
        .collect();

    // Sort by score descending (higher = better match).
    results.sort_by(|a, b| {
        b.score
            .unwrap_or(0.0)
            .partial_cmp(&a.score.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    log_info!("Search completed: {} results for query '{}'", results.len(), query);
    Ok(results)
}

#[tauri::command]
pub async fn api_get_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    auth_token: Option<String>,
) -> Result<Profile, String> {
    log_info!(
        "api_get_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let profile_request = ProfileRequest { email, license_key };
    let body = serde_json::to_string(&profile_request).map_err(|e| e.to_string())?;

    make_api_request::<R, Profile>(&app, "/get-profile", "POST", Some(&body), None, auth_token)
        .await
}

#[tauri::command]
pub async fn api_save_profile<R: Runtime>(
    app: AppHandle<R>,
    id: String,
    email: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let save_request = SaveProfileRequest { id, email };
    let body = serde_json::to_string(&save_request).map_err(|e| e.to_string())?;

    make_api_request::<R, serde_json::Value>(
        &app,
        "/save-profile",
        "POST",
        Some(&body),
        None,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_update_profile<R: Runtime>(
    app: AppHandle<R>,
    email: String,
    license_key: String,
    company: String,
    position: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_update_profile called for email: {}, auth_token: {}",
        email,
        auth_token.is_some()
    );

    let update_request = UpdateProfileRequest {
        email,
        license_key,
        company,
        position,
    };
    let body = serde_json::to_string(&update_request).map_err(|e| e.to_string())?;

    make_api_request::<R, serde_json::Value>(
        &app,
        "/update-profile",
        "POST",
        Some(&body),
        None,
        auth_token,
    )
    .await
}

#[tauri::command]
pub async fn api_get_model_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    _auth_token: Option<String>,
) -> Result<Option<ModelConfig>, String> {
    log_info!("api_get_model_config called (native)");
    let pool = state.db_manager.pool();

    match SettingsRepository::get_model_config(pool).await {
        Ok(Some(config)) => {
            log_info!(
                "✅ Found model config in database: provider={}, model={}, whisperModel={}, ollamaEndpoint={:?}",
                &config.provider,
                &config.model,
                &config.whisper_model,
                &config.ollama_endpoint
            );
            match SettingsRepository::has_api_key(pool, &config.provider).await {
                Ok(has_api_key) => {
                    log_info!("Successfully retrieved model config and API key.");
                    Ok(Some(ModelConfig {
                        provider: config.provider,
                        model: config.model,
                        whisper_model: config.whisper_model,
                        api_key: None,
                        has_api_key,
                        ollama_endpoint: config.ollama_endpoint,
                    }))
                }
                Err(e) => {
                    log_error!(
                        "Failed to get API key for provider {}: {}",
                        &config.provider,
                        e
                    );
                    Err(e.to_string())
                }
            }
        }
        Ok(None) => {
            log_warn!("⚠️ No model config found in database - database may be empty or settings table not initialized");
            Ok(None)
        }
        Err(e) => {
            log_error!("❌ Failed to get model config from database: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_has_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<bool, String> {
    SettingsRepository::has_api_key(&state.db_manager.pool(), &provider)
        .await
        .map_err(|e| format!("Failed to check key presence for {}: {}", provider, e))
}

#[tauri::command]
pub async fn api_test_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<bool, String> {
    let pool = state.db_manager.pool();

    if !SettingsRepository::has_api_key(pool, &provider)
        .await
        .map_err(|e| format!("Failed to check key presence for {}: {}", provider, e))?
    {
        return Ok(false);
    }

    let key = SettingsRepository::get_api_key(pool, &provider)
        .await
        .map_err(|e| format!("Failed to load stored key for {}: {}", provider, e))?
        .unwrap_or_default();

    if key.trim().is_empty() {
        return Ok(false);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to create test client: {}", e))?;

    let response = match provider.as_str() {
        "openai" => client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(&key)
            .send()
            .await,
        "groq" => client
            .get("https://api.groq.com/openai/v1/models")
            .bearer_auth(&key)
            .send()
            .await,
        "openrouter" => client
            .get("https://openrouter.ai/api/v1/models")
            .bearer_auth(&key)
            .send()
            .await,
        "claude" => client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", &key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await,
        "ollama" | "builtin-ai" => return Ok(true),
        other => {
            return Err(format!(
                "Provider '{}' does not support api_test_key yet",
                other
            ))
        }
    }
    .map_err(|e| format!("Key probe failed for {}: {}", provider, e))?;

    Ok(response.status().is_success())
}

#[tauri::command]
pub async fn api_save_model_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    whisper_model: String,
    api_key: Option<String>,
    ollama_endpoint: Option<String>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "💾 api_save_model_config called (native): provider='{}', model='{}', whisperModel='{}', ollamaEndpoint={:?}",
        &provider,
        &model,
        &whisper_model,
        &ollama_endpoint
    );
    let pool = state.db_manager.pool();

    if let Err(e) = SettingsRepository::save_model_config(
        pool,
        &provider,
        &model,
        &whisper_model,
        ollama_endpoint.as_deref(),
    )
    .await
    {
        log_error!("❌ Failed to save model config to database: {}", e);
        return Err(e.to_string());
    }

    // Skip API key saving for custom-openai provider (it uses customOpenAIConfig JSON instead)
    if let Some(key) = api_key {
        if !key.is_empty() && provider != "custom-openai" {
            log_info!("🔑 API key provided, saving...");
            if let Err(e) = SettingsRepository::save_api_key(pool, &provider, &key).await {
                log_error!("❌ Failed to save API key: {}", e);
                return Err(e.to_string());
            }
        }
    }

    // Trigger graceful shutdown of built-in AI sidecar if it's running
    // This ensures that if the user switched models/providers, the old one is cleaned up
    // The shutdown happens in the background, so it won't block the UI
    if let Err(e) = crate::summary::summary_engine::client::shutdown_sidecar_gracefully().await {
        log_warn!("Failed to initiate graceful sidecar shutdown: {}", e);
    }

    log_info!("✅ Successfully saved model configuration to database");
    Ok(
        serde_json::json!({ "status": "success", "message": "Model configuration saved successfully" }),
    )
}

#[tauri::command]
#[allow(deprecated)]
#[deprecated(note = "Use api_has_key for UI presence checks instead of loading raw secrets")]
pub async fn api_get_api_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<String, String> {
    log_warn!(
        "Deprecated command api_get_api_key invoked for provider '{}'",
        &provider
    );
    log_info!(
        "api_get_api_key called (native) for provider '{}'",
        &provider
    );
    match SettingsRepository::get_api_key(&state.db_manager.pool(), &provider).await {
        Ok(key) => {
            log_info!(
                "Successfully retrieved API key for provider '{}'.",
                &provider
            );
            Ok(key.unwrap_or_default())
        }
        Err(e) => {
            log_error!("Failed to get API key for provider '{}': {}", &provider, e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_get_transcript_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    _auth_token: Option<String>,
) -> Result<Option<TranscriptConfig>, String> {
    log_info!("api_get_transcript_config called (native)");
    let pool = state.db_manager.pool();

    match SettingsRepository::get_transcript_config(pool).await {
        Ok(Some(config)) => {
            log_info!(
                "Found transcript config: provider={}, model={}",
                &config.provider,
                &config.model
            );
            match SettingsRepository::has_transcript_api_key(pool, &config.provider).await {
                Ok(has_api_key) => {
                    log_info!("Successfully retrieved transcript config and API key.");
                    Ok(Some(TranscriptConfig {
                        provider: config.provider,
                        model: config.model,
                        api_key: None,
                        has_api_key,
                    }))
                }
                Err(e) => {
                    log_error!(
                        "Failed to get transcript API key for provider {}: {}",
                        &config.provider,
                        e
                    );
                    Err(e.to_string())
                }
            }
        }
        Ok(None) => {
            log_info!("No transcript config found, returning default.");
            Ok(Some(TranscriptConfig {
                provider: "parakeet".to_string(),
                model: "parakeet-tdt-0.6b-v3-int8".to_string(),
                api_key: None,
                has_api_key: true,
            }))
        }
        Err(e) => {
            log_error!("Failed to get transcript config: {}", e);
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_save_transcript_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    model: String,
    api_key: Option<String>,
    _auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript_config called (native) for provider '{}'",
        &provider
    );
    let pool = state.db_manager.pool();

    if let Err(e) = SettingsRepository::save_transcript_config(pool, &provider, &model).await {
        log_error!("Failed to save transcript config: {}", e);
        return Err(e.to_string());
    }

    if let Some(key) = api_key {
        if !key.is_empty() {
            log_info!("API key provided, saving for transcript provider...");
            if let Err(e) = SettingsRepository::save_transcript_api_key(pool, &provider, &key).await
            {
                log_error!("Failed to save transcript API key: {}", e);
                return Err(e.to_string());
            }
        }
    }

    log_info!("Successfully saved transcript configuration.");
    Ok(
        serde_json::json!({ "status": "success", "message": "Transcript configuration saved successfully" }),
    )
}

#[tauri::command]
pub async fn api_has_transcript_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<bool, String> {
    SettingsRepository::has_transcript_api_key(&state.db_manager.pool(), &provider)
        .await
        .map_err(|e| format!("Failed to check transcript key presence for {}: {}", provider, e))
}

#[tauri::command]
#[allow(deprecated)]
#[deprecated(
    note = "Use api_has_transcript_key for UI presence checks instead of loading raw secrets"
)]
pub async fn api_get_transcript_api_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<String, String> {
    log_warn!(
        "Deprecated command api_get_transcript_api_key invoked for provider '{}'",
        &provider
    );
    log_info!(
        "api_get_transcript_api_key called (native) for provider '{}'",
        &provider
    );
    match SettingsRepository::get_transcript_api_key(&state.db_manager.pool(), &provider).await {
        Ok(key) => {
            log_info!(
                "Successfully retrieved transcript API key for provider '{}'.",
                &provider
            );
            Ok(key.unwrap_or_default())
        }
        Err(e) => {
            log_error!(
                "Failed to get transcript API key for provider '{}': {}",
                &provider,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_delete_api_key<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    provider: String,
    _auth_token: Option<String>,
) -> Result<(), String> {
    log_info!(
        "log_api_delete_api_key called (native) for provider '{}'",
        &provider
    );
    match SettingsRepository::delete_api_key(&state.db_manager.pool(), &provider).await {
        Ok(_) => {
            log_info!("Successfully deleted API key for provider '{}'.", &provider);
            Ok(())
        }
        Err(e) => {
            log_error!(
                "Failed to delete API key for provider '{}': {}",
                &provider,
                e
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn api_delete_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_delete_meeting called for meeting_id(native): {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();

    match MeetingsRepository::delete_meeting(pool, &meeting_id).await {
        Ok(true) => {
            log_info!("Successfully deleted meeting {}", meeting_id);
            Ok(serde_json::json!({
                "status": "success",
                "message": "Meeting deleted successfully"
            }))
        }
        Ok(false) => {
            log_warn!("Meeting not found or already deleted: {}", meeting_id);
            Err(format!(
                "Meeting not found or could not be deleted: {}",
                meeting_id
            ))
        }
        Err(e) => {
            log_error!("Error deleting meeting {}: {}", meeting_id, e);
            Err(format!("Failed to delete meeting: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_get_meeting<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
    auth_token: Option<String>,
) -> Result<MeetingDetails, String> {
    log_info!(
        "api_get_meeting called(native) for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );

    let pool = state.db_manager.pool();

    match MeetingsRepository::get_meeting(pool, &meeting_id).await {
        Ok(Some(meeting)) => {
            log_info!("Successfully retrieved meeting {}", meeting_id);
            Ok(meeting)
        }
        Ok(None) => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Error retrieving meeting {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve meeting: {}", e))
        }
    }
}

/// Get meeting metadata without transcripts (for pagination)
#[tauri::command]
pub async fn api_get_meeting_metadata<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    state: tauri::State<'_, AppState>,
) -> Result<MeetingMetadata, String> {
    log_info!("api_get_meeting_metadata called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();

    match MeetingsRepository::get_meeting_metadata(pool, &meeting_id).await {
        Ok(Some(meeting)) => {
            log_info!("Successfully retrieved meeting metadata {}", meeting_id);
            Ok(MeetingMetadata {
                id: meeting.id,
                title: meeting.title,
                created_at: meeting.created_at.0.to_rfc3339(),
                updated_at: meeting.updated_at.0.to_rfc3339(),
                folder_path: meeting.folder_path,
            })
        }
        Ok(None) => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err(format!("Meeting not found: {}", meeting_id))
        }
        Err(e) => {
            log_error!("Error retrieving meeting metadata {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve meeting metadata: {}", e))
        }
    }
}

/// Get paginated transcripts for a meeting
#[tauri::command]
pub async fn api_get_meeting_transcripts<R: Runtime>(
    _app: AppHandle<R>,
    meeting_id: String,
    limit: i64,
    offset: i64,
    state: tauri::State<'_, AppState>,
) -> Result<PaginatedTranscriptsResponse, String> {
    log_info!(
        "api_get_meeting_transcripts called for meeting_id: {}, limit: {}, offset: {}",
        meeting_id,
        limit,
        offset
    );

    let pool = state.db_manager.pool();

    match MeetingsRepository::get_meeting_transcripts_paginated(pool, &meeting_id, limit, offset).await {
        Ok((transcripts, total_count)) => {
            log_info!(
                "Successfully retrieved {} transcripts for meeting {} (total: {})",
                transcripts.len(),
                meeting_id,
                total_count
            );

            // Convert Transcript to MeetingTranscript
            let meeting_transcripts = transcripts
                .into_iter()
                .map(|t| MeetingTranscript {
                    id: t.id,
                    text: t.transcript,
                    timestamp: t.timestamp,
                    audio_start_time: t.audio_start_time,
                    audio_end_time: t.audio_end_time,
                    duration: t.duration,
                })
                .collect::<Vec<_>>();

            let has_more = (offset + meeting_transcripts.len() as i64) < total_count;

            Ok(PaginatedTranscriptsResponse {
                transcripts: meeting_transcripts,
                total_count,
                has_more,
            })
        }
        Err(e) => {
            log_error!("Error retrieving transcripts for meeting {}: {}", meeting_id, e);
            Err(format!("Failed to retrieve transcripts: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_save_meeting_title<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    title: String,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_meeting_title called for meeting_id: {}, auth_token: {}",
        meeting_id,
        auth_token.is_some()
    );
    let pool = state.db_manager.pool();
    match MeetingsRepository::update_meeting_title(pool, &meeting_id, &title).await {
        Ok(true) => {
            log_info!("Successfully saved meeting title");
            Ok(serde_json::json!({"message": "Meeting title saved successfully"}))
        }
        Ok(false) => {
            log_error!("No meeting found with id {}", meeting_id);
            Err(format!("No meeting found with id {}", meeting_id))
        }
        Err(e) => {
            log_error!("Failed to update meeting {}", e);
            Err(format!("Failed to update meeting: {}", e))
        }
    }
}

#[tauri::command]
pub async fn api_save_transcript<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_title: String,
    transcripts: Vec<serde_json::Value>,
    folder_path: Option<String>,
    // When set, transcripts are attached to this existing meeting instead of creating a new one.
    // Used when recording is started from the meeting-details/notes page.
    existing_meeting_id: Option<String>,
    auth_token: Option<String>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_transcript called for meeting: {}, transcripts: {}, folder_path: {:?}, existing_meeting_id: {:?}, auth_token: {}",
        meeting_title,
        transcripts.len(),
        folder_path,
        existing_meeting_id,
        auth_token.is_some()
    );

    // Log first transcript for debugging
    if let Some(first) = transcripts.first() {
        log_debug!(
            "First transcript data: {}",
            serde_json::to_string_pretty(first).unwrap_or_default()
        );
    }

    // Convert serde_json::Value to TranscriptSegment
    let transcripts_to_save: Vec<TranscriptSegment> = transcripts
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            log_error!("Failed to parse transcript segments: {}", e);
            format!("Invalid transcript data format: {}. Please check the data structure.", e)
        })?;

    // Log parsed segments count and first segment metadata
    if let Some(first_seg) = transcripts_to_save.first() {
        log_debug!(
            "First parsed segment: {} chars, audio_start_time={:?}, audio_end_time={:?}, duration={:?}",
            first_seg.text.len(),
            first_seg.audio_start_time,
            first_seg.audio_end_time,
            first_seg.duration
        );
    }

    let pool = state.db_manager.pool();

    // Now, call the repository with the correctly typed data.
    match TranscriptsRepository::save_transcript(
        pool,
        &meeting_title,
        &transcripts_to_save,
        folder_path,
        existing_meeting_id,
    )
    .await
    {
        Ok(meeting_id) => {
            log_info!(
                "Successfully saved transcript and created meeting with id: {}",
                meeting_id
            );

            // Refresh FTS index once the full recording session is finalized.
            // Called here (not per-chunk) to avoid O(n²) GROUP_CONCAT cost on
            // long recordings.  A non-fatal error is logged but does not fail
            // the transcript save.
            if let Err(e) = crate::search::fts::refresh_meeting_fts(pool, &meeting_id).await {
                log_warn!("FTS refresh failed for meeting {} (search may be stale): {}", meeting_id, e);
            }

            Ok(serde_json::json!({
                "status": "success",
                "message": "Transcript saved successfully",
                "meeting_id": meeting_id
            }))
        }
        Err(e) => {
            log_error!(
                "Error saving transcript for meeting '{}': {}",
                meeting_title,
                e
            );
            Err(format!("Failed to save transcript: {}", e))
        }
    }
}

/// Opens the meeting's recording folder in the system file explorer
#[tauri::command]
pub async fn open_meeting_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<(), String> {
    log_info!("open_meeting_folder called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();

    // Get meeting with folder_path
    let meeting: Option<MeetingModel> = sqlx::query_as(
        "SELECT id, title, created_at, updated_at, folder_path, folder_id FROM meetings WHERE id = ?",
    )
    .bind(&meeting_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Database error: {}", e))?;

    match meeting {
        Some(m) => {
            if let Some(folder_path) = m.folder_path {
                log_info!("Opening meeting folder: {}", folder_path);

                // Verify folder exists
                let path = std::path::Path::new(&folder_path);
                if !path.exists() {
                    log_warn!("Folder path does not exist: {}", folder_path);
                    return Err(format!("Recording folder not found: {}", folder_path));
                }

                // Open folder based on OS
                #[cfg(target_os = "macos")]
                {
                    std::process::Command::new("open")
                        .arg(&folder_path)
                        .spawn()
                        .map_err(|e| format!("Failed to open folder: {}", e))?;
                }

                #[cfg(target_os = "windows")]
                {
                    std::process::Command::new("explorer")
                        .arg(&folder_path)
                        .spawn()
                        .map_err(|e| format!("Failed to open folder: {}", e))?;
                }

                #[cfg(target_os = "linux")]
                {
                    std::process::Command::new("xdg-open")
                        .arg(&folder_path)
                        .spawn()
                        .map_err(|e| format!("Failed to open folder: {}", e))?;
                }

                log_info!("Successfully opened folder: {}", folder_path);
                Ok(())
            } else {
                log_warn!("Meeting {} has no folder_path set", meeting_id);
                Err("Recording folder path not available for this meeting".to_string())
            }
        }
        None => {
            log_warn!("Meeting not found: {}", meeting_id);
            Err("Meeting not found".to_string())
        }
    }
}

// Simple test command to check backend connectivity
#[tauri::command]
pub async fn test_backend_connection<R: Runtime>(
    app: AppHandle<R>,
    auth_token: Option<String>,
) -> Result<String, String> {
    log_debug!("Testing backend connection...");

    let client = reqwest::Client::new();
    let server_url = get_server_address(&app).await?;

    log_debug!("Testing connection to: {}", server_url);

    let mut request = client.get(&format!("{}/docs", server_url));

    if let Some(token) = auth_token {
        request = request.header("Authorization", format!("Bearer {}", token));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            log_debug!("Backend responded with status: {}", status);
            Ok(format!("Backend is reachable. Status: {}", status))
        }
        Err(e) => {
            let error_msg = format!("Failed to connect to backend: {}", e);
            log_debug!("{}", error_msg);
            Err(error_msg)
        }
    }
}

#[tauri::command]
pub async fn debug_backend_connection<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    log_debug!("=== DEBUG: Testing backend connection ===");

    // Test 1: Check server address from store
    let server_url = match get_server_address(&app).await {
        Ok(url) => {
            log_debug!("✓ Server URL from store: {}", url);
            url
        }
        Err(e) => {
            log_error!("✗ Failed to get server URL: {}", e);
            return Err(format!("Failed to get server URL: {}", e));
        }
    };

    // Test 2: Make a simple HTTP request to the backend
    let client = reqwest::Client::new();
    let test_url = format!("{}/docs", server_url); // Try the docs endpoint which should be public

    log_debug!("Testing connection to: {}", test_url);

    match client.get(&test_url).send().await {
        Ok(response) => {
            let status = response.status();
            log_debug!("✓ Backend responded with status: {}", status);
            Ok(format!(
                "Backend connection successful! Status: {}, URL: {}",
                status, server_url
            ))
        }
        Err(e) => {
            log_error!("✗ Backend connection failed: {}", e);
            Err(format!("Backend connection failed: {}", e))
        }
    }
}

#[tauri::command]
pub async fn open_external_url(url: String) -> Result<(), String> {
    use std::process::Command;

    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(&["/C", "start", &url]).output()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).output()
    } else {
        // Linux and other Unix-like systems
        Command::new("xdg-open").arg(&url).output()
    };

    match result {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Failed to open URL: {}", e)),
    }
}

// ===== CUSTOM OPENAI API COMMANDS =====

/// Saves the custom OpenAI configuration
/// This configuration is stored as JSON and includes endpoint, apiKey, model, and optional parameters
#[tauri::command]
pub async fn api_save_custom_openai_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
    max_tokens: Option<i32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_save_custom_openai_config called: endpoint='{}', model='{}'",
        &endpoint,
        &model
    );

    // Validate required fields
    if endpoint.trim().is_empty() {
        return Err("Endpoint URL is required".to_string());
    }
    if model.trim().is_empty() {
        return Err("Model name is required".to_string());
    }

    // Validate endpoint URL format
    if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
        return Err("Endpoint must start with http:// or https://".to_string());
    }

    // Validate optional numeric parameters
    if let Some(temp) = temperature {
        if !(0.0..=2.0).contains(&temp) {
            return Err("Temperature must be between 0.0 and 2.0".to_string());
        }
    }
    if let Some(top) = top_p {
        if !(0.0..=1.0).contains(&top) {
            return Err("Top P must be between 0.0 and 1.0".to_string());
        }
    }
    if let Some(tokens) = max_tokens {
        if tokens < 1 {
            return Err("Max tokens must be at least 1".to_string());
        }
    }

    let pool = state.db_manager.pool();
    let existing_config = SettingsRepository::get_custom_openai_config(pool)
        .await
        .map_err(|e| format!("Failed to load existing custom OpenAI configuration: {}", e))?;

    let config = CustomOpenAIConfig {
        endpoint: endpoint.trim().to_string(),
        api_key: api_key
            .filter(|k| !k.trim().is_empty())
            .or_else(|| existing_config.and_then(|config| config.api_key)),
        model: model.trim().to_string(),
        max_tokens,
        temperature,
        top_p,
    };

    match SettingsRepository::save_custom_openai_config(pool, &config).await {
        Ok(()) => {
            log_info!("✅ Successfully saved custom OpenAI config for endpoint: {}", config.endpoint);
            Ok(serde_json::json!({
                "status": "success",
                "message": "Custom OpenAI configuration saved successfully"
            }))
        }
        Err(e) => {
            log_error!("❌ Failed to save custom OpenAI config: {}", e);
            Err(format!("Failed to save custom OpenAI configuration: {}", e))
        }
    }
}

/// Gets the custom OpenAI configuration
#[tauri::command]
pub async fn api_get_custom_openai_config<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Option<CustomOpenAIConfigResponse>, String> {
    log_info!("api_get_custom_openai_config called");

    let pool = state.db_manager.pool();

    match SettingsRepository::get_custom_openai_config(pool).await {
        Ok(config) => {
            if let Some(ref c) = config {
                log_info!("✅ Found custom OpenAI config: endpoint='{}', model='{}'",
                    c.endpoint, c.model);
            } else {
                log_info!("No custom OpenAI config found");
            }
            Ok(config.map(|config| CustomOpenAIConfigResponse {
                endpoint: config.endpoint,
                model: config.model,
                api_key: None,
                has_api_key: config
                    .api_key
                    .map(|key| !key.trim().is_empty())
                    .unwrap_or(false),
                max_tokens: config.max_tokens,
                temperature: config.temperature,
                top_p: config.top_p,
            }))
        }
        Err(e) => {
            log_error!("❌ Failed to get custom OpenAI config: {}", e);
            Err(format!("Failed to get custom OpenAI configuration: {}", e))
        }
    }
}

/// Tests the connection to a custom OpenAI-compatible endpoint
/// Makes a minimal request to verify the endpoint is reachable and responds correctly
#[tauri::command]
pub async fn api_test_custom_openai_connection<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    endpoint: String,
    api_key: Option<String>,
    model: String,
) -> Result<serde_json::Value, String> {
    log_info!(
        "api_test_custom_openai_connection called: endpoint='{}', model='{}'",
        &endpoint,
        &model
    );

    // Validate endpoint URL format
    if !endpoint.starts_with("http://") && !endpoint.starts_with("https://") {
        return Err("Endpoint must start with http:// or https://".to_string());
    }

    let stored_api_key = SettingsRepository::get_custom_openai_config(state.db_manager.pool())
        .await
        .map_err(|e| format!("Failed to load stored custom OpenAI configuration: {}", e))?
        .and_then(|config| config.api_key);
    let effective_api_key = api_key
        .filter(|key| !key.trim().is_empty())
        .or(stored_api_key);

    // Build the URL - append /chat/completions to the base endpoint
    let url = format!("{}/chat/completions", endpoint.trim_end_matches('/'));

    // Create a minimal test request
    let test_request = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Hi"
            }
        ],
        "max_tokens": 5
    });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&test_request);

    // Add authorization if API key provided
    if let Some(key) = effective_api_key {
        request = request.header("Authorization", format!("Bearer {}", key));
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status();
            let response_text = response.text().await.unwrap_or_default();

            if status.is_success() {
                // Parse response as JSON to verify it's a valid OpenAI-compatible response
                match serde_json::from_str::<serde_json::Value>(&response_text) {
                    Ok(json) => {
                        // Verify the response has the expected OpenAI structure
                        if let Some(choices) = json.get("choices") {
                            if let Some(choices_array) = choices.as_array() {
                                if !choices_array.is_empty() {
                                    // Verify the first choice has the required message structure
                                    if let Some(first_choice) = choices_array.get(0) {
                                        // Check if message.content field exists (can be empty string)
                                        let has_message_structure = first_choice
                                            .get("message")
                                            .and_then(|m| m.get("content"))
                                            .is_some();

                                        if has_message_structure {
                                            log_info!("✅ Custom OpenAI connection test successful - response validated");
                                            return Ok(serde_json::json!({
                                                "status": "success",
                                                "message": "Connection successful and response validated",
                                                "http_status": status.as_u16()
                                            }));
                                        }
                                    }
                                }
                            }
                        }

                        // Response was 200 but doesn't match OpenAI format
                        log_warn!(
                            "⚠️ Endpoint returned 200 but response doesn't match OpenAI format ({} chars)",
                            response_text.len()
                        );
                        Err("Endpoint is reachable but doesn't appear to be OpenAI-compatible. Response is missing 'choices' array or 'message.content' field.".to_string())
                    }
                    Err(e) => {
                        log_warn!("⚠️ Endpoint returned 200 but response is not valid JSON: {}", e);
                        Err(format!(
                            "Endpoint is reachable but returned invalid JSON: {}. Response length: {} chars",
                            e,
                            response_text.len()
                        ))
                    }
                }
            } else {
                log_warn!(
                    "⚠️ Custom OpenAI connection test failed with status {} ({} chars)",
                    status,
                    response_text.len()
                );
                Err(format!(
                    "Connection failed with status {}. Response length: {} chars",
                    status,
                    response_text.len()
                ))
            }
        }
        Err(e) => {
            log_error!("❌ Custom OpenAI connection test failed: {}", e);
            if e.is_timeout() {
                Err("Connection timed out. Please check the endpoint URL.".to_string())
            } else if e.is_connect() {
                Err("Could not connect to endpoint. Please verify the URL is correct and the server is running.".to_string())
            } else {
                Err(format!("Connection failed: {}", e))
            }
        }
    }
}

// ===== Note Management Commands =====

fn inline_content_has_text(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(text) => !text.trim().is_empty(),
        serde_json::Value::Array(items) => items.iter().any(inline_content_has_text),
        serde_json::Value::Object(map) => map
            .get("text")
            .and_then(|text| text.as_str())
            .map(|text| !text.trim().is_empty())
            .unwrap_or(false),
        _ => false,
    }
}

fn blocknote_value_has_text(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Array(items) => items.iter().any(blocknote_value_has_text),
        serde_json::Value::Object(map) => {
            map.get("content").map(inline_content_has_text).unwrap_or(false)
                || map
                    .get("children")
                    .map(blocknote_value_has_text)
                    .unwrap_or(false)
        }
        _ => false,
    }
}

fn blocknote_json_has_text(raw_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw_json)
        .map(|value| blocknote_value_has_text(&value))
        .unwrap_or(false)
}

fn note_payload_has_content(content_json: &str, content_markdown: &str) -> bool {
    !content_markdown.trim().is_empty() || blocknote_json_has_text(content_json)
}

/// Creates a new empty meeting for note-taking
#[tauri::command]
pub async fn api_create_meeting<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    title: String,
) -> Result<serde_json::Value, String> {
    log_info!("api_create_meeting called with title: {}", title);

    let pool = state.db_manager.pool();

    let meeting_id = format!("meeting-{}", uuid::Uuid::new_v4());
    let now = chrono::Utc::now();

    sqlx::query::<sqlx::Sqlite>(
        "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&meeting_id)
    .bind(&title)
    .bind(now)
    .bind(now)
    .bind::<Option<String>>(None) // No folder path for notes
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create meeting: {}", e))?;

    log_info!("✅ Successfully created meeting: {}", meeting_id);

    Ok(serde_json::json!({
        "id": meeting_id,
        "title": title,
        "created_at": now.to_rfc3339(),
        "updated_at": now.to_rfc3339(),
    }))
}

/// Gets a note for a meeting (stored in meeting_notes table)
#[tauri::command]
pub async fn api_get_note<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
) -> Result<Option<serde_json::Value>, String> {
    log_info!("api_get_note called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();

    let note: Option<(String, Option<String>, String)> =
        sqlx::query_as::<_, (String, Option<String>, String)>(
            "SELECT notes_json, notes_markdown, updated_at FROM meeting_notes WHERE meeting_id = ?",
        )
        .bind(&meeting_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to fetch note: {}", e))?;

    if let Some((notes_json, notes_markdown, updated_at)) = note {
        Ok(Some(serde_json::json!({
            "content_json": notes_json,
            "content_markdown": notes_markdown.unwrap_or_default(),
            "format": "blocknote",
            "version": 1,
            "updated_at": updated_at,
        })))
    } else {
        Ok(None)
    }
}

// ===== FOLDER COMMANDS =====

/// Return all user-created folders ordered by creation time.
#[tauri::command]
pub async fn api_get_folders<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<Folder>, String> {
    log_info!("api_get_folders called");
    let pool = state.db_manager.pool();

    FoldersRepository::get_all_folders(pool)
        .await
        .map(|folders| {
            folders
                .into_iter()
                .map(|f| Folder {
                    id: f.id,
                    name: f.name,
                    created_at: f.created_at.0.to_rfc3339(),
                    updated_at: f.updated_at.0.to_rfc3339(),
                    parent_id: f.parent_id,
                })
                .collect()
        })
        .map_err(|e| {
            log_error!("Failed to get folders: {}", e);
            format!("Failed to get folders: {}", e)
        })
}

/// Create a new folder with the given name.
/// Pass `parent_id` to create a subfolder inside an existing folder.
#[tauri::command]
pub async fn api_create_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, String> {
    log_info!("api_create_folder called with name: {}, parent_id: {:?}", name, parent_id);

    if name.trim().is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let id = format!("folder-{}", uuid::Uuid::new_v4());
    let pool = state.db_manager.pool();

    FoldersRepository::create_folder(pool, &id, name.trim(), parent_id.as_deref())
        .await
        .map(|f| Folder {
            id: f.id,
            name: f.name,
            created_at: f.created_at.0.to_rfc3339(),
            updated_at: f.updated_at.0.to_rfc3339(),
            parent_id: f.parent_id,
        })
        .map_err(|e| {
            log_error!("Failed to create folder: {}", e);
            format!("Failed to create folder: {}", e)
        })
}

/// Rename an existing folder.
#[tauri::command]
pub async fn api_rename_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    folder_id: String,
    name: String,
) -> Result<(), String> {
    log_info!("api_rename_folder called: folder_id={}, name={}", folder_id, name);

    if name.trim().is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let pool = state.db_manager.pool();

    match FoldersRepository::rename_folder(pool, &folder_id, name.trim()).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("Folder not found: {}", folder_id)),
        Err(e) => {
            log_error!("Failed to rename folder {}: {}", folder_id, e);
            Err(format!("Failed to rename folder: {}", e))
        }
    }
}

/// Delete a folder. All meetings inside it become unfiled (folder_id = NULL).
#[tauri::command]
pub async fn api_delete_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    folder_id: String,
) -> Result<(), String> {
    log_info!("api_delete_folder called: folder_id={}", folder_id);

    let pool = state.db_manager.pool();

    match FoldersRepository::delete_folder(pool, &folder_id).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("Folder not found: {}", folder_id)),
        Err(e) => {
            log_error!("Failed to delete folder {}: {}", folder_id, e);
            Err(format!("Failed to delete folder: {}", e))
        }
    }
}

/// Assign a meeting to a folder, or remove it from all folders (pass folder_id = null).
#[tauri::command]
pub async fn api_move_meeting_to_folder<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    log_info!(
        "api_move_meeting_to_folder called: meeting_id={}, folder_id={:?}",
        meeting_id,
        folder_id
    );

    let pool = state.db_manager.pool();
    let folder_ref = folder_id.as_deref();

    match MeetingsRepository::update_meeting_folder(pool, &meeting_id, folder_ref).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(format!("Meeting not found: {}", meeting_id)),
        Err(e) => {
            log_error!("Failed to move meeting {} to folder {:?}: {}", meeting_id, folder_ref, e);
            Err(format!("Failed to move meeting to folder: {}", e))
        }
    }
}

/// Saves or updates a note for a meeting
#[tauri::command]
pub async fn api_save_note<R: Runtime>(
    _app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    meeting_id: String,
    content_json: String,
    content_markdown: String,
    _version: Option<i64>,
) -> Result<serde_json::Value, String> {
    log_info!("api_save_note called for meeting_id: {}", meeting_id);

    let pool = state.db_manager.pool();
    let now = chrono::Utc::now();

    let incoming_has_content = note_payload_has_content(&content_json, &content_markdown);
    if !incoming_has_content {
        let existing_note: Option<(Option<String>, Option<String>, String)> =
            sqlx::query_as::<_, (Option<String>, Option<String>, String)>(
                "SELECT notes_json, notes_markdown, updated_at FROM meeting_notes WHERE meeting_id = ?",
            )
            .bind(&meeting_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to check existing note: {}", e))?;

        if let Some((existing_json, existing_markdown, updated_at)) = existing_note {
            let existing_has_content = note_payload_has_content(
                existing_json.as_deref().unwrap_or_default(),
                existing_markdown.as_deref().unwrap_or_default(),
            );

            if existing_has_content {
                log_warn!(
                    "Ignored empty note overwrite for meeting {} to preserve existing notes",
                    meeting_id
                );
                return Ok(serde_json::json!({
                    "version": 1,
                    "updated_at": updated_at,
                    "ignored_empty_overwrite": true,
                }));
            }
        }
    }

    // Use UPSERT (INSERT OR REPLACE) to handle both create and update
    sqlx::query::<sqlx::Sqlite>(
        "INSERT INTO meeting_notes (meeting_id, notes_json, notes_markdown, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(meeting_id) DO UPDATE SET
            notes_json = excluded.notes_json,
            notes_markdown = excluded.notes_markdown,
            updated_at = excluded.updated_at",
    )
    .bind(&meeting_id)
    .bind(&content_json)
    .bind(&content_markdown)
    .bind(now.to_rfc3339())
    .bind(now.to_rfc3339())
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to save note: {}", e))?;

    log_info!("✅ Saved note for meeting: {}", meeting_id);

    // Refresh FTS so notes content is immediately searchable.
    if let Err(e) = crate::search::fts::refresh_meeting_fts(pool, &meeting_id).await {
        log_warn!("FTS refresh failed after note save for meeting {}: {}", meeting_id, e);
    }

    Ok(serde_json::json!({
        "version": 1,
        "updated_at": now.to_rfc3339(),
    }))
}

// ===== CHAT WITH MEETINGS =====

/// Send a message to the AI and receive a response that has full context of
/// the user's stored meeting transcripts.
///
/// The LLM used is the same one the user already configured for summaries —
/// no additional setup is required.
///
/// # Parameters
/// * `message`         — The user's current message
/// * `history`         — Previous turns in this chat session
/// * `date_range_days` — Optional: only include meetings from the past N days
#[tauri::command]
pub async fn api_chat_with_meetings<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    message: String,
    history: Vec<crate::chat::handler::ChatMessage>,
    date_range_days: Option<i64>,
) -> Result<String, String> {
    log_info!("api_chat_with_meetings called: message_len={}", message.len());

    // Resolve the app data directory (needed for BuiltInAI provider)
    let app_data_dir = app.path().app_data_dir().ok();

    crate::chat::handler::chat_with_meetings(
        &state,
        app_data_dir,
        &message,
        &history,
        date_range_days,
    )
    .await
}
