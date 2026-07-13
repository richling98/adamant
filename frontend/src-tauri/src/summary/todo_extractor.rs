use crate::database::repositories::todos::{NewTodoItem, TodosRepository};
use crate::summary::llm_client::{generate_summary, LLMProvider};
use reqwest::Client;
use std::collections::HashSet;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

const EXTRACTION_MAX_TOKENS: u32 = 4096;
const EXTRACTION_TEMPERATURE: f32 = 0.1;

pub struct TodoExtractor;

#[derive(serde::Deserialize, Debug, Clone)]
struct ExtractedTodoItem {
    text: String,
    #[serde(default)]
    owner: Option<String>,
    #[serde(default)]
    deadline: Option<String>,
    #[serde(default)]
    owner_scope: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    confidence: Option<f32>,
}

#[derive(serde::Deserialize)]
struct ExtractionResponse {
    actions: Vec<ExtractedTodoItem>,
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
        extraction_run_id: &str,
    ) -> Result<usize, String> {
        info!(
            "Todo extraction inputs: meeting={}, model={}, transcript_len={}, notes_markdown={}, notes_len={}",
            meeting_id,
            model_name,
            transcript_text.len(),
            notes_markdown.is_some(),
            notes_markdown.map(str::len).unwrap_or(0)
        );

        let note_items = notes_markdown
            .map(Self::extract_todo_section_items)
            .unwrap_or_default();

        info!(
            "Deterministic parsing result: {} items found from notes for meeting: {}",
            note_items.len(),
            meeting_id
        );

        let mut items = note_items.clone();

        if !transcript_text.trim().is_empty() || notes_markdown.is_some_and(|notes| !notes.trim().is_empty()) {
            let merged_transcript = Self::merge_adjacent_same_speaker_segments(transcript_text);
            let (system_prompt, user_prompt) =
                Self::build_extraction_prompt(title, meeting_date, &merged_transcript, notes_markdown);

            let client = Client::new();

            match generate_summary(
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
            .await
            {
                Ok(raw_response) => {
                    let transcript_items = match Self::parse_extraction_response(&raw_response) {
                        Ok(items) => items,
                        Err(e) if items.is_empty() => return Err(e),
                        Err(e) => {
                            warn!(
                                "Transcript todo response parse failed after notes yielded {} todos for meeting {}: {}",
                                items.len(),
                                meeting_id,
                                e
                            );
                            Vec::new()
                        }
                    };
                    let pre_filter_count = transcript_items.len();
                    let corporate_filtered = Self::filter_llm_items(transcript_items);
                    let corporate_count = corporate_filtered.len();
                    let action_filtered: Vec<_> = corporate_filtered
                        .into_iter()
                        .filter(|item| {
                            if Self::is_explicitly_assigned_to_other(&item.text) {
                                info!("Filtered LLM todo (assigned to another person)");
                                return false;
                            }
                            if !Self::is_llm_user_owned(item) {
                                info!("Filtered LLM todo (explicitly not user-owned)");
                                return false;
                            }
                            true
                        })
                        .collect();
                    info!(
                        "LLM transcript todo extraction: {} raw → {} after corporate filter → {} after ownership filter for meeting: {}",
                        pre_filter_count,
                        corporate_count,
                        action_filtered.len(),
                        meeting_id
                    );
                    items.extend(action_filtered);
                }
                Err(e) if items.is_empty() => return Err(e),
                Err(e) => warn!(
                    "Transcript todo extraction failed after notes yielded {} todos for meeting {}: {}",
                    items.len(),
                    meeting_id,
                    e
                ),
            }
        } else {
            info!(
                "Skipping transcript todo extraction for meeting {} because transcript text is empty",
                meeting_id
            );
        };

        let pre_dedupe_count = items.len();
        items = Self::dedupe_items(items);
        info!(
            "Merged todo extraction for meeting {}: {} note items, {} total before dedupe, {} after dedupe",
            meeting_id,
            note_items.len(),
            pre_dedupe_count,
            items.len()
        );

        let count = Self::save_todos_to_db(
            pool,
            meeting_id,
            meeting_date,
            &items,
            extraction_run_id,
        )
        .await?;

        info!(
            "Successfully extracted {} todos for meeting: {}",
            count, meeting_id
        );
        Ok(count)
    }

    fn build_extraction_prompt(
        title: &str,
        date: &str,
        transcript: &str,
        notes_markdown: Option<&str>,
    ) -> (String, String) {
        let system_prompt = r#"You are a meeting secretary. Find ALL personal action items for the user from the meeting transcript and notes.

[you] marks the user's own speech. Only extract tasks from [you] lines or from manual notes without a named owner.

Extract every task where the user expresses intent to do something: "I have to", "I will", "I need to", "I should", "I want to", "we need to", "we should".

Do NOT extract: facts, opinions, announcements, tasks for other named people, or completed work.

Find EVERY action item. If there are 4 tasks, return all 4.

Return ONLY a JSON array of strings:
["first task", "second task", "third task"]

No preamble. No explanation. No markdown fences."#;

        let notes = notes_markdown.unwrap_or("");
        let user_prompt = format!(
            "=== MEETING METADATA ===\nTitle: {}\nDate: {}\n=== END MEETING METADATA ===\n\n=== MANUAL NOTES ===\n{}\n=== END MANUAL NOTES ===\n\n=== ATTRIBUTED TRANSCRIPT ===\n{}\n=== END ATTRIBUTED TRANSCRIPT ===\n\nExtract only high-confidence action items owned by the Adamant user.",
            title, date, notes, transcript
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

        // Providers occasionally add a short sentence despite the JSON-only
        // instruction. Recover the bounded JSON payload without accepting
        // arbitrary trailing prose.
        let cleaned = if let Some(start) = cleaned.find(|c| c == '{' || c == '[') {
            let opening = cleaned.as_bytes()[start] as char;
            let closing = if opening == '{' { '}' } else { ']' };
            if let Some(end) = cleaned.rfind(closing) {
                &cleaned[start..=end]
            } else {
                cleaned
            }
        } else {
            cleaned
        };

        // Try multiple formats in order of simplicity. Small local models
        // produce the best results with the simplest format (array of strings).
        // Larger models may produce the object format. Support both.
        let items = if cleaned.starts_with('[') {
            // Format 1: ["task 1", "task 2", "task 3"] — simplest, best for
            // small models. We set ownership metadata ourselves.
            match serde_json::from_str::<Vec<String>>(cleaned) {
                Ok(strings) => strings
                    .into_iter()
                    .map(|text| ExtractedTodoItem {
                        text,
                        owner: None,
                        deadline: None,
                        owner_scope: Some("adamant_user".to_string()),
                        source: Some("transcript".to_string()),
                        confidence: Some(0.95),
                    })
                    .collect::<Vec<_>>(),
                Err(_) => {
                    // Maybe it's an array of objects (old format).
                    serde_json::from_str::<Vec<ExtractedTodoItem>>(cleaned)
                        .map_err(|e| format!("Failed to parse extraction JSON: {}", e))?
                }
            }
        } else if cleaned.starts_with('{') {
            // Format 2: {"actions": [...]} — object wrapper.
            serde_json::from_str::<ExtractionResponse>(cleaned)
                .map(|response| response.actions)
                .map_err(|e| format!("Failed to parse extraction JSON: {}", e))?
        } else {
            return Err(format!("Failed to parse extraction JSON: unexpected format"));
        };

        let filtered: Vec<ExtractedTodoItem> = items
            .into_iter()
            .filter(|i| !i.text.trim().is_empty() && i.text.chars().count() <= 120)
            .collect();

        Ok(filtered)
    }

    /// Determine whether an LLM-extracted item belongs to the Adamant user.
    ///
    /// The LLM is the primary intelligent parser. It has already been
    /// instructed to return only user-owned actions. We trust that judgment
    /// and only reject items that *explicitly* declare themselves as not
    /// user-owned. Missing fields (common from smaller local models) default
    /// to accepting the item, since the prompt already constrains the model
    /// to user-owned actions.
    fn is_llm_user_owned(item: &ExtractedTodoItem) -> bool {
        match item.owner_scope.as_deref() {
            // Explicitly not the user — reject.
            Some("other_participant") | Some("other") | Some("unknown") => false,
            // Explicitly the user, or field omitted (trust the prompt).
            _ => true,
        }
    }

    /// Merge adjacent transcript segments from the same speaker into single
    /// lines so the LLM sees complete thoughts rather than fragments — but
    /// ONLY when the previous segment was clearly cut off mid-sentence.
    ///
    /// Whisper segments are split on pauses, so a single sentence like
    /// "I also have to figure out the best way to create a memo for this"
    /// may arrive as two separate `[00:09] [you] ...` lines. This function
    /// reconstructs them.
    ///
    /// However, NOT every adjacent same-speaker segment should be merged.
    /// A segment ending with a period, question mark, or exclamation mark
    /// is a complete thought. Merging it with the next segment creates a
    /// wall of text that small local models struggle to parse, causing them
    /// to miss actions buried in the middle.
    ///
    /// Merge rules:
    ///   1. Same speaker marker (e.g., both [you])
    ///   2. Current text does NOT end with sentence-ending punctuation
    ///   3. Time gap between segments is ≤ 15 seconds
    ///
    /// Example input:
    ///   [00:04] [you] After this meeting
    ///   [00:07] [you] To compile the notes and send them out.
    ///   [00:18] [you] Also make sure Microsoft is updated on our request.
    ///
    /// Example output (first two merge, third stays separate):
    ///   [00:04] [you] After this meeting To compile the notes and send them out.
    ///   [00:18] [you] Also make sure Microsoft is updated on our request.
    fn merge_adjacent_same_speaker_segments(transcript: &str) -> String {
        #[derive(Clone)]
        struct ParsedLine {
            timestamp: String,
            timestamp_seconds: f64,
            speaker: String,
            text: String,
        }

        let parse_line = |line: &str| -> Option<ParsedLine> {
            let trimmed = line.trim();
            // Expected format: [MM:SS] [speaker] text
            let close_bracket = trimmed.find(']')?;
            let timestamp = trimmed[..=close_bracket].to_string();

            // Parse MM:SS to seconds for gap calculation.
            let time_inner = &timestamp[1..timestamp.len() - 1];
            let parts: Vec<&str> = time_inner.split(':').collect();
            let mins: f64 = parts
                .first()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);
            let secs: f64 = parts
                .get(1)
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);
            let timestamp_seconds = mins * 60.0 + secs;

            let rest = trimmed[close_bracket + 1..].trim_start();
            if let Some(second_close) = rest.find(']') {
                let speaker = rest[..=second_close].to_string();
                let text = rest[second_close + 1..].trim().to_string();
                if !text.is_empty() {
                    return Some(ParsedLine {
                        timestamp,
                        timestamp_seconds,
                        speaker,
                        text,
                    });
                }
            }
            None
        };

        // Check whether text ends with sentence-ending punctuation.
        let ends_sentence = |text: &str| -> bool {
            let trimmed = text.trim_end();
            trimmed.ends_with('.') || trimmed.ends_with('?') || trimmed.ends_with('!')
        };

        // Maximum gap (in seconds) to still merge a fragment into the
        // previous segment. A larger gap likely indicates a topic change
        // even if the previous segment lacked ending punctuation.
        const MAX_MERGE_GAP_SECS: f64 = 15.0;

        let lines: Vec<&str> = transcript.lines().collect();
        let mut result: Vec<String> = Vec::new();
        let mut i = 0;

        while i < lines.len() {
            let line = lines[i].trim();
            if line.is_empty() {
                result.push(String::new());
                i += 1;
                continue;
            }

            // Non-transcript lines (headings, etc.) pass through unchanged.
            let Some(parsed) = parse_line(line) else {
                result.push(line.to_string());
                i += 1;
                continue;
            };

            // Greedily merge consecutive same-speaker segments that are
            // clearly mid-sentence continuations. Stop as soon as we hit
            // a complete thought (ending punctuation) or a large gap.
            let mut merged_text = parsed.text.clone();
            let mut last_timestamp_seconds = parsed.timestamp_seconds;
            let mut j = i + 1;

            while j < lines.len() {
                let next_line = lines[j].trim();
                if next_line.is_empty() {
                    j += 1;
                    continue;
                }
                match parse_line(next_line) {
                    Some(next_parsed) if next_parsed.speaker == parsed.speaker => {
                        let gap = next_parsed.timestamp_seconds - last_timestamp_seconds;
                        // Only merge if the current text is mid-sentence
                        // (no ending punctuation) AND the gap is small.
                        if !ends_sentence(&merged_text) && gap <= MAX_MERGE_GAP_SECS {
                            merged_text.push(' ');
                            merged_text.push_str(&next_parsed.text);
                            last_timestamp_seconds = next_parsed.timestamp_seconds;
                            j += 1;
                        } else {
                            break;
                        }
                    }
                    _ => break,
                }
            }

            result.push(format!(
                "{} {} {}",
                parsed.timestamp, parsed.speaker, merged_text
            ));
            i = j;
        }

        result.join("\n")
    }

    /// Post-extraction safety filter for LLM-extracted items.
    ///
    /// This is a NARROW rejection-only safety net. The LLM is the primary
    /// intelligent parser; this filter only catches well-known false-positive
    /// patterns that small models still struggle with. It must NOT reject
    /// legitimate personal tasks like "create a memo", "build a prototype",
    /// or "develop a plan".
    fn filter_llm_items(items: Vec<ExtractedTodoItem>) -> Vec<ExtractedTodoItem> {
        // Only phrases that are unambiguously corporate/M&A strategy, not
        // personal tasks. Kept deliberately small to avoid false negatives.
        const CORPORATE_STRATEGY_PHRASES: &[&str] = &[
            "acquire the company",
            "acquire the firm",
            "take the company private",
            "take the firm private",
            "merge with the company",
            "merge with the firm",
            "buy out the company",
            "buy out the firm",
            "we are acquiring the company",
            "we're acquiring the company",
            "we are buying the company",
            "we're buying the company",
            "we are taking the company private",
            "we're taking the company private",
        ];

        items
            .into_iter()
            .filter(|item| {
                let text_lower = item.text.to_lowercase();

                for phrase in CORPORATE_STRATEGY_PHRASES {
                    if text_lower.contains(phrase) {
                        info!(
                            "Filtered LLM todo (corporate strategy phrase '{}'): {}",
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

        if let Some(action_phrase) = Self::owner_assignment_action_phrase(text_lower) {
            return Self::starts_with_action_verb(action_phrase)
                && !Self::is_obviously_personal_task(action_phrase);
        }

        Self::starts_with_action_verb(text_lower) && !Self::is_obviously_personal_task(text_lower)
    }

    fn starts_with_action_verb(text_lower: &str) -> bool {
        let text_lower = text_lower.trim();

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
                return true;
            }
        }

        false
    }

    fn owner_assignment_action_phrase(text_lower: &str) -> Option<&str> {
        for separator in [",", ":", " - "] {
            if let Some((owner, action)) = text_lower.split_once(separator) {
                let action = action.trim();
                if Self::looks_like_owner(owner) && Self::is_action_phrase_after_owner(action) {
                    return Some(action.strip_prefix("to ").unwrap_or(action).trim());
                }
            }
        }

        if let Some((owner, action)) = text_lower.split_once(" to ") {
            if Self::looks_like_owner(owner) {
                let action = action.trim();
                if Self::starts_with_action_verb(action) {
                    return Some(action);
                }
            }
        }

        None
    }

    fn is_action_phrase_after_owner(action: &str) -> bool {
        let action = action.trim();
        if let Some(stripped) = action.strip_prefix("to ") {
            return Self::starts_with_action_verb(stripped.trim());
        }
        Self::starts_with_action_verb(action)
    }

    fn looks_like_owner(owner: &str) -> bool {
        let owner = owner.trim();
        if owner.is_empty() || owner.len() > 48 {
            return false;
        }

        let words: Vec<&str> = owner.split_whitespace().collect();
        if words.is_empty() || words.len() > 4 {
            return false;
        }

        words.iter().all(|word| {
            let trimmed = word.trim_matches(|c: char| c == ',' || c == ':' || c == '-');
            !trimmed.is_empty()
                && trimmed
                    .chars()
                    .all(|c| c.is_alphabetic() || c == '-' || c == '\'')
        })
    }

    fn dedupe_items(items: Vec<ExtractedTodoItem>) -> Vec<ExtractedTodoItem> {
        let mut seen = HashSet::new();
        let mut deduped = Vec::new();

        for item in items {
            let key = Self::dedupe_key(&item.text);
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            deduped.push(item);
        }

        deduped
    }

    fn dedupe_key(text: &str) -> String {
        text.to_lowercase()
            .chars()
            .map(|c| if c.is_alphanumeric() { c } else { ' ' })
            .collect::<String>()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
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

        PERSONAL_PHRASES
            .iter()
            .any(|phrase| text_lower.contains(phrase))
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
                if Self::is_action_item(&text) && !Self::is_explicitly_assigned_to_other(&text) {
                    items.push(ExtractedTodoItem {
                        text,
                        owner: None,
                        deadline: None,
                        owner_scope: Some("adamant_user".to_string()),
                        source: Some("manual_notes".to_string()),
                        confidence: Some(0.99),
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
                | "action"
                | "actions"
                | "action item"
                | "action items"
                | "takeaway"
                | "takeaways"
                | "next step"
                | "next steps"
                | "follow up"
                | "follow ups"
                | "followup"
                | "followups"
        ) || compact.contains("next step")
            || compact.contains("action")
            || compact.contains("todo")
            || compact.contains("to do")
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

    fn is_explicitly_assigned_to_other(text: &str) -> bool {
        Self::owner_assignment_action_phrase(&text.to_lowercase()).is_some()
    }

    async fn save_todos_to_db(
        pool: &sqlx::SqlitePool,
        meeting_id: &str,
        meeting_date: &str,
        items: &[ExtractedTodoItem],
        extraction_run_id: &str,
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

        let count = TodosRepository::replace_extracted_for_meeting(
            pool,
            meeting_id,
            extraction_run_id,
            &new_items,
        )
            .await
            .map_err(|e| format!("Failed to replace extracted todos: {}", e))?;

        count.ok_or_else(|| "Todo extraction superseded by a newer cleanup run".to_string())
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
    fn manual_notes_todo_filter_excludes_other_people_assignments() {
        let notes = r#"### Takeaways

* Mike, to send us a quick blurb describing the physical AI program.
* Chris, to tell Cha-Cha and Sue Mai about the blurb that Mike sends over.
* Ask for a meeting with Jeff.
* Draft follow-up email and send over.
* The physical AI program was discussed in detail.
* Mike had a useful point about the program.
"#;

        let items = TodoExtractor::extract_todo_section_items(notes);
        let texts: Vec<String> = items.into_iter().map(|item| item.text).collect();

        assert_eq!(
            texts,
            vec![
                "Ask for a meeting with Jeff.".to_string(),
                "Draft follow-up email and send over.".to_string(),
            ]
        );
    }

    #[test]
    fn weekly_team_meeting_combined_heading_extracts_only_user_actions() {
        let notes = r#"### important takeaways

* Q3 revenue was up 23%
* Launch of new product line is key priority for Q4
* Our new CTO is starting next Monday
* Marketing spend has gone down by 15% since last quarter

### next steps and actions

* send followup email to Jane
* send meeting transcript to Ron
* schedule next's week call"#;

        let items = TodoExtractor::extract_todo_section_items(notes);
        let texts: Vec<String> = items.into_iter().map(|item| item.text).collect();

        assert_eq!(
            texts,
            vec![
                "send followup email to Jane".to_string(),
                "send meeting transcript to Ron".to_string(),
                "schedule next's week call".to_string(),
            ]
        );
    }

    #[test]
    fn llm_ownership_trusts_model_unless_explicitly_negative() {
        let user_item = super::ExtractedTodoItem {
            text: "Send the proposal to Maya".to_string(),
            owner: None,
            deadline: None,
            owner_scope: Some("adamant_user".to_string()),
            source: Some("transcript".to_string()),
            confidence: Some(0.98),
        };
        let other_item = super::ExtractedTodoItem {
            owner_scope: Some("other_participant".to_string()),
            ..user_item.clone()
        };
        // Missing owner_scope — should still be accepted (trust the prompt).
        let missing_scope = super::ExtractedTodoItem {
            owner_scope: None,
            source: None,
            confidence: None,
            ..user_item.clone()
        };

        assert!(TodoExtractor::is_llm_user_owned(&user_item));
        assert!(!TodoExtractor::is_llm_user_owned(&other_item));
        assert!(TodoExtractor::is_llm_user_owned(&missing_scope));
    }

    #[test]
    fn parser_accepts_json_object_with_actions_array() {
        let response = r#"Here are the actions:
{"actions":[{"text":"Send the proposal to Maya","owner":null,"deadline":"Friday","owner_scope":"adamant_user","source":"transcript","confidence":0.98}]}"#;

        let items = TodoExtractor::parse_extraction_response(response).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].text, "Send the proposal to Maya");
    }

    #[test]
    fn parser_accepts_simple_string_array() {
        let response = r#"["send debrief email", "schedule follow-up meeting", "align with Microsoft"]"#;

        let items = TodoExtractor::parse_extraction_response(response).unwrap();
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].text, "send debrief email");
        assert_eq!(items[1].text, "schedule follow-up meeting");
        assert_eq!(items[2].text, "align with Microsoft");
        // All items should default to user-owned.
        assert_eq!(items[0].owner_scope.as_deref(), Some("adamant_user"));
    }

    #[test]
    fn merge_adjacent_segments_reconstructs_fragmented_speech() {
        let transcript = r#"## Date: 7/13/2026

[00:03] [you] After this meeting, I have to compile a debrief and send it to John.
[00:09] [you] I also have to figure out the best way to
[00:13] [you] Create a memo for this.
[00:17] [you] I also want to
[00:24] [you] Schedule time for next week as well with this same group of people.
[00:31] [you] And it would be good to figure out the next best steps with Microsoft."#;

        let merged = TodoExtractor::merge_adjacent_same_speaker_segments(transcript);
        let lines: Vec<&str> = merged.lines().collect();

        // The [00:09] and [00:13] segments should be merged into one line
        // because [00:09] ends without punctuation.
        let memo_line = lines.iter().find(|l| l.contains("figure out the best way")).unwrap();
        assert!(memo_line.contains("Create a memo for this"), "Fragmented segments should be merged: {}", memo_line);

        // The [00:17] and [00:24] segments should be merged into one line
        // because [00:17] ends without punctuation.
        let schedule_line = lines.iter().find(|l| l.contains("Schedule time")).unwrap();
        assert!(schedule_line.contains("I also want to"), "Fragmented segments should be merged: {}", schedule_line);

        // [00:03] ends with a period → should NOT merge with [00:09].
        let debrief_line = lines.iter().find(|l| l.contains("compile a debrief")).unwrap();
        assert!(!debrief_line.contains("figure out the best way"), "Complete thoughts should not merge with following segments");

        // [00:31] ends with a period → should stay as its own line.
        let microsoft_line = lines.iter().find(|l| l.contains("Microsoft")).unwrap();
        assert!(!microsoft_line.contains("Schedule time"), "Complete thoughts should not merge with following segments");
    }

    #[test]
    fn merge_preserves_complete_thoughts_as_separate_lines() {
        // This mirrors the user's real failing transcript: multiple [you]
        // segments in a row, but most end with periods and should stay
        // separate so the LLM can parse each action individually.
        let transcript = r#"[00:04] [you] After this meeting
[00:07] [you] To compile the meeting notes in a summary and send it out to all of the participants.
[00:18] [you] Marketing post, and the last thing is make sure that Microsoft is updated on our sponsorship request.
[00:28] [you] Are real and the government should know this."#;

        let merged = TodoExtractor::merge_adjacent_same_speaker_segments(transcript);
        let lines: Vec<&str> = merged.lines().collect();

        // [00:04] has no period → merges with [00:07].
        // [00:07] ends with period → stops merging.
        // [00:18] ends with period → stays separate.
        // [00:28] ends with period → stays separate.
        // Expected: 3 lines.
        assert_eq!(lines.len(), 3, "Expected 3 lines after selective merge, got {}: {:?}", lines.len(), lines);

        // The first line should contain both fragments.
        assert!(lines[0].contains("After this meeting"));
        assert!(lines[0].contains("compile the meeting notes"));

        // The second and third lines should be standalone.
        assert!(lines[1].contains("Marketing post"));
        assert!(lines[2].contains("government should know"));
    }

    #[test]
    fn merge_preserves_different_speakers() {
        let transcript = "[00:03] [you] I will send the email.\n[00:10] [other] Sounds good.\n[00:15] [you] I also need to draft the memo.";

        let merged = TodoExtractor::merge_adjacent_same_speaker_segments(transcript);
        let lines: Vec<&str> = merged.lines().collect();

        // Three distinct speaker segments should remain three lines.
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn owner_assignment_parser_accepts_limited_action_forms() {
        assert!(TodoExtractor::is_action_item(
            "Mike: send us a quick blurb describing the physical AI program."
        ));
        assert!(TodoExtractor::is_action_item(
            "Chris - tell Cha-Cha and Sue Mai about the blurb that Mike sends over."
        ));
        assert!(!TodoExtractor::is_action_item(
            "Mike, the physical AI program was discussed in detail."
        ));
    }

    #[test]
    fn dedupe_items_removes_duplicate_text() {
        let items = vec![
            super::ExtractedTodoItem {
                text: "Ask for a meeting with Jeff.".to_string(),
                owner: None,
                deadline: None,
                owner_scope: Some("adamant_user".to_string()),
                source: Some("manual_notes".to_string()),
                confidence: Some(0.99),
            },
            super::ExtractedTodoItem {
                text: "ask for a meeting with Jeff".to_string(),
                owner: None,
                deadline: None,
                owner_scope: Some("adamant_user".to_string()),
                source: Some("transcript".to_string()),
                confidence: Some(0.98),
            },
        ];

        let deduped = TodoExtractor::dedupe_items(items);
        assert_eq!(deduped.len(), 1);
        assert_eq!(deduped[0].text, "Ask for a meeting with Jeff.");
    }

    #[test]
    fn manual_notes_todo_filter_rejects_clear_personal_activities() {
        assert!(TodoExtractor::is_obviously_personal_task("eat cereal"));
        assert!(TodoExtractor::is_obviously_personal_task(
            "go on run after this meeting"
        ));
        assert!(TodoExtractor::is_obviously_personal_task(
            "go lifting after work"
        ));
        assert!(!TodoExtractor::is_obviously_personal_task(
            "decide on AWS sponsorship or not"
        ));
    }
}
