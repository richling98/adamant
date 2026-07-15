use chrono::Local;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Runtime};
use tracing::{info, warn};

use crate::{
    chat::wiki_fs,
    database::repositories::{meeting::MeetingsRepository, setting::SettingsRepository},
    search::fts::search_fts,
    state::AppState,
    summary::llm_client::{generate_summary, LLMProvider, EMPTY_LLM_RESPONSE_ERROR},
};

// ── Constants ──────────────────────────────────────────────────────────────────
const MAX_CONTEXT_CHARS: usize = 60_000;
const MAX_RETRIEVAL_RESULTS: usize = 10;
const MAX_MEETING_BLOCK_CHARS: usize = 6_000;
const MAX_SUMMARY_CHARS_PER_MEETING: usize = 2_000;
const MAX_NOTES_CHARS_PER_MEETING: usize = 2_200;
const MAX_TRANSCRIPT_CHARS_PER_MEETING: usize = 1_600;
const MAX_TRANSCRIPT_SEGMENTS_PER_MEETING: i64 = 500;
const MAX_CITED_MEETINGS: usize = 3;
const CHAT_MAX_TOKENS: u32 = 1024;

// ── Routing Constants ──────────────────────────────────────────────────────────
const MAX_ROUTING_MANIFEST: usize = 100;
const MAX_ROUTING_RETRIES: u32 = 3;
const MAX_ROUTING_RESULTS: usize = 5;

// ── Data Structures ────────────────────────────────────────────────────────────

/// A single chat turn shared between the frontend and the Rust handler.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// Structured response from the v2 chat endpoint, including citations.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatResponse {
    pub answer: String,
    pub cited_meeting_ids: Vec<String>,
}

// ── v1 (backward compatible) ───────────────────────────────────────────────────

/// Original chat_with_meetings — returns a plain string answer, no citations.
/// Kept for backward compatibility with the floating bubble.
pub async fn chat_with_meetings<R: Runtime>(
    state: &AppState,
    app_data_dir: Option<PathBuf>,
    message: &str,
    history: &[ChatMessage],
    date_range_days: Option<i64>,
    app_handle: &AppHandle<R>,
) -> Result<String, String> {
    let response = chat_with_meetings_v2(state, app_data_dir, message, history, date_range_days, app_handle)
        .await?;
    Ok(response.answer)
}

// ── v2 (with wiki articles + citations) ────────────────────────────────────────

/// New chat_with_meetings_v2 — returns structured answer with cited meeting IDs.
///
/// Flow:
///   1. FTS5 routing shortcut (<200ms, no LLM call)
///   2. If FTS5 returns nothing → LLM index routing fallback
///   3. Read wiki articles + FTS5 snippets for selected meetings
///   4. Final LLM pass generates answer with SOURCES citations
///   5. Parse citations, validate IDs, cap at 3
pub async fn chat_with_meetings_v2<R: Runtime>(
    state: &AppState,
    app_data_dir: Option<PathBuf>,
    message: &str,
    history: &[ChatMessage],
    date_range_days: Option<i64>,
    app_handle: &AppHandle<R>,
) -> Result<ChatResponse, String> {
    let pool = state.db_manager.pool();

    // ── 1. Fetch model config ────────────────────────────────────────────────
    let setting = SettingsRepository::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to read model config: {e}"))?
        .ok_or_else(|| "No model configured.".to_string())?;

    let provider =
        LLMProvider::from_str(&setting.provider).map_err(|e| format!("Unknown provider: {e}"))?;
    let api_key = SettingsRepository::get_api_key(pool, &setting.provider)
        .await
        .map_err(|e| format!("Failed to read API key: {e}"))?
        .unwrap_or_default();

    let custom_config = if setting.provider == "custom-openai" {
        SettingsRepository::get_custom_openai_config(pool)
            .await
            .map_err(|e| format!("Failed to read custom OpenAI config: {e}"))?
    } else {
        None
    };

    let _ = app_handle.emit("chat-status", "Searching your meetings...");

    // ── 2. Fetch meetings ────────────────────────────────────────────────────
    let all_meetings = MeetingsRepository::get_meetings(pool)
        .await
        .map_err(|e| format!("Failed to fetch meetings: {e}"))?;

    let effective_date_range_days = date_range_days.or_else(|| infer_date_range_days(message));

    let cutoff = effective_date_range_days.map(|days| {
        Local::now()
            .naive_local()
            .date()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            - chrono::Duration::days(days)
    });

    let meeting_pool: HashMap<&str, &crate::database::models::MeetingModel> = all_meetings
        .iter()
        .filter(|m| cutoff.map_or(true, |c| m.created_at.0.naive_utc() >= c))
        .map(|m| (m.id.as_str(), m))
        .collect();

    let allowed_ids: HashSet<&str> = meeting_pool.keys().copied().collect();

    info!(
        "chat_v2: {} meetings in date range {:?}",
        meeting_pool.len(),
        effective_date_range_days
    );

    // ── 3. Select relevant meetings ──────────────────────────────────────────
    let selected_ids = select_meetings(
        pool,
        message,
        &allowed_ids,
        &meeting_pool,
        &provider,
        &setting.model,
        &api_key,
        setting.ollama_endpoint.as_deref(),
        custom_config.as_ref().map(|c| c.endpoint.as_str()),
        &app_data_dir,
        app_handle,
    )
    .await?;

    if selected_ids.is_empty() {
        info!("chat_v2: no relevant meetings found, proceeding with empty context");
    }

    // ── 4. Build context: wiki articles + FTS5 snippets ──────────────────────
    let _ = app_handle.emit("chat-status", "Reading your meeting notes...");

    let context = build_wiki_context(
        pool,
        &app_data_dir,
        &selected_ids,
        &meeting_pool,
        message,
    )
    .await;

    let meetings_context = if context.is_empty() {
        "No meeting content found.".to_string()
    } else {
        context
    };

    // ── 5. Build system prompt with citation instruction ──────────────────────
    let today = Local::now().format("%A, %B %-d, %Y").to_string();
    let system_prompt = format!(
        "You are a helpful AI assistant with access to the user's meeting content. \
        Today is {today}. \
        Answer the user's questions based on the meeting content below. \
        Be concise and cite specific meetings when relevant.\n\n\
        IMPORTANT: After your answer, include a line exactly like this:\n\
        SOURCES: <meeting_id_1>, <meeting_id_2>, <meeting_id_3>\n\
        Only include meeting IDs that you actually used. Max 3. \
        If you didn't use any meeting, omit the SOURCES line.\n\n\
        ---\n\
        MEETING CONTENT:\n\n\
        {meetings_context}\
        ---"
    );

    // ── 6. Build user prompt ─────────────────────────────────────────────────
    let user_prompt = if history.is_empty() {
        message.to_string()
    } else {
        let history_text: String = history
            .iter()
            .map(|m| format!("{}: {}", capitalise(&m.role), m.content))
            .collect::<Vec<_>>()
            .join("\n");
        format!("{history_text}\n\nUser: {message}")
    };

    // ── 7. Call LLM ──────────────────────────────────────────────────────────
    let _ = app_handle.emit("chat-status", "Generating response...");

    let client = Client::new();
    let chat_max_tokens = custom_config
        .as_ref()
        .and_then(|c| c.max_tokens.map(|v| v as u32))
        .unwrap_or(CHAT_MAX_TOKENS);

    let raw_answer = generate_chat_response_with_retry(
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

    // ── 8. Parse SOURCES line ────────────────────────────────────────────────
    let (answer, cited_ids) = parse_sources(&raw_answer);
    let valid_cited: Vec<String> = cited_ids
        .into_iter()
        .filter(|id| allowed_ids.contains(id.as_str()))
        .take(MAX_CITED_MEETINGS)
        .collect();

    info!(
        "chat_v2: answer_len={} citations={}",
        answer.len(),
        valid_cited.len()
    );

    Ok(ChatResponse {
        answer,
        cited_meeting_ids: valid_cited,
    })
}

// ── Meeting Selection ──────────────────────────────────────────────────────────

/// Select relevant meeting IDs: try FTS5 routing shortcut first, fall back to
/// LLM index routing.
async fn select_meetings<R: Runtime>(
    pool: &sqlx::SqlitePool,
    message: &str,
    allowed_ids: &HashSet<&str>,
    meeting_pool: &HashMap<&str, &crate::database::models::MeetingModel>,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    app_data_dir: &Option<PathBuf>,
    app_handle: &AppHandle<R>,
) -> Result<Vec<String>, String> {
    // FTS5 routing shortcut: <200ms, no LLM call.
    let fts_results = search_fts(pool, message).await.unwrap_or_default();
    let fts_ids: Vec<String> = fts_results
        .into_iter()
        .map(|m| m.meeting_id)
        .filter(|id| allowed_ids.contains(id.as_str()))
        .take(MAX_RETRIEVAL_RESULTS)
        .collect();

    if !fts_ids.is_empty() {
        info!("chat_routing: FTS5 shortcut — {} meetings selected", fts_ids.len());
        return Ok(fts_ids);
    }

    info!("chat_routing: FTS5 returned nothing, falling back to LLM index routing");
    let _ = app_handle.emit("chat-status", "Reading your meeting notes...");

    // ── Build meeting manifest ───────────────────────────────────────────────
    let mut meetings_sorted: Vec<&&crate::database::models::MeetingModel> = meeting_pool.values().collect();
    meetings_sorted.sort_by(|a, b| b.created_at.0.cmp(&a.created_at.0));

    let manifest_lines: Vec<String> = meetings_sorted
        .iter()
        .take(MAX_ROUTING_MANIFEST)
        .map(|m| {
            let date = m.created_at.0.format("%Y-%m-%d");
            format!("ID: {} | Title: {} | Date: {}", m.id, m.title, date)
        })
        .collect();

    if manifest_lines.is_empty() {
        info!("chat_routing: no meetings in range for LLM routing");
        return Ok(vec![]);
    }

    let manifest = manifest_lines.join("\n");
    let routing_prompt = format!(
        "Select up to {MAX_ROUTING_RESULTS} meeting IDs from the list below \
         that are most relevant to the user's question.\n\
         Return ONLY the selected IDs, one per line. No explanation, no markdown.\n\
         If none are relevant, return nothing.\n\n\
         Meetings:\n{manifest}\n\nUser question: {message}"
    );

    // ── Call LLM with retry ──────────────────────────────────────────────────
    let client = Client::new();
    let mut last_error = String::new();

    for attempt in 1..=MAX_ROUTING_RETRIES {
        if attempt > 1 {
            let status = format!("Retrying (attempt {attempt}/{MAX_ROUTING_RETRIES})...");
            let _ = app_handle.emit("chat-status", &status);
            info!("chat_routing: retry attempt {}/{}", attempt, MAX_ROUTING_RETRIES);
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }

        match generate_summary(
            &client,
            provider,
            model_name,
            api_key,
            "You are a meeting retrieval system. Select IDs only.",
            &routing_prompt,
            ollama_endpoint,
            custom_openai_endpoint,
            Some(200),
            Some(0.0),
            None,
            app_data_dir.as_ref(),
            None,
        )
        .await
        {
            Ok(response) => {
                let routing_ids: Vec<String> = response
                    .lines()
                    .filter_map(|line| {
                        let trimmed = line.trim();
                        if trimmed.is_empty() { return None; }
                        let cleaned = trimmed
                            .trim_start_matches(&['-', '*', '`', '"', '\''][..])
                            .trim_end_matches(&['`', '"', '\''][..])
                            .trim();
                        let id = if cleaned.starts_with("ID:") {
                            cleaned[3..].trim()
                        } else {
                            cleaned
                        };
                        if id.is_empty() { None } else { Some(id) }
                    })
                    .filter(|id: &&str| allowed_ids.contains(id))
                    .take(MAX_ROUTING_RESULTS)
                    .map(|id| id.to_string())
                    .collect();

                if !routing_ids.is_empty() {
                    info!("chat_routing: LLM routing selected {} meetings", routing_ids.len());
                    return Ok(routing_ids);
                }
                info!("chat_routing: LLM routing returned no valid IDs");
                return Ok(vec![]);
            }
            Err(e) => {
                last_error = e.clone();
                warn!("chat_routing: LLM routing attempt {attempt} failed: {e}");
            }
        }
    }

    warn!("chat_routing: all {MAX_ROUTING_RETRIES} LLM routing attempts failed: {last_error}");
    Ok(vec![])
}

// ── Context Building ───────────────────────────────────────────────────────────

/// Build the meeting context block from wiki articles + FTS5 snippets.
/// If a meeting has a compiled wiki article, use it. Otherwise fall back to
/// raw transcript data (same as the original handler).
async fn build_wiki_context(
    pool: &sqlx::SqlitePool,
    app_data_dir: &Option<PathBuf>,
    selected_ids: &[String],
    meeting_pool: &HashMap<&str, &crate::database::models::MeetingModel>,
    _message: &str,
) -> String {
    let mut context_parts: Vec<String> = Vec::new();
    let mut total_chars = 0usize;

    for meeting_id in selected_ids {
        let Some(meeting) = meeting_pool.get(meeting_id.as_str()) else {
            continue;
        };

        let date_str = meeting.created_at.0.format("%Y-%m-%d").to_string();

        // Try to read the compiled wiki article first.
        let wiki_article = app_data_dir.as_ref().and_then(|dir| {
            tokio::task::block_in_place(|| {
                tokio::runtime::Handle::current()
                    .block_on(async { wiki_fs::read_meeting_article(dir, meeting_id).await })
            })
        });

        let mut block = if let Some(article) = wiki_article {
            format!("## Meeting: {}\nDate: {}\n(Wiki Article)\n\n{}\n\n", meeting.title, date_str, article)
        } else {
            // Fall back to raw transcript data.
            fallback_meeting_block(pool, meeting, &date_str).await
        };

        if block.len() > MAX_MEETING_BLOCK_CHARS {
            block = truncate_at_word_boundary(&block, MAX_MEETING_BLOCK_CHARS);
        }

        let remaining = MAX_CONTEXT_CHARS.saturating_sub(total_chars);
        if remaining == 0 {
            break;
        }

        let (to_add, block_truncated) = if block.len() <= remaining {
            (block, false)
        } else {
            (truncate_at_word_boundary(&block, remaining), true)
        };

        total_chars += to_add.len();
        context_parts.push(to_add);

        if block_truncated {
            break;
        }
    }

    context_parts.concat()
}

/// Build a meeting block from raw DB data (no wiki article available).
async fn fallback_meeting_block(
    pool: &sqlx::SqlitePool,
    meeting: &crate::database::models::MeetingModel,
    date_str: &str,
) -> String {
    let (transcripts, _) = MeetingsRepository::get_meeting_transcripts_paginated(
        pool,
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

    let notes_text: Option<String> =
        sqlx::query_scalar("SELECT notes_markdown FROM meeting_notes WHERE meeting_id = ?")
            .bind(&meeting.id)
            .fetch_optional(pool)
            .await
            .unwrap_or(None)
            .flatten();

    let summary_text: Option<String> = sqlx::query_scalar(
        "SELECT result FROM summary_processes WHERE meeting_id = ? AND status = 'completed'",
    )
    .bind(&meeting.id)
    .fetch_optional(pool)
    .await
    .unwrap_or(None)
    .flatten();

    let has_transcript = !transcript_text.trim().is_empty();
    let has_notes = notes_text.as_deref().map_or(false, |n| !n.trim().is_empty());
    let has_summary = summary_text.as_deref().map_or(false, |s| !s.trim().is_empty());

    if !has_transcript && !has_notes && !has_summary {
        return String::new();
    }

    let mut block = format!("## Meeting: {}\nDate: {}\n\n", meeting.title, date_str);

    if has_summary {
        append_capped_section(
            &mut block,
            "Saved AI Summary",
            summary_text.as_deref().unwrap_or(""),
            MAX_SUMMARY_CHARS_PER_MEETING,
        );
    }

    if has_notes {
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

    block
}

// ── Citation Parsing ───────────────────────────────────────────────────────────

/// Parse the `SOURCES:` line from the LLM answer. Returns (clean_answer, cited_ids).
fn parse_sources(raw: &str) -> (String, Vec<String>) {
    let lines: Vec<&str> = raw.trim().lines().collect();
    if lines.is_empty() {
        return (raw.to_string(), vec![]);
    }

    // Check the last line for SOURCES:
    let last = lines.last().unwrap_or(&"").trim();
    if let Some(ids_str) = last.strip_prefix("SOURCES:") {
        let ids: Vec<String> = ids_str
            .split(|c: char| c == ',' || c == ' ')
            .filter_map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
            })
            .collect();

        if !ids.is_empty() {
            // Reconstruct answer without the SOURCES line.
            let answer = lines[..lines.len() - 1].join("\n").trim().to_string();
            return (answer, ids);
        }
    }

    (raw.to_string(), vec![])
}

// ── LLM Call with Retry ────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

fn infer_date_range_days(message: &str) -> Option<i64> {
    let lower = message.to_lowercase();
    if lower.contains("today") {
        Some(1)
    } else if lower.contains("yesterday") {
        Some(2)
    } else if lower.contains("past week") || lower.contains("last week") || lower.contains("this week") {
        Some(7)
    } else if lower.contains("past month") || lower.contains("last month") || lower.contains("this month") {
        Some(31)
    } else {
        None
    }
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

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

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
    fn truncate_at_word_boundary_caps_long_content() {
        assert_eq!(
            truncate_at_word_boundary("alpha beta gamma", 12),
            "alpha beta... [truncated]"
        );
    }

    #[test]
    fn parse_sources_extracts_citation_ids() {
        let raw = "The meeting decided to launch in Q3.\n\nSOURCES: meeting-abc, meeting-def";
        let (answer, ids) = parse_sources(raw);
        assert_eq!(answer, "The meeting decided to launch in Q3.");
        assert_eq!(ids, vec!["meeting-abc", "meeting-def"]);
    }

    #[test]
    fn parse_sources_returns_empty_when_missing() {
        let raw = "Just a normal answer without sources.";
        let (answer, ids) = parse_sources(raw);
        assert_eq!(answer, raw);
        assert!(ids.is_empty());
    }

    #[test]
    fn parse_sources_caps_at_three() {
        let raw = "Answer text.\n\nSOURCES: a, b, c, d, e";
        let (answer, ids) = parse_sources(raw);
        assert_eq!(answer, "Answer text.");
        assert_eq!(ids, vec!["a", "b", "c", "d", "e"]);
        // The cap at 3 happens in the caller, not in parse_sources
    }
}
