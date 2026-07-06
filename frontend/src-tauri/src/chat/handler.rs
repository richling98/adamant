use chrono::Local;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tokio::time::{sleep, Duration};
use tracing::{info, warn};

use crate::{
    database::repositories::{meeting::MeetingsRepository, setting::SettingsRepository},
    state::AppState,
    summary::llm_client::{generate_summary, LLMProvider, EMPTY_LLM_RESPONSE_ERROR},
};

/// Maximum total character budget for meeting context injected into the system
/// prompt.  At ~4 chars/token this is ≈15 k tokens — comfortable headroom for
/// any of the supported models.
const MAX_CONTEXT_CHARS: usize = 60_000;
const MAX_RETRIEVAL_RESULTS: usize = 10;
const FALLBACK_RECENT_MEETINGS: usize = 8;
const MAX_MEETING_BLOCK_CHARS: usize = 6_000;
const MAX_SUMMARY_CHARS_PER_MEETING: usize = 2_000;
const MAX_NOTES_CHARS_PER_MEETING: usize = 2_200;
const MAX_TRANSCRIPT_CHARS_PER_MEETING: usize = 1_600;
const MAX_TRANSCRIPT_SEGMENTS_PER_MEETING: i64 = 500;

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
    let setting = match SettingsRepository::get_model_config(&pool).await {
        Ok(Some(setting)) => setting,
        Ok(None) => {
            warn!("chat_model_config_missing: retrying once before returning error");
            sleep(Duration::from_millis(100)).await;
            SettingsRepository::get_model_config(&pool)
                .await
                .map_err(|e| format!("Failed to read model config: {e}"))?
                .ok_or_else(|| {
                    "No model configured. Please set up a model in Settings.".to_string()
                })?
        }
        Err(e) => return Err(format!("Failed to read model config: {e}")),
    };

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

    let effective_date_range_days = date_range_days.or_else(|| infer_date_range_days(message));

    // Optionally filter by date range
    let cutoff = effective_date_range_days.map(|days| {
        Local::now()
            .naive_local()
            .date()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            - chrono::Duration::days(days)
    });

    let meetings_to_include: Vec<_> = all_meetings
        .iter()
        .filter(|m| cutoff.map_or(true, |c| m.created_at.0.naive_utc() >= c))
        .collect();

    info!(
        "chat_with_meetings: {} meetings in context (date_range_days={:?})",
        meetings_to_include.len(),
        effective_date_range_days
    );

    // ── 3. Select relevant meetings and build context ───────────────────────
    let search_results = match crate::search::fts::search_fts(pool, message).await {
        Ok(results) => results,
        Err(e) => {
            warn!(
                "chat_context_search_failed: falling back to recent meetings: {}",
                e
            );
            Vec::new()
        }
    };

    let allowed_meeting_ids: HashSet<&str> =
        meetings_to_include.iter().map(|m| m.id.as_str()).collect();

    let meeting_by_id: HashMap<&str, _> = meetings_to_include
        .iter()
        .map(|m| (m.id.as_str(), *m))
        .collect();

    let mut matched_context: HashMap<String, String> = HashMap::new();
    let mut selected_meeting_ids: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    for hit in search_results
        .iter()
        .filter(|hit| allowed_meeting_ids.contains(hit.meeting_id.as_str()))
        .take(MAX_RETRIEVAL_RESULTS)
    {
        if seen.insert(hit.meeting_id.clone()) {
            selected_meeting_ids.push(hit.meeting_id.clone());
            matched_context.insert(
                hit.meeting_id.clone(),
                format!(
                    "{} match: {}",
                    hit.match_source,
                    strip_search_markup(&hit.context)
                ),
            );
        }
    }

    let selection_strategy = if selected_meeting_ids.is_empty() {
        for meeting in meetings_to_include.iter().take(FALLBACK_RECENT_MEETINGS) {
            if seen.insert(meeting.id.clone()) {
                selected_meeting_ids.push(meeting.id.clone());
            }
        }
        "recent-fallback"
    } else {
        "fts-relevance"
    };

    let mut context_parts: Vec<String> = Vec::new();
    let mut total_chars = 0usize;
    let mut truncated = false;

    'outer: for meeting_id in &selected_meeting_ids {
        let Some(meeting) = meeting_by_id.get(meeting_id.as_str()) else {
            continue;
        };
        // Fetch transcripts for this meeting (up to 500 segments).
        let (transcripts, _) = MeetingsRepository::get_meeting_transcripts_paginated(
            &pool,
            &meeting.id,
            MAX_TRANSCRIPT_SEGMENTS_PER_MEETING,
            0,
        )
        .await
        .unwrap_or_default();

        let transcript_text: String = transcripts
            .iter()
            .map(|t| t.transcript.as_str())
            .collect::<Vec<_>>()
            .join(" ");

        // Fetch manually written notes for this meeting.
        // Returns None if the meeting has no notes row yet.
        let notes_text: Option<String> =
            sqlx::query_scalar("SELECT notes_markdown FROM meeting_notes WHERE meeting_id = ?")
                .bind(&meeting.id)
                .fetch_optional(pool)
                .await
                .unwrap_or(None)
                .flatten();

        // Fetch saved AI summary when available. This gives broad questions a
        // compact signal even when the raw transcript is long.
        let summary_text: Option<String> = sqlx::query_scalar(
            "SELECT result FROM summary_processes WHERE meeting_id = ? AND status = 'completed'",
        )
        .bind(&meeting.id)
        .fetch_optional(pool)
        .await
        .unwrap_or(None)
        .flatten();

        // Skip meetings that have no usable content.
        let has_transcript = !transcript_text.trim().is_empty();
        let has_notes = notes_text
            .as_deref()
            .map_or(false, |n| !n.trim().is_empty());
        let has_summary = summary_text
            .as_deref()
            .map_or(false, |s| !s.trim().is_empty());
        if !has_transcript && !has_notes && !has_summary {
            continue;
        }

        // Build the meeting block: header + transcript (if any) + notes (if any).
        let date_str = meeting.created_at.0.format("%Y-%m-%d").to_string();
        let mut block = format!("## Meeting: {}\nDate: {}\n\n", meeting.title, date_str);

        if let Some(snippet) = matched_context.get(&meeting.id) {
            block.push_str("Matched context:\n");
            block.push_str(snippet.trim());
            block.push_str("\n\n");
        }

        if has_summary {
            append_capped_section(
                &mut block,
                "Saved AI Summary",
                summary_text.as_deref().unwrap_or(""),
                MAX_SUMMARY_CHARS_PER_MEETING,
            );
        }

        if has_notes {
            // Label the notes section clearly so the LLM can distinguish spoken
            // content from the user's own written observations.
            append_capped_section(
                &mut block,
                "Notes",
                notes_text.as_deref().unwrap_or(""),
                MAX_NOTES_CHARS_PER_MEETING,
            );
        }

        if has_transcript {
            append_capped_section(
                &mut block,
                "Transcript Excerpt",
                transcript_text.trim(),
                MAX_TRANSCRIPT_CHARS_PER_MEETING,
            );
        }

        if block.len() > MAX_MEETING_BLOCK_CHARS {
            block = truncate_at_word_boundary(&block, MAX_MEETING_BLOCK_CHARS);
        }

        // Truncate block if it alone would bust the shared character budget.
        let remaining = MAX_CONTEXT_CHARS.saturating_sub(total_chars);
        if remaining == 0 {
            break 'outer;
        }

        let (to_add, block_truncated) = if block.len() <= remaining {
            (block, false)
        } else {
            (truncate_at_word_boundary(&block, remaining), true)
        };

        total_chars += to_add.len();
        context_parts.push(to_add);

        if block_truncated {
            truncated = true;
            break 'outer;
        }
    }

    let meetings_context = if context_parts.is_empty() {
        "No meeting content found.".to_string()
    } else {
        context_parts.join("")
    };

    info!(
        "chat_context: strategy={} available_meetings={} search_hits={} selected_meetings={} included_meetings={} context_chars={} truncated={}",
        selection_strategy,
        meetings_to_include.len(),
        search_results.len(),
        selected_meeting_ids.len(),
        context_parts.len(),
        total_chars,
        truncated
    );

    // ── 4. Build system prompt ───────────────────────────────────────────────
    let today = Local::now().format("%A, %B %-d, %Y").to_string();
    let system_prompt = format!(
        "You are a helpful AI assistant with access to the user's meeting content. \
        Today is {today}. \
        Answer the user's questions based on the meeting content (transcripts and notes) provided below. \
        Be concise and cite specific meetings when relevant.\n\n\
        ---\n\
        MEETING CONTENT:\n\n\
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

    let response = generate_chat_response_with_retry(
        &client,
        &provider,
        &setting.model,
        &api_key,
        &system_prompt,
        &user_prompt,
        setting.ollama_endpoint.as_deref(),
        custom_config.as_ref().map(|c| c.endpoint.as_str()),
        Some(chat_max_tokens),
        custom_config.as_ref().and_then(|c| c.temperature),
        custom_config.as_ref().and_then(|c| c.top_p),
        app_data_dir.as_ref(),
    )
    .await?;

    Ok(response)
}

async fn generate_chat_response_with_retry(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    system_prompt: &str,
    user_prompt: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
) -> Result<String, String> {
    match generate_summary(
        client,
        provider,
        model_name,
        api_key,
        system_prompt,
        user_prompt,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        None,
    )
    .await
    {
        Ok(response) => Ok(response),
        Err(err) if err == EMPTY_LLM_RESPONSE_ERROR => {
            warn!("chat_response_empty: retrying once after empty LLM response");
            let retry_prompt = format!(
                "{user_prompt}\n\nReturn a concise answer in plain text. Do not return an empty response."
            );
            generate_summary(
                client,
                provider,
                model_name,
                api_key,
                system_prompt,
                &retry_prompt,
                ollama_endpoint,
                custom_openai_endpoint,
                max_tokens,
                temperature,
                top_p,
                app_data_dir,
                None,
            )
            .await
            .map_err(|retry_err| {
                if retry_err == EMPTY_LLM_RESPONSE_ERROR {
                    "The LLM returned an empty response after retrying.".to_string()
                } else {
                    retry_err
                }
            })
        }
        Err(err) => Err(err),
    }
}

fn infer_date_range_days(message: &str) -> Option<i64> {
    let lower = message.to_lowercase();
    if lower.contains("today") {
        Some(1)
    } else if lower.contains("yesterday") {
        Some(2)
    } else if lower.contains("past week")
        || lower.contains("last week")
        || lower.contains("this week")
    {
        Some(7)
    } else if lower.contains("past month")
        || lower.contains("last month")
        || lower.contains("this month")
    {
        Some(31)
    } else {
        None
    }
}

fn strip_search_markup(snippet: &str) -> String {
    snippet.replace("<b>", "").replace("</b>", "")
}

fn append_capped_section(block: &mut String, label: &str, content: &str, max_chars: usize) {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return;
    }

    block.push_str("### ");
    block.push_str(label);
    block.push_str(":\n");
    block.push_str(&truncate_at_word_boundary(trimmed, max_chars));
    block.push_str("\n\n");
}

fn truncate_at_word_boundary(content: &str, max_chars: usize) -> String {
    if content.len() <= max_chars {
        return content.to_string();
    }

    let cut = content
        .char_indices()
        .take_while(|(idx, _)| *idx <= max_chars)
        .map(|(idx, _)| idx)
        .last()
        .unwrap_or(0);
    let candidate = &content[..cut];
    let word_cut = candidate.rfind(' ').unwrap_or(candidate.len());
    format!("{}... [truncated]", candidate[..word_cut].trim_end())
}

/// Capitalise the first letter of a string slice (used for history formatting)
fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infer_date_range_days_handles_common_relative_ranges() {
        assert_eq!(infer_date_range_days("summarize today"), Some(1));
        assert_eq!(infer_date_range_days("what happened last week?"), Some(7));
        assert_eq!(infer_date_range_days("past month action items"), Some(31));
        assert_eq!(infer_date_range_days("find launch notes"), None);
    }

    #[test]
    fn strip_search_markup_removes_fts_highlight_tags() {
        assert_eq!(
            strip_search_markup("transcript <b>launch</b> notes"),
            "transcript launch notes"
        );
    }

    #[test]
    fn truncate_at_word_boundary_caps_long_content() {
        assert_eq!(
            truncate_at_word_boundary("alpha beta gamma", 12),
            "alpha beta... [truncated]"
        );
    }
}
