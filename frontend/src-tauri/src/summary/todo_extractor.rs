use crate::database::repositories::todos::{NewTodoItem, TodosRepository};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;
use tracing::info;

const EXTRACTION_MAX_TOKENS: u32 = 1024;
const EXTRACTION_TEMPERATURE: f32 = 0.1;

pub struct TodoExtractor;

#[derive(serde::Deserialize, Debug)]
struct ExtractedTodoItem {
    text: String,
    owner: Option<String>,
    deadline: Option<String>,
}

impl TodoExtractor {
    pub async fn extract_todos_from_sources(
        pool: &sqlx::SqlitePool,
        meeting_id: &str,
        title: &str,
        meeting_date: &str,
        transcript_text: &str,
        notes_markdown: Option<&str>,
        provider: &LLMProvider,
        model_name: &str,
        api_key: &str,
        ollama_endpoint: Option<&str>,
        custom_openai_endpoint: Option<&str>,
        app_data_dir: Option<&PathBuf>,
        cancellation_token: Option<&CancellationToken>,
    ) -> Result<usize, String> {
        info!(
            "Starting todo extraction for meeting: {} (model: {}, transcript_len: {}, notes_len: {})",
            meeting_id,
            model_name,
            transcript_text.len(),
            notes_markdown.map(str::len).unwrap_or(0)
        );

        let note_items = notes_markdown
            .map(Self::extract_todo_section_items)
            .unwrap_or_default();

        let items = if note_items.is_empty() {
            let (system_prompt, user_prompt) =
                Self::build_extraction_prompt(title, meeting_date, transcript_text);

            let client = Client::new();

            let raw_response = generate_summary(
                &client,
                provider,
                model_name,
                api_key,
                &system_prompt,
                &user_prompt,
                ollama_endpoint,
                custom_openai_endpoint,
                Some(EXTRACTION_MAX_TOKENS),
                Some(EXTRACTION_TEMPERATURE),
                None,
                app_data_dir,
                cancellation_token,
            )
            .await?;

            let transcript_items = Self::parse_extraction_response(&raw_response)?;
            info!(
                "LLM transcript todo extraction found {} items for meeting: {}",
                transcript_items.len(),
                meeting_id
            );
            transcript_items
        } else {
            info!(
                "Deterministic notes todo extraction found {} items for meeting: {}; skipping transcript LLM extraction",
                note_items.len(), meeting_id
            );
            note_items
        };

        let deleted = TodosRepository::delete_extracted_by_meeting(pool, meeting_id)
            .await
            .map_err(|e| format!("Failed to clear existing extracted todos: {}", e))?;
        if deleted > 0 {
            info!(
                "Deleted {} existing extracted todos before re-extracting meeting: {}",
                deleted, meeting_id
            );
        }

        if items.is_empty() {
            info!("No todos extracted from meeting: {}", meeting_id);
            return Ok(0);
        }

        let count = Self::save_todos_to_db(pool, meeting_id, meeting_date, &items).await?;

        info!(
            "Successfully extracted {} todos for meeting: {}",
            count, meeting_id
        );
        Ok(count)
    }

    fn build_extraction_prompt(title: &str, date: &str, transcript: &str) -> (String, String) {
        let system_prompt = r#"You are an action-item extractor. Your task is to read a meeting transcript and extract explicit post-meeting commitments only. Return ONLY a JSON array of objects, each with exactly these fields:
  "text": a clear, self-contained description of the action item (max 120 characters)
  "owner": the person responsible (null if not explicitly stated)
  "deadline": any specific deadline mentioned (null if not stated)

Rules:
- Only extract commitments where someone explicitly says they will do something after this meeting.
- Do NOT extract questions, discussion topics, examples, hypothetical tasks, travel plans, facts, or things someone says they already do.
- Do NOT extract general discussion topics, decisions, opinions, or announcements
- Do NOT invent owners or deadlines
- If nothing qualifies, return an empty array []
- Output ONLY valid JSON. No preamble, no explanation, no markdown fences."#;

        let user_prompt = format!(
            "=== MEETING METADATA ===\nTitle: {}\nDate: {}\n\n=== TRANSCRIPT ===\n{}\n\nExtract explicit post-meeting commitments from the transcript:",
            title, date, transcript
        );

        (system_prompt.to_string(), user_prompt)
    }

    fn parse_extraction_response(raw: &str) -> Result<Vec<ExtractedTodoItem>, String> {
        let cleaned = raw
            .trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        let items: Vec<ExtractedTodoItem> = serde_json::from_str(cleaned)
            .map_err(|e| format!("Failed to parse extraction JSON: {} (response: {})", e, raw))?;

        let filtered: Vec<ExtractedTodoItem> = items
            .into_iter()
            .filter(|i| !i.text.trim().is_empty())
            .collect();

        Ok(filtered)
    }

    fn extract_todo_section_items(notes: &str) -> Vec<ExtractedTodoItem> {
        let mut items = Vec::new();
        let mut in_todo_section = false;
        let mut todo_heading_level = 0usize;

        for line in notes.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }

            if let Some((level, heading)) = Self::parse_heading(trimmed) {
                if in_todo_section && level <= todo_heading_level {
                    in_todo_section = false;
                }

                if Self::is_todo_heading(&heading) {
                    in_todo_section = true;
                    todo_heading_level = level;
                }
                continue;
            }

            if !in_todo_section {
                continue;
            }

            if let Some(text) = Self::normalize_todo_line(trimmed) {
                items.push(ExtractedTodoItem {
                    text,
                    owner: None,
                    deadline: None,
                });
            }
        }

        items
    }

    fn parse_heading(line: &str) -> Option<(usize, String)> {
        let level = line.chars().take_while(|c| *c == '#').count();
        if level == 0 || level > 6 {
            return None;
        }

        let heading = line[level..].trim();
        if heading.is_empty() {
            return None;
        }

        Some((level, heading.to_string()))
    }

    fn is_todo_heading(heading: &str) -> bool {
        let normalized = heading
            .to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { ' ' })
            .collect::<String>();
        let compact = normalized.split_whitespace().collect::<Vec<_>>().join(" ");

        matches!(
            compact.as_str(),
            "todo"
                | "todos"
                | "to do"
                | "to dos"
                | "action item"
                | "action items"
                | "follow up"
                | "follow ups"
                | "followup"
                | "followups"
        )
    }

    fn normalize_todo_line(line: &str) -> Option<String> {
        let mut text = line.trim();

        if let Some(stripped) = text.strip_prefix("- [ ]") {
            text = stripped.trim();
        } else if let Some(stripped) = text.strip_prefix("* [ ]") {
            text = stripped.trim();
        } else if let Some(stripped) = text.strip_prefix("- [x]") {
            text = stripped.trim();
        } else if let Some(stripped) = text.strip_prefix("* [x]") {
            text = stripped.trim();
        } else if let Some(stripped) = text.strip_prefix('-') {
            text = stripped.trim();
        } else if let Some(stripped) = text.strip_prefix('*') {
            text = stripped.trim();
        } else if let Some((prefix, rest)) = text.split_once('.') {
            if prefix.chars().all(|c| c.is_ascii_digit()) {
                text = rest.trim();
            }
        }

        let text = text.trim_matches(|c: char| c == '-' || c == '*' || c.is_whitespace());
        if text.is_empty() {
            None
        } else {
            Some(text.to_string())
        }
    }

    fn clean_optional(value: &Option<String>) -> Option<String> {
        value
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
            .filter(|v| !v.eq_ignore_ascii_case("null"))
            .filter(|v| !v.eq_ignore_ascii_case("none"))
            .map(ToString::to_string)
    }

    async fn save_todos_to_db(
        pool: &sqlx::SqlitePool,
        meeting_id: &str,
        meeting_date: &str,
        items: &[ExtractedTodoItem],
    ) -> Result<usize, String> {
        let new_items: Vec<NewTodoItem> = items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let owner = Self::clean_optional(&item.owner);
                let deadline = Self::clean_optional(&item.deadline);
                let source_text = if let (Some(owner), Some(deadline)) = (&owner, &deadline) {
                    format!("{} (owner: {}, deadline: {})", item.text, owner, deadline)
                } else if let Some(owner) = &owner {
                    format!("{} (owner: {})", item.text, owner)
                } else if let Some(deadline) = &deadline {
                    format!("{} (deadline: {})", item.text, deadline)
                } else {
                    item.text.clone()
                };

                NewTodoItem {
                    meeting_id: Some(meeting_id.to_string()),
                    date: meeting_date.to_string(),
                    content_json: None,
                    content_markdown: Some(source_text.clone()),
                    sort_order: i as i64,
                    source_text: Some(item.text.clone()),
                }
            })
            .collect();

        let count = TodosRepository::batch_insert(pool, &new_items)
            .await
            .map_err(|e| format!("Failed to save extracted todos: {}", e))?;

        Ok(count)
    }
}
