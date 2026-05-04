# Plan: Fix AI Cleanup Infinite Repetition Bug

## Problem Statement

The AI cleanup feature produces output that repeats the same bullet points hundreds or thousands of times (e.g., "Canopy Festival Logistics", "Canopy Festival Sponsorship", etc.) before the response ends. The resulting document is unusable. This is a catastrophic failure mode, not a quality issue.

---

## Root Cause Analysis

There are **three compounding causes**, all of which need to be fixed:

### Cause 1 — Claude `max_tokens` is hardcoded to 2048 (too small)

**File**: `frontend/src-tauri/src/summary/llm_client.rs`, line 250

```rust
serde_json::json!(ClaudeRequest {
    model: model_name.to_string(),
    max_tokens: 2048,   // ← hardcoded, never configurable
    ...
})
```

2048 tokens is approximately 1,500 words of output — far too little for a comprehensive cleanup of a 27-minute meeting. When Claude hits this limit mid-generation (specifically mid-section in "Topics Covered"), it gets cut off abruptly. The partial response is returned and appears complete to the system, but the content is truncated at whatever point the token budget ran out.

**This alone does not cause repetition**, but it means that the LLM cannot finish generating a proper "Topics Covered" section for a long meeting — the output stops at whatever topic it was enumerating at token 2048.

### Cause 2 — No `max_tokens` cap for Ollama / local models = infinite loops possible

**File**: `frontend/src-tauri/src/summary/llm_client.rs`, lines 223–228

```rust
let (max_tokens_val, temperature_val, top_p_val) = if provider == &LLMProvider::CustomOpenAI {
    (max_tokens, temperature, top_p)
} else {
    (max_tokens, None, None)   // ← max_tokens is whatever came from user settings; could be None
};
```

For Ollama (and other non-CustomOpenAI providers), `max_tokens` passes through from user settings. If the user has not configured it (or it is `None`), there is **no generation limit at all**. Small local models (Gemma, Mistral, Llama) are well-known to get "stuck in a loop" when:
- The context window is near-full (long transcripts + notes + template all in one prompt)
- The output format is repetitive by nature (bullet lists)
- There is no stopping criterion

Once the model enters a repetition loop, it will loop until the 300-second timeout fires. The output at that point is thousands of repeated lines.

### Cause 3 — No repetition detection in post-processing

**File**: `frontend/src-tauri/src/summary/processor.rs`, function `clean_llm_markdown_output` (lines 108–128)

The post-processing step removes thinking tags and code fences, then converts markdown tables to bullet points. It does **not** detect or remove repetitive content. There is no safety net: whatever the LLM returns, the full string is stored and displayed.

If a model loops 500 times, all 500 copies reach the user.

### Cause 4 — Template structure gives the model an ambiguous "fill this in" signal

**File**: `frontend/src-tauri/src/summary/templates/types.rs`, `to_markdown_structure()`

```rust
pub fn to_markdown_structure(&self) -> String {
    let mut markdown = String::new();
    for section in &self.sections {
        markdown.push_str(&format!("**{}**\n\n", section.title));
    }
    markdown
}
```

The template passed to the model is just section headers with empty bodies — nothing between the headers. This works fine for capable cloud models, but smaller local models sometimes misread this as "enumerate all possible sub-topics for each header," which creates an unbounded generation task and increases the probability of looping.

---

## Fix Plan

### Fix 1 — Remove the hardcoded Claude `max_tokens: 2048` limit

**Files to change**: `frontend/src-tauri/src/summary/llm_client.rs`

The Claude request struct uses `max_tokens: 2048`. Replace this with a configurable value, defaulting to `8192` (which handles even long meetings with detailed notes). The `max_tokens` parameter already exists in the function signature for `CustomOpenAI`; extend it to Claude as well.

**Specific change**:
```rust
// Before
serde_json::json!(ClaudeRequest {
    model: model_name.to_string(),
    max_tokens: 2048,
    ...
})

// After
let claude_max_tokens = max_tokens.unwrap_or(8192);
serde_json::json!(ClaudeRequest {
    model: model_name.to_string(),
    max_tokens: claude_max_tokens,
    ...
})
```

This lets the user configure it via settings, or defaults to 8192 tokens (approximately 6,000 words — sufficient for any meeting cleanup).

---

### Fix 2 — Add a default `max_tokens` cap for all non-CustomOpenAI providers

**Files to change**: `frontend/src-tauri/src/summary/llm_client.rs`

For Ollama (and OpenAI, Groq, OpenRouter), add a hard cap of 8192 tokens when no explicit limit is configured. This prevents infinite loops from ever producing a document longer than ~6,000 words.

**Specific change**:
```rust
// Before
let (max_tokens_val, temperature_val, top_p_val) = if provider == &LLMProvider::CustomOpenAI {
    (max_tokens, temperature, top_p)
} else {
    (max_tokens, None, None)
};

// After
const DEFAULT_MAX_TOKENS: u32 = 8192;
let (max_tokens_val, temperature_val, top_p_val) = if provider == &LLMProvider::CustomOpenAI {
    (max_tokens, temperature, top_p)
} else {
    // Apply a default cap to prevent infinite repetition loops on local models
    let capped = Some(max_tokens.unwrap_or(DEFAULT_MAX_TOKENS));
    (capped, None, None)
};
```

---

### Fix 3 — Add repetition detection to `clean_llm_markdown_output`

**Files to change**: `frontend/src-tauri/src/summary/processor.rs`

This is the most important safety net. Regardless of which model or provider is used, the output cleaner should detect consecutive repeated lines and stop at the first repetition cycle. This handles the failure mode where an LLM loops even with `max_tokens` set (which can still happen at the boundary).

**Algorithm**:
1. Split the output into lines.
2. Maintain a sliding window of the last N lines (e.g., 20 lines).
3. If a line has appeared in the window more than once, we have entered a loop.
4. Truncate output at the point where repetition was first detected.
5. Optionally append a note: `_[AI output truncated: repetition detected]_`.

**Specific new function** (add to `processor.rs`):
```rust
/// Detects and removes repetitive loops in LLM output.
/// Uses a sliding window to identify when the LLM has started repeating itself.
fn detect_and_remove_repetition(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() < 20 {
        return text.to_string();
    }

    const WINDOW_SIZE: usize = 20;
    const MAX_REPEATED_THRESHOLD: usize = 3; // If same line appears 3+ times in window, it's a loop

    let mut seen_in_window: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim().to_string();
        if trimmed.is_empty() {
            continue;
        }

        // Slide the window: remove the line that's falling out of it
        if i >= WINDOW_SIZE {
            let falling_out = lines[i - WINDOW_SIZE].trim().to_string();
            if !falling_out.is_empty() {
                let count = seen_in_window.entry(falling_out).or_insert(0);
                if *count > 0 {
                    *count -= 1;
                }
            }
        }

        let count = seen_in_window.entry(trimmed.clone()).or_insert(0);
        *count += 1;

        if *count >= MAX_REPEATED_THRESHOLD {
            // Repetition loop detected — truncate here
            let truncated = lines[..i.saturating_sub(WINDOW_SIZE)].join("\n");
            return format!("{}\n\n_[Note: AI output was truncated because a repetition loop was detected. Try regenerating with a different model or shorter transcript.]_", truncated.trim());
        }
    }

    text.to_string()
}
```

**Call it inside `clean_llm_markdown_output`** before returning:
```rust
pub fn clean_llm_markdown_output(markdown: &str) -> String {
    // ... existing logic ...
    let result = convert_markdown_tables_to_bullets(trimmed);
    detect_and_remove_repetition(&result)  // ← add this
}
```

---

### Fix 4 — Add explicit placeholder text to the template markdown structure

**Files to change**: `frontend/src-tauri/src/summary/templates/types.rs`

The current `to_markdown_structure()` emits just section headers. Add a `[Fill in from transcript and notes]` placeholder under each header. This gives the model a concrete fill-target and reduces the chance it treats the section as an open-ended enumeration task.

**Specific change**:
```rust
// Before
pub fn to_markdown_structure(&self) -> String {
    let mut markdown = String::new();
    for section in &self.sections {
        markdown.push_str(&format!("**{}**\n\n", section.title));
    }
    markdown
}

// After
pub fn to_markdown_structure(&self) -> String {
    let mut markdown = String::new();
    for section in &self.sections {
        markdown.push_str(&format!("**{}**\n\n[Fill in from transcript and notes]\n\n", section.title));
    }
    markdown
}
```

---

### Fix 5 — Add `max_tokens` configuration to the frontend settings UI

**Files to change**: Frontend settings components (wherever the user configures the LLM provider)

Currently the user cannot see or configure `max_tokens` for Claude or Ollama in the UI. Add a visible field (defaulting to 8192) that gets passed through to `api_process_transcript`. This gives power users control, and makes the default visible so they understand why long meetings might be truncated.

This is lower priority than Fixes 1–4 but improves transparency.

---

## Implementation Order

| Priority | Fix | Why First |
|----------|-----|-----------|
| 1 | Fix 3 (repetition detector) | Safety net; stops catastrophic output regardless of model or cause |
| 2 | Fix 1 (Claude max_tokens) | Direct cause for Claude users; simple one-line change |
| 3 | Fix 2 (Ollama max_tokens cap) | Direct cause for local model users; prevents infinite loops |
| 4 | Fix 4 (template placeholder) | Reduces probability of loops in the first place |
| 5 | Fix 5 (UI setting) | Transparency / power user control |

---

## What the Good Output Should Look Like

For reference, a correctly generated cleanup of the Canopy Festival meeting should look like:

```markdown
**Complete Overview**

- Meeting focused on a potential NVIDIA sponsorship of the Canopy Festival (May 22, 4–8 PM, Fort Mason), hosted by Founders Inc.
- Founders Inc. is an incubator/accelerator running programs: Artifact → Canopy → Off-season → Blueprint (October)
- Cohort tracks: Physical AI, AI Agent Software, and a new Creators track (~60 teams per track, ~1–2 founders per team)
- Current Canopy cohort starts April 15; festival on May 22

**Topics Covered**

- **Canopy Festival sponsorship**: Flat fee of $30K. Sponsors get a branded station in Building C (entertainment/food area). Mercury has a dessert station; NVIDIA would get a "NVIDIA Cafe" station.
  - 3 sponsors confirmed; deadline to close is end of next week
  - Current partner categories: banking (Mercury), database, data analytics, AI (talking to OpenAI/Anthropic/Cursor), legal
- **Canopy Festival audience**: 1,500–3,000 expected; 1,500 attended last festival (200 investors, ~1,000 other founders, rest general public)
...

**Next Steps & Action Items**

- Richard to escalate sponsorship internally via marketing development funds (MDF) before end of next week
- Richard to send Founders Inc. two-pager to relevant internal stakeholders
- Mike to send video/content of Mythbusters cast member garage tour for physical AI team
- Richard to provide a list of NVIDIA attendees to guarantee festival access
- Richard to explore guest speaker slot (Nader or similar) for Thursday cohort sessions
```

---

## Files Changed Summary

| File | Change |
|------|--------|
| `frontend/src-tauri/src/summary/llm_client.rs` | Fix 1: Use `max_tokens.unwrap_or(8192)` for Claude. Fix 2: Apply 8192 token cap for all non-CustomOpenAI providers. |
| `frontend/src-tauri/src/summary/processor.rs` | Fix 3: Add `detect_and_remove_repetition()` function; call it from `clean_llm_markdown_output`. |
| `frontend/src-tauri/src/summary/templates/types.rs` | Fix 4: Add `[Fill in from transcript and notes]` placeholder to `to_markdown_structure()`. |
| Frontend settings UI components | Fix 5: Expose `max_tokens` field in LLM settings. |

---

## Testing Plan

1. **Repetition regression test**: Feed the exact transcript + notes from the Canopy Festival meeting through the cleanup pipeline using Claude. Confirm the output is coherent and non-repetitive.
2. **Ollama loop test**: Use a small Ollama model (e.g., `llama3.2:3b`) with a long transcript (>4000 tokens). Confirm the repetition detector fires before the output becomes unusable, and the truncation note is shown.
3. **Claude max_tokens test**: Use Claude with a 27-minute meeting transcript and confirm the output is complete (all three sections filled out, not cut off mid-section).
4. **Short meeting baseline**: Confirm that a short meeting (5 minutes, <500 tokens) still produces a clean, full output with no truncation note.
