use chrono::Local;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::info;

use crate::{
    database::repositories::{meeting::MeetingsRepository, setting::SettingsRepository},
    state::AppState,
    summary::llm_client::{generate_summary, LLMProvider},
};

/// Maximum total character budget for meeting context injected into the system
/// prompt.  At ~4 chars/token this is ≈15 k tokens — comfortable headroom for
/// any of the supported models.
const MAX_CONTEXT_CHARS: usize = 60_000;

/// A single chat turn shared between the frontend and the Rust handler.
/// Mirrors the OpenAI ChatMessage shape so the frontend can pass history
/// through directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Core logic: fetch meeting context, build a system prompt, and call the
/// configured LLM via the existing `generate_summary` infrastructure.
///
/// # Arguments
/// * `state`           — Tauri AppState giving access to the database pool
/// * `app_data_dir`    — App data directory (required for BuiltInAI provider)
/// * `message`         — The user's current message
/// * `history`         — Previous turns in this session (user + assistant)
/// * `date_range_days` — If provided, only include meetings from the past N days
pub async fn chat_with_meetings(
    state: &AppState,
    app_data_dir: Option<PathBuf>,
    message: &str,
    history: &[ChatMessage],
    date_range_days: Option<i64>,
) -> Result<String, String> {
    let pool = state.db_manager.pool();

    // ── 1. Fetch model config ────────────────────────────────────────────────
    let setting = SettingsRepository::get_model_config(&pool)
        .await
        .map_err(|e| format!("Failed to read model config: {e}"))?
        .ok_or_else(|| "No model configured. Please set up a model in Settings.".to_string())?;

    let provider =
        LLMProvider::from_str(&setting.provider).map_err(|e| format!("Unknown provider: {e}"))?;

    let api_key = SettingsRepository::get_api_key(&pool, &setting.provider)
        .await
        .map_err(|e| format!("Failed to read API key: {e}"))?
        .unwrap_or_default();

    // For CustomOpenAI we also need the endpoint / extra params
    let custom_config = if setting.provider == "custom-openai" {
        SettingsRepository::get_custom_openai_config(&pool)
            .await
            .map_err(|e| format!("Failed to read custom OpenAI config: {e}"))?
    } else {
        None
    };

    // ── 2. Fetch meetings ────────────────────────────────────────────────────
    let all_meetings = MeetingsRepository::get_meetings(&pool)
        .await
        .map_err(|e| format!("Failed to fetch meetings: {e}"))?;

    // Optionally filter by date range
    let cutoff = date_range_days.map(|days| {
        Local::now()
            .naive_local()
            .date()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            - chrono::Duration::days(days)
    });

    let meetings_to_include: Vec<_> = all_meetings
        .iter()
        .filter(|m| {
            cutoff.map_or(true, |c| {
                m.created_at.0.naive_utc() >= c
            })
        })
        .collect();

    info!(
        "chat_with_meetings: {} meetings in context (date_range_days={:?})",
        meetings_to_include.len(),
        date_range_days
    );

    // ── 3. Build meeting context ─────────────────────────────────────────────
    let mut context_parts: Vec<String> = Vec::new();
    let mut total_chars = 0usize;

    'outer: for meeting in &meetings_to_include {
        // Fetch transcripts for this meeting (up to 500 segments)
        let (transcripts, _) =
            MeetingsRepository::get_meeting_transcripts_paginated(&pool, &meeting.id, 500, 0)
                .await
                .unwrap_or_default();

        let transcript_text: String = transcripts
            .iter()
            .map(|t| t.transcript.as_str())
            .collect::<Vec<_>>()
            .join(" ");

        if transcript_text.trim().is_empty() {
            continue;
        }

        let date_str = meeting.created_at.0.format("%Y-%m-%d").to_string();
        let header = format!("## Meeting: {}\nDate: {}\n\n", meeting.title, date_str);
        let block = format!("{}{}\n\n", header, transcript_text.trim());

        // Truncate block if it alone would bust the budget
        let remaining = MAX_CONTEXT_CHARS.saturating_sub(total_chars);
        if remaining == 0 {
            break 'outer;
        }

        let (to_add, truncated) = if block.len() <= remaining {
            (block, false)
        } else {
            // Cut at a word boundary within the budget
            let cut = &block[..remaining];
            let cut = cut
                .rfind(' ')
                .map_or(cut, |pos| &block[..pos]);
            (format!("{}… [truncated]", cut), true)
        };

        total_chars += to_add.len();
        context_parts.push(to_add);

        if truncated {
            break 'outer;
        }
    }

    let meetings_context = if context_parts.is_empty() {
        "No meeting transcripts found.".to_string()
    } else {
        context_parts.join("")
    };

    // ── 4. Build system prompt ───────────────────────────────────────────────
    let today = Local::now().format("%A, %B %-d, %Y").to_string();
    let system_prompt = format!(
        "You are a helpful AI assistant with access to the user's meeting notes. \
        Today is {today}. \
        Answer the user's questions based on the meeting transcripts provided below. \
        Be concise and cite specific meetings when relevant.\n\n\
        ---\n\
        MEETING TRANSCRIPTS:\n\n\
        {meetings_context}\
        ---"
    );

    // ── 5. Build user prompt (history + current message) ────────────────────
    // `generate_summary` accepts a system_prompt + user_prompt pair.
    // We embed the conversation history as a formatted block so all providers
    // get the multi-turn context without requiring API changes.
    let user_prompt = if history.is_empty() {
        message.to_string()
    } else {
        let history_text: String = history
            .iter()
            .map(|m| format!("{}: {}", capitalise(&m.role), m.content))
            .collect::<Vec<_>>()
            .join("\n");
        format!("{}\n\nUser: {}", history_text, message)
    };

    // ── 6. Call LLM ──────────────────────────────────────────────────────────
    let client = Client::new();

    // For chat responses a concise answer is expected; cap generation to avoid
    // runaway repetition, especially with local Ollama models on long context.
    // Custom config can override this; Claude uses its own hardcoded limit.
    const CHAT_MAX_TOKENS: u32 = 1024;
    let chat_max_tokens = custom_config
        .as_ref()
        .and_then(|c| c.max_tokens.map(|v| v as u32))
        .unwrap_or(CHAT_MAX_TOKENS);

    let response = generate_summary(
        &client,
        &provider,
        &setting.model,
        &api_key,
        &system_prompt,
        &user_prompt,
        setting.ollama_endpoint.as_deref(),
        custom_config
            .as_ref()
            .map(|c| c.endpoint.as_str()),
        Some(chat_max_tokens),
        custom_config.as_ref().and_then(|c| c.temperature),
        custom_config.as_ref().and_then(|c| c.top_p),
        app_data_dir.as_ref(),
        None, // no cancellation token for chat
    )
    .await?;

    Ok(response)
}

/// Capitalise the first letter of a string slice (used for history formatting)
fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}
