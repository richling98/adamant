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
            "Todo extraction inputs: meeting={}, model={}, transcript_len={}, notes_markdown={}, notes_len={}",
            meeting_id,
            model_name,
            transcript_text.len(),
            notes_markdown.is_some(),
            notes_markdown.map(str::len).unwrap_or(0)
        );

        if let Some(notes) = notes_markdown {
            let preview_len = notes.len().min(300);
            info!(
                "Notes markdown preview (first {} chars): {:?}",
                preview_len,
                &notes[..preview_len]
            );
        }

        let note_items = notes_markdown
            .map(Self::extract_todo_section_items)
            .unwrap_or_default();

        info!(
            "Deterministic parsing result: {} items found from notes for meeting: {}",
            note_items.len(),
            meeting_id
        );

        for (i, item) in note_items.iter().enumerate() {
            info!("  Note todo item {}: {}", i, item.text);
        }

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
            let pre_filter_count = transcript_items.len();
            let corporate_filtered = Self::filter_llm_items(transcript_items);
            let corporate_count = corporate_filtered.len();
            let action_filtered: Vec<_> = corporate_filtered
                .into_iter()
                .filter(|item| {
                    if Self::is_action_item(&item.text) {
                        true
                    } else {
                        info!(
                            "Filtered LLM todo (not an action item): {}",
                            item.text
                        );
                        false
                    }
                })
                .collect();
            info!(
                "LLM transcript todo extraction: {} raw → {} after corporate filter → {} after action-item filter for meeting: {}",
                pre_filter_count,
                corporate_count,
                action_filtered.len(),
                meeting_id
            );
            action_filtered
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
        let system_prompt = r#"You are an action-item extractor for personal to-do lists. Your task is to read a meeting transcript and extract ONLY unambiguous, explicit post-meeting action items that a meeting participant needs to do after this meeting.

Return ONLY a JSON array of objects, each with exactly these fields:
  "text": a clear, self-contained description of the action item (max 120 characters)
  "owner": the person responsible (null if not explicitly stated)
  "deadline": any specific deadline mentioned (null if not stated)

STRICT INCLUSION CRITERIA -- the item MUST meet ALL of these:
1. Someone explicitly uses commitment language: "I will", "I need to", "I should", "let's make sure to", "remind me to", "after this meeting I'll", "I plan to", "we need to", "I'm going to" (in the context of a personal task, not a corporate strategy)
2. The action is something a meeting participant would personally do after the meeting (e.g., "email John", "research X", "follow up with Y", "schedule a meeting with Z")
3. The action is NOT already happening -- it's a future task

ABSOLUTE EXCLUSIONS -- never extract these:
- Business strategies, corporate plans, or company operations ("we're investing in insurance", "we're building a Berkshire-like entity", "we're buying a company")
- Things companies are doing as part of their business ("they are acquiring Vantage", "the transaction should close next month")
- Discussion topics, opinions, facts, or announcements
- Questions, hypothetical scenarios, or examples
- Things someone says they already do or have done
- General statements about plans without explicit personal commitment language

When in doubt, leave it out. An empty array is always better than a false positive.

Output ONLY valid JSON. No preamble, no explanation, no markdown fences."#;

        let user_prompt = format!(
            "=== MEETING METADATA ===\nTitle: {}\nDate: {}\n\n=== TRANSCRIPT ===\n{}\n\nExtract ONLY unambiguous, explicit post-meeting action items that a meeting participant personally needs to do. If none qualify, return []:",
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

    /// Post-extraction safety filter for LLM-extracted items.
    /// Rejects common false-positive patterns where the LLM mistakes
    /// business strategies or corporate actions for personal to-dos.
    fn filter_llm_items(items: Vec<ExtractedTodoItem>) -> Vec<ExtractedTodoItem> {
        const CORPORATE_ACTION_PREFIXES: &[&str] = &[
            "invest in",
            "build a",
            "build an",
            "buy a",
            "buy an",
            "acquire",
            "merge with",
            "develop a",
            "develop an",
            "launch a",
            "launch an",
            "create a",
            "create an",
            "establish a",
            "establish an",
            "form a",
            "form an",
            "take private",
            "take the company private",
        ];

        const CORPORATE_CONTEXT_PHRASES: &[&str] = &[
            "the company will",
            "the firm will",
            "pershing square will",
            "howard hughes will",
            "we are buying",
            "we're buying",
            "we are building",
            "we're building",
            "we are investing",
            "we're investing",
            "we are acquiring",
            "we're acquiring",
        ];

        items
            .into_iter()
            .filter(|item| {
                let text_lower = item.text.to_lowercase();

                for pattern in CORPORATE_ACTION_PREFIXES {
                    if text_lower.starts_with(pattern) {
                        info!(
                            "Filtered LLM todo (corporate action prefix '{}'): {}",
                            pattern, item.text
                        );
                        return false;
                    }
                }

                for phrase in CORPORATE_CONTEXT_PHRASES {
                    if text_lower.contains(phrase) {
                        info!(
                            "Filtered LLM todo (corporate context phrase '{}'): {}",
                            phrase, item.text
                        );
                        return false;
                    }
                }

                true
            })
            .collect()
    }

    /// Check whether a normalized to-do line is actually an action item.
    ///
    /// A real to-do starts with an action verb in imperative mood
    /// (e.g., "research", "find out", "email", "call", "schedule").
    /// Questions, statements, and meta-commentary are rejected.
    ///
    /// Golden rule: when in doubt, leave it out.
    fn is_action_item(text: &str) -> bool {
        let text_lower = text.to_lowercase();
        let text_lower = text_lower.trim();

        if text_lower.is_empty() {
            return false;
        }

        // --- REJECT: Meta-commentary about to-dos ---
        const META_PHRASES: &[&str] = &[
            "not a to do",
            "not a todo",
            "not an action item",
            "not a to-do",
            "don't put",
            "do not put",
            "please don't",
            "please do not",
            "this is not",
            "this isn't",
            "ignore this",
            "skip this",
        ];
        for phrase in META_PHRASES {
            if text_lower.contains(phrase) {
                return false;
            }
        }

        // --- REJECT: Questions ---
        // Lines ending with "?" are questions, not action items.
        if text_lower.ends_with('?') {
            return false;
        }
        // Lines starting with question words are questions.
        const QUESTION_STARTERS: &[&str] = &[
            "why",
            "how",
            "what",
            "when",
            "where",
            "who",
            "which",
            "whose",
            "is ",
            "are ",
            "was ",
            "were ",
            "do ",
            "does ",
            "did ",
            "can ",
            "could ",
            "should ",
            "would ",
            "will ",
            "won't ",
            "isn't",
            "aren't",
            "wasn't",
            "weren't",
            "don't",
            "doesn't",
            "can't",
            "cannot",
            "couldn't",
            "shouldn't",
            "wouldn't",
            "what's",
            "whats",
            "where's",
            "wheres",
            "who's",
            "whos",
        ];
        for starter in QUESTION_STARTERS {
            if text_lower.starts_with(starter) {
                return false;
            }
        }

        // --- ACCEPT: Lines starting with known action verbs/phrases ---
        const ACTION_VERBS: &[&str] = &[
            // Research / learning
            "research",
            "find out",
            "figure out",
            "look into",
            "investigate",
            "learn",
            "study",
            "explore",
            "read",
            "watch",
            "listen",
            // Communication
            "email",
            "call",
            "text",
            "contact",
            "reach out",
            "message",
            "notify",
            "tell",
            "ask",
            "remind",
            "follow up",
            "reply",
            "respond",
            "send",
            "share",
            "forward",
            "distribute",
            "post",
            // Scheduling / planning
            "schedule",
            "book",
            "set up",
            "arrange",
            "plan",
            "organize",
            "prepare",
            "draft",
            "write",
            "create",
            "make",
            "build",
            "design",
            "develop",
            "outline",
            "brainstorm",
            "sketch",
            // Review / verification
            "review",
            "check",
            "verify",
            "confirm",
            "test",
            "audit",
            "inspect",
            "examine",
            "analyze",
            "evaluate",
            "assess",
            "compare",
            "measure",
            "calculate",
            "compute",
            // Decisions / choices
            "decide",
            "decide on",
            "decide whether",
            "choose",
            "pick",
            "determine",
            "select",
            "consider",
            "weigh",
            // Task completion
            "complete",
            "finish",
            "submit",
            "deliver",
            "update",
            "fix",
            "repair",
            "resolve",
            "address",
            "solve",
            "clean",
            "wash",
            "pack",
            "move",
            "install",
            "configure",
            "deploy",
            "refactor",
            "rename",
            "delete",
            "remove",
            "add",
            "implement",
            "integrate",
            "migrate",
            "backup",
            "restore",
            "export",
            "import",
            "convert",
            "format",
            "edit",
            "proofread",
            "translate",
            "transcribe",
            "summarize",
            "compile",
            "gather",
            "collect",
            "sort",
            "fill",
            "print",
            "scan",
            "copy",
            "download",
            "upload",
            // Acquisition
            "get",
            "buy",
            "order",
            "purchase",
            "obtain",
            "acquire",
            // Reminders / intention
            "remember to",
            "don't forget to",
            "make sure to",
            "need to",
            "have to",
            "got to",
            // Scheduling actions
            "cancel",
            "postpone",
            "reschedule",
            "register",
            "sign up",
            "enroll",
            "apply",
            "request",
            "subscribe",
            "unsubscribe",
            "join",
            "leave",
            "start",
            "stop",
            "pause",
            "resume",
            "begin",
            "end",
            "close",
            "open",
            "save",
            "load",
            "find",
            "search",
            "replace",
            "connect",
            "disconnect",
            "attach",
            "detach",
            "mount",
            "unmount",
            "lock",
            "unlock",
            // Practice / training
            "practice",
            "train",
            "exercise",
            "rehearse",
            // Misc actions
            "announce",
            "publish",
            "launch",
            "renew",
            "refund",
            "return",
            "exchange",
            "upgrade",
            "downgrade",
            "uninstall",
            "pair",
            "unpair",
            "link",
            "unlink",
        ];
        for verb in ACTION_VERBS {
            if text_lower.starts_with(verb) {
                return !Self::is_obviously_personal_task(text_lower);
            }
        }

        // --- DEFAULT: Reject ---
        // If the line doesn't start with a known action verb and doesn't
        // match any rejection pattern, default to rejecting it.
        // "When in doubt, leave it out."
        false
    }

    /// Reject clearly personal/off-topic items that are not meeting-relevant
    /// action items, even if they superficially look imperative.
    fn is_obviously_personal_task(text_lower: &str) -> bool {
        const PERSONAL_PHRASES: &[&str] = &[
            "eat cereal",
            "eat breakfast",
            "eat lunch",
            "eat dinner",
            "go on run",
            "go running",
            "go lifting",
            "lift weights",
            "go to the gym",
            "work out",
            "workout",
            "do laundry",
            "wash dishes",
            "buy groceries",
            "go shopping",
            "take a nap",
            "go to sleep",
            "watch tv",
            "play video games",
        ];

        PERSONAL_PHRASES.iter().any(|phrase| text_lower.contains(phrase))
    }

    fn extract_todo_section_items(notes: &str) -> Vec<ExtractedTodoItem> {
        let mut items = Vec::new();
        let mut in_todo_section = false;
        let mut todo_heading_level = 0usize;
        let mut total_lines = 0usize;

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
                total_lines += 1;
                if Self::is_action_item(&text) {
                    items.push(ExtractedTodoItem {
                        text,
                        owner: None,
                        deadline: None,
                    });
                } else {
                    info!(
                        "Rejected non-action-item line from todo section: {:?}",
                        text
                    );
                }
            }
        }

        info!(
            "Todo section parsing: {} lines found, {} accepted as action items, {} rejected",
            total_lines,
            items.len(),
            total_lines.saturating_sub(items.len())
        );

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

#[cfg(test)]
mod tests {
    use super::TodoExtractor;

    #[test]
    fn manual_notes_todo_filter_accepts_relevant_decision_items() {
        let notes = r#"### logistics of startup booths

* contract = with AWS, but the contract is with AWS and the startup

### to dos

* write followup email

* eat cereal

* go on run after this meeting

* george washington was president

* write followup email

* decide on AWS sponsorship or not

* figure out openAI partnership

* go lifting after work

* why is chicken tasty?"#;

        let items = TodoExtractor::extract_todo_section_items(notes);
        let texts: Vec<String> = items.into_iter().map(|item| item.text).collect();

        assert_eq!(
            texts,
            vec![
                "write followup email".to_string(),
                "write followup email".to_string(),
                "decide on AWS sponsorship or not".to_string(),
                "figure out openAI partnership".to_string(),
            ]
        );
    }

    #[test]
    fn manual_notes_todo_filter_rejects_clear_personal_activities() {
        assert!(TodoExtractor::is_obviously_personal_task("eat cereal"));
        assert!(TodoExtractor::is_obviously_personal_task("go on run after this meeting"));
        assert!(TodoExtractor::is_obviously_personal_task("go lifting after work"));
        assert!(!TodoExtractor::is_obviously_personal_task("decide on AWS sponsorship or not"));
    }
}
