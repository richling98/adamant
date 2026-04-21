use crate::summary::llm_client::{generate_summary, LLMProvider};
use crate::summary::templates;
use once_cell::sync::Lazy;
use regex::Regex;
use reqwest::Client;
use std::path::PathBuf;
use tokio_util::sync::CancellationToken;
use tracing::{error, info};

// Compile regex once and reuse (significant performance improvement for repeated calls)
static THINKING_TAG_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?s)<think(?:ing)?>.*?</think(?:ing)?>").unwrap()
});
static TABLE_SEPARATOR_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^\s*\|?[\s:\-]+(\|[\s:\-]+)+\|?\s*$").unwrap()
});
static MULTI_NEWLINE_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"\n{3,}").unwrap()
});

/// Rough token count estimation using character count
pub fn rough_token_count(s: &str) -> usize {
    let char_count = s.chars().count();
    (char_count as f64 * 0.35).ceil() as usize
}

/// Chunks text into overlapping segments based on token count
/// Uses character-based chunking for proper Unicode support
///
/// # Arguments
/// * `text` - The text to chunk
/// * `chunk_size_tokens` - Maximum tokens per chunk
/// * `overlap_tokens` - Number of overlapping tokens between chunks
///
/// # Returns
/// Vector of text chunks with smart word-boundary splitting
pub fn chunk_text(text: &str, chunk_size_tokens: usize, overlap_tokens: usize) -> Vec<String> {
    info!(
        "Chunking text with token-based chunk_size: {} and overlap: {}",
        chunk_size_tokens, overlap_tokens
    );

    if text.is_empty() || chunk_size_tokens == 0 {
        return vec![];
    }

    // Convert token-based sizes to character-based sizes
    // Using ~2.85 chars per token (inverse of 0.35 tokens per char from rough_token_count)
    let chars_per_token = 1.0 / 0.35;
    let chunk_size_chars = (chunk_size_tokens as f64 * chars_per_token).ceil() as usize;
    let overlap_chars = (overlap_tokens as f64 * chars_per_token).ceil() as usize;

    // Collect characters for indexing (needed for proper Unicode support)
    let chars: Vec<char> = text.chars().collect();
    let total_chars = chars.len();

    if total_chars <= chunk_size_chars {
        info!("Text is shorter than chunk size, returning as a single chunk.");
        return vec![text.to_string()];
    }

    let mut chunks = Vec::new();
    let mut start_char = 0;
    // Step is the size of the non-overlapping part of the window
    let step = chunk_size_chars.saturating_sub(overlap_chars).max(1);

    while start_char < total_chars {
        let end_char = (start_char + chunk_size_chars).min(total_chars);

        // Convert character indices to byte indices for string slicing
        let start_byte: usize = chars[..start_char].iter().map(|c| c.len_utf8()).sum();
        let mut end_byte: usize = chars[..end_char].iter().map(|c| c.len_utf8()).sum();

        // Try to break at sentence or word boundary for cleaner chunks
        if end_char < total_chars {
            let slice = &text[start_byte..end_byte];
            // Look for sentence boundary (period followed by space)
            if let Some(last_period) = slice.rfind(". ") {
                end_byte = start_byte + last_period + 2;
            } else if let Some(last_space) = slice.rfind(' ') {
                // Fall back to word boundary (space)
                end_byte = start_byte + last_space + 1;
            }
        }

        // Extract chunk
        chunks.push(text[start_byte..end_byte].to_string());

        if end_char >= total_chars {
            break;
        }

        // Move to next chunk with overlap (in character units)
        start_char += step;
    }

    info!("Created {} chunks from text", chunks.len());
    chunks
}

/// Cleans markdown output from LLM by removing thinking tags and code fences
///
/// # Arguments
/// * `markdown` - Raw markdown output from LLM
///
/// # Returns
/// Cleaned markdown string
pub fn clean_llm_markdown_output(markdown: &str) -> String {
    // Remove <think>...</think> or <thinking>...</thinking> blocks using cached regex
    let without_thinking = THINKING_TAG_REGEX.replace_all(markdown, "");

    let trimmed = without_thinking.trim();

    // List of possible language identifiers for code blocks
    const PREFIXES: &[&str] = &["```markdown\n", "```\n"];
    const SUFFIX: &str = "```";

    for prefix in PREFIXES {
        if trimmed.starts_with(prefix) && trimmed.ends_with(SUFFIX) {
            // Extract content between the fences
            let content = &trimmed[prefix.len()..trimmed.len() - SUFFIX.len()];
            return convert_markdown_tables_to_bullets(content.trim());
        }
    }

    // If no fences found, return the trimmed string
    convert_markdown_tables_to_bullets(trimmed)
}

fn strip_inline_markdown(text: &str) -> String {
    text
        .replace("**", "")
        .replace('*', "")
        .replace('`', "")
        .replace('_', "")
        .trim()
        .to_string()
}

fn parse_table_row_cells(line: &str) -> Vec<String> {
    let trimmed = line.trim();
    if !trimmed.starts_with('|') || !trimmed.ends_with('|') {
        return Vec::new();
    }

    trimmed
        .trim_matches('|')
        .split('|')
        .map(|cell| cell.trim().to_string())
        .filter(|cell| !cell.is_empty())
        .collect()
}

fn is_markdown_table_row(line: &str) -> bool {
    parse_table_row_cells(line).len() >= 2
}

fn convert_markdown_tables_to_bullets(markdown: &str) -> String {
    let lines: Vec<&str> = markdown.lines().collect();
    let mut converted: Vec<String> = Vec::new();
    let mut i = 0;
    let mut in_code_fence = false;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        if trimmed.starts_with("```") {
            in_code_fence = !in_code_fence;
            converted.push(line.to_string());
            i += 1;
            continue;
        }

        if !in_code_fence && i + 1 < lines.len() {
            let divider = lines[i + 1];
            if is_markdown_table_row(line) && TABLE_SEPARATOR_REGEX.is_match(divider.trim()) {
                let headers: Vec<String> = parse_table_row_cells(line)
                    .into_iter()
                    .map(|header| strip_inline_markdown(&header))
                    .collect();

                i += 2;

                while i < lines.len() && is_markdown_table_row(lines[i]) {
                    let cells = parse_table_row_cells(lines[i]);
                    let mut fields: Vec<String> = Vec::new();

                    for (index, cell) in cells.iter().enumerate() {
                        let value = cell.trim();
                        if value.is_empty() {
                            continue;
                        }

                        let label = headers
                            .get(index)
                            .map(|s| s.as_str())
                            .filter(|label| !label.is_empty())
                            .unwrap_or("Item");

                        fields.push(format!("**{}**: {}", label, value));
                    }

                    if !fields.is_empty() {
                        converted.push(format!("- {}", fields.join("; ")));
                    }

                    i += 1;
                }

                if converted.last().map(|line| !line.is_empty()).unwrap_or(false) {
                    converted.push(String::new());
                }

                continue;
            }
        }

        converted.push(line.to_string());
        i += 1;
    }

    let collapsed = MULTI_NEWLINE_REGEX
        .replace_all(&converted.join("\n"), "\n\n")
        .to_string();

    collapsed.trim().to_string()
}

/// Extracts meeting name from the first heading in markdown
///
/// # Arguments
/// * `markdown` - Markdown content
///
/// # Returns
/// Meeting name if found, None otherwise
pub fn extract_meeting_name_from_markdown(markdown: &str) -> Option<String> {
    markdown
        .lines()
        .find(|line| line.starts_with("# "))
        .map(|line| line.trim_start_matches("# ").trim().to_string())
}

/// Generates a complete meeting summary with conditional chunking strategy
///
/// # Arguments
/// * `client` - Reqwest HTTP client
/// * `provider` - LLM provider to use
/// * `model_name` - Specific model name
/// * `api_key` - API key for the provider
/// * `text` - Full transcript text to summarize
/// * `custom_prompt` - Optional user-provided context
/// * `template_id` - Template identifier (e.g., "daily_standup", "standard_meeting")
/// * `token_threshold` - Token limit for single-pass processing (default 4000)
/// * `ollama_endpoint` - Optional custom Ollama endpoint
/// * `custom_openai_endpoint` - Optional custom OpenAI-compatible endpoint
/// * `max_tokens` - Optional max tokens for completion (CustomOpenAI provider)
/// * `temperature` - Optional temperature (CustomOpenAI provider)
/// * `top_p` - Optional top_p (CustomOpenAI provider)
/// * `app_data_dir` - Optional app data directory (BuiltInAI provider)
/// * `cancellation_token` - Optional cancellation token to stop processing
///
/// # Returns
/// Tuple of (final_summary_markdown, number_of_chunks_processed)
pub async fn generate_meeting_summary(
    client: &Client,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    text: &str,
    custom_prompt: &str,
    template_id: &str,
    token_threshold: usize,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
    app_data_dir: Option<&PathBuf>,
    cancellation_token: Option<&CancellationToken>,
    notes_markdown: Option<&str>,
    meeting_title: Option<&str>,
    meeting_date: Option<&str>,
) -> Result<(String, i64), String> {
    // Check cancellation at the start
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            return Err("Summary generation was cancelled".to_string());
        }
    }
    info!(
        "Starting summary generation with provider: {:?}, model: {}",
        provider, model_name
    );

    let total_tokens = rough_token_count(text);
    info!("Transcript length: {} tokens", total_tokens);

    let content_to_summarize: String;
    let successful_chunk_count: i64;

    // Strategy: Use single-pass for cloud providers or short transcripts
    // Use multi-level chunking for Ollama/BuiltInAI with long transcripts
    // Note: CustomOpenAI is treated like cloud providers (unlimited context)
    if (provider != &LLMProvider::Ollama && provider != &LLMProvider::BuiltInAI) || total_tokens < token_threshold {
        info!(
            "Using single-pass summarization (tokens: {}, threshold: {})",
            total_tokens, token_threshold
        );
        content_to_summarize = text.to_string();
        successful_chunk_count = 1;
    } else {
        info!(
            "Using multi-level summarization (tokens: {} exceeds threshold: {})",
            total_tokens, token_threshold
        );

        // Reserve 300 tokens for prompt overhead
        let chunks = chunk_text(text, token_threshold - 300, 100);
        let num_chunks = chunks.len();
        info!("Split transcript into {} chunks", num_chunks);

        let mut chunk_summaries = Vec::new();
        // Role is "scribe" not "summarizer" — framing matters: a scribe captures everything,
        // a summarizer compresses. We want completeness over brevity.
        let system_prompt_chunk = "You are an expert meeting scribe. Your job is to capture everything — not to condense. Every concept, decision, question, opinion, and detail mentioned must be preserved.";
        let user_prompt_template_chunk = "Transcribe and organize ALL content from the following meeting transcript chunk. Do NOT summarize, condense, or omit anything. Capture every topic discussed, every point raised, every question asked, every decision mentioned, and every detail given — no matter how minor it seems. The raw transcript is disorganized; your job is to make it organized and complete, not shorter.\n\n<transcript_chunk>\n{}\n</transcript_chunk>";

        for (i, chunk) in chunks.iter().enumerate() {
            // Check for cancellation before processing each chunk
            if let Some(token) = cancellation_token {
                if token.is_cancelled() {
                    info!("Summary generation cancelled during chunk {}/{}", i + 1, num_chunks);
                    return Err("Summary generation was cancelled".to_string());
                }
            }

            info!("Processing chunk {}/{}", i + 1, num_chunks);
            let user_prompt_chunk = user_prompt_template_chunk.replace("{}", chunk.as_str());

            match generate_summary(
                client,
                provider,
                model_name,
                api_key,
                system_prompt_chunk,
                &user_prompt_chunk,
                ollama_endpoint,
                custom_openai_endpoint,
                max_tokens,
                temperature,
                top_p,
                app_data_dir,
                cancellation_token,
            )
            .await
            {
                Ok(summary) => {
                    chunk_summaries.push(summary);
                    info!("✓ Chunk {}/{} processed successfully", i + 1, num_chunks);
                }
                Err(e) => {
                    // Check if error is due to cancellation
                    if e.contains("cancelled") {
                        return Err(e);
                    }
                    error!("Failed processing chunk {}/{}: {}", i + 1, num_chunks, e);
                }
            }
        }

        if chunk_summaries.is_empty() {
            return Err(
                "Multi-level summarization failed: No chunks were processed successfully."
                    .to_string(),
            );
        }

        successful_chunk_count = chunk_summaries.len() as i64;
        info!(
            "Successfully processed {} out of {} chunks",
            successful_chunk_count, num_chunks
        );

        // Combine chunk summaries if multiple chunks
        content_to_summarize = if chunk_summaries.len() > 1 {
            info!(
                "Combining {} chunk summaries into cohesive summary",
                chunk_summaries.len()
            );
            let combined_text = chunk_summaries.join("\n---\n");
            // Same scribe framing — combining must not discard any content from any chunk.
            let system_prompt_combine = "You are an expert meeting scribe. Your job is to combine records completely — never discard, compress, or merge details. Every concept from every chunk must appear in the final output.";
            let user_prompt_combine_template = "The following are consecutive detailed records of sections of a meeting. Merge them into a single, well-organized, and fully complete record. Every concept, decision, question, opinion, and detail from EVERY section must be present in the output. Do NOT condense, summarize, or drop anything — if it was in any section record, it must be in the merged output. Organize by topic where natural, but never at the cost of losing content.\n\n<section_records>\n{}\n</section_records>";

            let user_prompt_combine = user_prompt_combine_template.replace("{}", &combined_text);
            generate_summary(
                client,
                provider,
                model_name,
                api_key,
                system_prompt_combine,
                &user_prompt_combine,
                ollama_endpoint,
                custom_openai_endpoint,
                max_tokens,
                temperature,
                top_p,
                app_data_dir,
                cancellation_token,
            )
            .await?
        } else {
            chunk_summaries.remove(0)
        };
    }

    info!("Generating final markdown report with template: {}", template_id);

    // Load the template using the provided template_id
    let template = templates::get_template(template_id)
        .map_err(|e| format!("Failed to load template '{}': {}", template_id, e))?;

    // Generate markdown structure and section instructions using template methods
    let clean_template_markdown = template.to_markdown_structure();
    let section_instructions = template.to_section_instructions();

    let final_system_prompt = "\
You are an expert meeting scribe and editor. Your job is to produce a single, comprehensive, \
highly organized meeting document from a raw transcript and optional handwritten notes.\n\
\n\
This is NOT a brief summary. It is a complete, detailed record of everything discussed — \
written in clean, professional prose with no filler words, no broken speech, and no repetition.\n\
\n\
STEP 1 — UNDERSTAND BEFORE YOU WRITE:\n\
Before organizing anything, read the entire transcript and all notes carefully. Build a complete \
mental picture of what this meeting was about:\n\
- What were the main subjects and goals of the meeting?\n\
- Which parts of the notes directly relate to the transcript, and which parts are independent?\n\
- Where do the notes add context, correct, or expand on what was said in the transcript?\n\
- Where are the notes about something entirely separate from the transcript?\n\
Do not start writing the document until you have a full understanding of how everything fits together.\n\
\n\
STEP 2 — WRITE THE DOCUMENT:\n\
Organize everything into a cohesive, topic-driven document using this structure:\n\
\n\
- Identify all major topics discussed across both the transcript and the notes.\n\
- For each topic, create a bold heading (e.g., **Topic Name**).\n\
- Under each heading, write detailed bullet points covering everything said or noted about that topic.\n\
  - Sub-bullets are encouraged for nested detail (decisions, specifics, open questions).\n\
- Where the transcript and notes cover the same topic, merge them into one cohesive set of bullets — never repeat the same point twice.\n\
- Where notes are about something not in the transcript, include them as their own topic section.\n\
- End with a **Action Items** section listing any tasks, owners, or next steps mentioned.\n\
- End with an **Open Questions** section for anything unresolved or flagged for follow-up.\n\
\n\
RULES:\n\
- Use ONLY information present in the transcript and notes. Never invent or infer anything.\n\
- Treat handwritten notes as authoritative context from the participant.\n\
- Remove all filler words (\"um\", \"uh\", \"you know\", \"like\") and clean up broken speech into readable prose.\n\
- Preserve every substantive topic, decision, name, number, date, question, and detail — even if it seems minor.\n\
- Bullet points only — never use markdown tables.\n\
- If a topic or section has no relevant content, omit it entirely.\n\
- Output ONLY the meeting document. No preamble, no meta-commentary, no sign-off.\
".to_string();

    let title = meeting_title.unwrap_or("Not provided");
    let date = meeting_date.unwrap_or("Not provided");

    // Build user message: content FIRST, then the template to fill.
    // This ordering helps small models: they read the source material before
    // encountering the output structure, so they fill from what they just read.
    let mut final_user_prompt = format!(
        "=== MEETING METADATA ===\nTitle: {title}\nDate: {date}\n=== END MEETING METADATA ===\n\n=== TRANSCRIPT ===\n{transcript}\n=== END TRANSCRIPT ===",
        title = title,
        date = date,
        transcript = content_to_summarize,
    );

    if let Some(notes) = notes_markdown {
        if !notes.trim().is_empty() {
            final_user_prompt.push_str("\n\n=== MY NOTES ===\n");
            final_user_prompt.push_str(notes);
            final_user_prompt.push_str("\n=== END MY NOTES ===");
        }
    }

    if !custom_prompt.is_empty() {
        final_user_prompt.push_str("\n\n=== ADDITIONAL CONTEXT ===\n");
        final_user_prompt.push_str(custom_prompt);
        final_user_prompt.push_str("\n=== END ADDITIONAL CONTEXT ===");
    }

    // Template goes AFTER content — model reads transcript first, then fills the form
    final_user_prompt.push_str("\n\n=== TEMPLATE TO FILL ===\n");
    final_user_prompt.push_str("Using the TRANSCRIPT (and MY NOTES if present) above, fill in every section below.\n");
    final_user_prompt.push_str("Draw from the transcript for the main content. Notes supplement or cross-reference.\n\n");
    final_user_prompt.push_str(&section_instructions);
    final_user_prompt.push('\n');
    final_user_prompt.push_str(&clean_template_markdown);
    final_user_prompt.push_str("\n\nFill in ALL sections now using ONLY content from the transcript and notes above:");

    // Check cancellation before final summary generation
    if let Some(token) = cancellation_token {
        if token.is_cancelled() {
            info!("Summary generation cancelled before final summary");
            return Err("Summary generation was cancelled".to_string());
        }
    }

    let raw_markdown = generate_summary(
        client,
        provider,
        model_name,
        api_key,
        &final_system_prompt,
        &final_user_prompt,
        ollama_endpoint,
        custom_openai_endpoint,
        max_tokens,
        temperature,
        top_p,
        app_data_dir,
        cancellation_token,
    )
    .await?;

    // Clean the output
    let final_markdown = clean_llm_markdown_output(&raw_markdown);

    info!("Summary generation completed successfully");
    Ok((final_markdown, successful_chunk_count))
}
