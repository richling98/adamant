# Adamant Intelligent Chatbot Assistant — Deep Dive

> A detailed walkthrough of how the "Chat with your meetings" feature works end-to-end.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Frontend: The Floating Chat Bubble](#2-frontend-the-floating-chat-bubble)
3. [Tauri IPC Boundary](#3-tauri-ipc-boundary)
4. [Rust Chat Handler (The Brain)](#4-rust-chat-handler-the-brain)
5. [Context Retrieval: FTS5 Search](#5-context-retrieval-fts5-search)
6. [LLM Client: Multi-Provider Abstraction](#6-llm-client-multi-provider-abstraction)
7. [Full Data Flow (Step by Step)](#7-full-data-flow-step-by-step)
8. [Key Design Decisions & Limitations](#8-key-design-decisions--limitations)
9. [File Reference](#9-file-reference)

---

## 1. High-Level Architecture

The chatbot follows a **three-tier architecture** but with a twist: unlike most Adamant features that go through the Python FastAPI backend, the chatbot is implemented entirely in the **Rust/Tauri layer**. This makes it more responsive and works fully offline with local models.

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND (TypeScript/React)                        │
│  ┌──────────────────────────────────────────────┐   │
│  │  FloatingChatBubble.tsx                       │   │
│  │  ├─ UI: message list, input, empty state      │   │
│  │  └─ useMeetingChat.ts (hook)                  │   │
│  │     └─ invoke('api_chat_with_meetings', …)    │   │
│  └──────────────────────┬───────────────────────┘   │
├─────────────────────────┼───────────────────────────┤
│  TAURI IPC              │                           │
├─────────────────────────┼───────────────────────────┤
│  RUST LAYER             ▼                           │
│  ┌──────────────────────────────────────────────┐   │
│  │  api.rs: api_chat_with_meetings (command)     │   │
│  └──────────────────┬───────────────────────────┘   │
│                     ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │  chat/handler.rs: chat_with_meetings          │   │
│  │  ├─ 1. Read model config from SQLite          │   │
│  │  ├─ 2. Fetch meetings from SQLite             │   │
│  │  ├─ 3. Infer date range from query text       │   │
│  │  ├─ 4. Run FTS5 keyword search                │   │
│  │  ├─ 5. Select relevant meetings               │   │
│  │  ├─ 6. Build meeting context blocks           │   │
│  │  │     (transcripts + notes + summaries,      │   │
│  │  │      capped by character budgets)          │   │
│  │  ├─ 7. Build system prompt + user prompt      │   │
│  │  └─ 8. Call LLM via generate_summary()        │   │
│  └──────────────────┬───────────────────────────┘   │
│                     ▼                                │
│  ┌──────────────────────────────────────────────┐   │
│  │  summary/llm_client.rs: generate_summary      │   │
│  │  ├─ Routes to the right provider              │   │
│  │  ├─ Builds API request body                   │   │
│  │  ├─ Sends HTTP request (or runs BuiltInAI)    │   │
│  │  ├─ Parses response                           │   │
│  │  └─ Returns text or error                     │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

The **Python FastAPI backend is not involved** in chat at all. The chatbot reuses the same LLM provider infrastructure as the meeting summary feature — they share the same model configuration, API keys, and `generate_summary()` function.

---

## 2. Frontend: The Floating Chat Bubble

### Component: `FloatingChatBubble.tsx`

A **non-modal floating panel** mounted in `layout.tsx` (inside `RecordingPostProcessingProvider`), so it's available app-wide.

**Trigger button**: A 🧙‍♂️ wizard emoji button fixed to the bottom-right corner. When clicked, it opens a 520×384px panel with a pop-in animation.

**The panel has four zones**:

#### A. Header
- Title: "Chat with your meetings"
- Subtitle: "Ask anything about your notes"
- Two buttons: Clear history (trash icon) and Close (X icon)

#### B. Message area (scrollable)
- **Empty state**: When `messages.length === 0`, shows the wizard greeting plus three example prompt buttons:
  - "Summarize my meetings from the past week"
  - "What action items came up across my meetings?"
  - "Who did I meet with most recently?"
- **Message bubbles**: User messages are right-aligned (emerald green), assistant messages are left-aligned (zinc-800). User messages are plain text; assistant messages are rendered as **Markdown** via `react-markdown` with `remark-gfm` (GitHub Flavored Markdown). The Markdown renderer has custom components for headings, lists, code blocks, and emphasis — so responses with bold, bullet points, and code snippets display properly.
- **Loading state**: Three bouncing dots with staggered animation delays.
- **Auto-scroll**: An invisible anchor div at the bottom; `useEffect` calls `scrollIntoView({ behavior: 'smooth' })` on every message or loading state change.

#### C. Input area
- A single-line `textarea` with auto-growing height (up to 120px).
- **Enter** sends, **Shift+Enter** inserts a newline.
- Send button has an emerald-400 icon, disabled when input is empty or loading.
- The textarea auto-focuses when the panel opens (with a 150ms delay).

#### D. Click-outside-to-close
A `pointerdown` event listener on `document` checks if the click is outside the panel ref. If so, it closes the panel.

### Hook: `useMeetingChat.ts`

This hook manages all chat state in-memory (no persistence across app restarts).

```typescript
interface UseMeetingChatReturn {
  messages: ChatMessage[];      // { role: 'user' | 'assistant', content: string }
  isLoading: boolean;
  sendMessage: (text: string, dateRangeDays?: number) => Promise<void>;
  clearHistory: () => void;
}
```

**`sendMessage` flow:**
1. Guards against empty text or concurrent requests.
2. **Optimistically appends** the user's message to `messages[]` (so the UI feels instant).
3. Sets `isLoading = true`.
4. Calls `invoke('api_chat_with_meetings', { message, history, dateRangeDays })`.
   - The `history` parameter is the current `messages[]` array **before** appending the new user message — this gives the backend the full conversation context.
5. On success: appends the assistant's response to `messages[]`.
6. On error: appends an error message prefixed with ⚠️.
7. Sets `isLoading = false`.

**Important**: The `sendMessage` function has a `useCallback` dependency on `messages` and `isLoading`. This means the function reference changes every time `messages` changes, which is fine for the component's usage pattern but worth noting for performance.

---

## 3. Tauri IPC Boundary

### Command Definition (`api.rs:2085`)

```rust
#[tauri::command]
pub async fn api_chat_with_meetings<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, AppState>,
    message: String,                       // User's current message
    history: Vec<ChatMessage>,             // Previous conversation turns
    date_range_days: Option<i64>,          // Optional date filter
) -> Result<String, String>               // Returns the AI response text
```

- Registered in `lib.rs:755` inside the Tauri `invoke_handler`.
- Resolves `app_data_dir` from the app handle (needed for the BuiltInAI provider, which runs a local sidecar).
- Delegates immediately to `chat::handler::chat_with_meetings()`.
- The return type is `Result<String, String>` — no streaming. The entire LLM response is awaited before returning to the frontend.

### Communication Pattern

```
Frontend                          Rust
   │                                │
   │  invoke('api_chat_with_       │
   │    meetings', {message,        │
   │    history, dateRangeDays})    │
   │──────────────────────────────►│
   │                                │
   │         [LLM call happens]     │
   │                                │
   │◄──────────────────────────────│
   │  Result<String, String>        │
```

No WebSocket, no HTTP, no events — just a single Tauri command call. This is a request-response pattern, not a streaming one.

---

## 4. Rust Chat Handler (The Brain)

**File**: `frontend/src-tauri/src/chat/handler.rs` (509 lines)

This is the core orchestration function. Here is exactly what it does, step by step:

### Step 1: Fetch Model Configuration
```rust
let setting = SettingsRepository::get_model_config(&pool).await?;
let provider = LLMProvider::from_str(&setting.provider)?;
let api_key = SettingsRepository::get_api_key(&pool, &setting.provider).await?;
```

Reads from the SQLite `settings` table. Supports 8 providers:
- `openai`, `claude`, `groq`, `ollama`, `openrouter`, `builtin-ai`, `custom-openai`, `nvidia-inference`

For `custom-openai`, it also fetches the custom endpoint config (endpoint URL, optional `max_tokens`, `temperature`, `top_p` overrides).

### Step 2: Fetch and Filter Meetings
```rust
let all_meetings = MeetingsRepository::get_meetings(&pool).await?;
```

Fetches **all** meetings from the `meetings` table. No pagination or limit here — every meeting in the database is a candidate.

### Step 3: Infer Date Range (Optional)
```rust
let effective_date_range_days = date_range_days.or_else(|| infer_date_range_days(message));
```

The `infer_date_range_days()` function parses natural language from the user's message:

| Phrase detected | `date_range_days` |
|---|---|
| "today" | `Some(1)` |
| "yesterday" | `Some(2)` |
| "past week" / "last week" / "this week" | `Some(7)` |
| "past month" / "last month" / "this month" | `Some(31)` |
| None of the above | `None` (no date filter) |

This means "summarize today's meetings" automatically filters to last 1 day, while "what did we decide about the API?" searches all meetings.

The user can also pass `dateRangeDays` explicitly from the frontend (though the current UI doesn't expose this — the parameter is there for future use).

### Step 4: Run FTS5 Keyword Search
```rust
let search_results = crate::search::fts::search_fts(pool, message).await?;
```

This is the **retrieval** step. It searches the `meeting_search_fts` virtual table using the user's message as a query. (Detailed in [Section 5](#5-context-retrieval-fts5-search).)

If the FTS search fails for any reason, it logs a warning and returns an empty vector — the handler gracefully falls back to recent meetings.

### Step 5: Select Relevant Meetings

Two-strategy selection:

**Primary strategy (FTS relevance):**
- Takes the top `MAX_RETRIEVAL_RESULTS` (10) FTS hits that are within the date-filtered set.
- Deduplicates by meeting ID.
- If this produces results, the strategy is labeled `"fts-relevance"`.

**Fallback strategy (recent meetings):**
- If no FTS matches were found (or they were all outside the date range), takes the first `FALLBACK_RECENT_MEETINGS` (8) meetings from the date-filtered set.
- Strategy is labeled `"recent-fallback"`.

### Step 6: Build Meeting Context Blocks

For each selected meeting, the handler fetches:

| Data | Source | Cap |
|---|---|---|
| **Transcript text** | `transcripts` table (up to 500 segments, joined with spaces) | 1,600 chars |
| **User notes** | `meeting_notes` table (`notes_markdown` column) | 2,200 chars |
| **AI summary** | `summary_processes` table (where `status = 'completed'`) | 2,000 chars |

Each meeting produces a formatted block like:

```
## Meeting: {title}
Date: {date}

Matched context:
{search snippet — e.g. "transcript match: decided to...delayed"}

### Saved AI Summary:
{summary_text}

### Notes:
{notes_text}

### Transcript Excerpt:
{transcript_text}
```

**Content budget management** (critical for fitting in context windows):

| Constant | Value | Purpose |
|---|---|---|
| `MAX_CONTEXT_CHARS` | 60,000 | Total budget across all meetings (~15k tokens) |
| `MAX_MEETING_BLOCK_CHARS` | 6,000 | Per-meeting cap, applied after assembling the block |
| `MAX_SUMMARY_CHARS_PER_MEETING` | 2,000 | Summary text limit |
| `MAX_NOTES_CHARS_PER_MEETING` | 2,200 | Notes text limit |
| `MAX_TRANSCRIPT_CHARS_PER_MEETING` | 1,600 | Transcript text limit |

The `truncate_at_word_boundary()` function ensures clean cuts at word boundaries (appends "`... [truncated]`" when truncation occurs).

Meetings with **no usable content** (no transcript, no notes, no summary) are skipped entirely.

### Step 7: Build the Prompts

**System prompt** (about 3 lines):
```
You are a helpful AI assistant with access to the user's meeting content.
Today is {day_of_week, Month DD, YYYY}.
Answer the user's questions based on the meeting content (transcripts and notes) provided below.
Be concise and cite specific meetings when relevant.

---
MEETING CONTENT:

{all_meeting_blocks}
---
```

**User prompt** — embeds conversation history as a formatted block:
```
User: previous question
Assistant: previous response
User: current question
```

If there's no history, the user prompt is just the current message.

This approach works around the fact that `generate_summary()` (the shared LLM function) only accepts a system+user prompt pair, not a full messages array. History is flattened into the user prompt text.

### Step 8: Call the LLM

```rust
let chat_max_tokens = custom_config
    .and_then(|c| c.max_tokens.map(|v| v as u32))
    .unwrap_or(1024);

let response = generate_chat_response_with_retry(
    &client, &provider, &setting.model, &api_key,
    &system_prompt, &user_prompt,
    ollama_endpoint, custom_openai_endpoint,
    Some(chat_max_tokens), temperature, top_p,
    app_data_dir,
).await?;
```

**Retry logic**: If the LLM returns an empty response, it retries **once** with an added instruction:
```
Return a concise answer in plain text. Do not return an empty response.
```
If both attempts fail, it returns a user-facing error message.

### Helper Functions

- `capitalise(s)` — Uppercases the first character (used in history formatting).
- `strip_search_markup(snippet)` — Removes `<b>` and `</b>` highlight tags from FTS snippets before including them in the context.
- `append_capped_section(block, label, content, max_chars)` — Appends a `### {label}:\n{truncated_content}\n\n` section to a meeting block.
- `truncate_at_word_boundary(content, max_chars)` — Truncates at the last space before `max_chars`, appending `"… [truncated]"`.

---

## 5. Context Retrieval: FTS5 Search

**File**: `frontend/src-tauri/src/search/fts.rs` (254 lines)

### Index Structure

An FTS5 virtual table (`meeting_search_fts`) with four indexed columns plus one unindexed ID:

| Column | Source | Weight (BM25) |
|---|---|---|
| `meeting_id` (UNINDEXED) | — | — |
| `title` | `meetings.title` | ×4 |
| `transcript_text` | `GROUP_CONCAT(transcripts.transcript, ' ')` | ×2 |
| `notes_text` | `meeting_notes.notes_markdown` | ×2 |
| `summary_text` | `summary_processes.result` | ×1 |

BM25 weights mean **title matches are 4× more important** than summary matches, and transcript/notes are 2× more important.

### Index Refresh Triggers

The FTS row for a meeting is refreshed (DELETE + INSERT in a transaction) at:
- **Recording stop** / transcript finalization (`api_save_transcript`)
- **AI summary completion** (`update_process_completed`)
- **Notes save** (`api_save_note`)

Per-chunk Whisper transcript writes during recording do **not** trigger a refresh (to avoid O(n²) cost during long recordings).

### Query Strategy

The `build_fts_query()` function:
1. Replaces punctuation with spaces (preventing "Q3-results" from becoming the mangled token "Q3results").
2. Splits on whitespace.
3. Drops tokens shorter than 2 characters (to avoid matching nearly everything).
4. Appends `*` to each token for **prefix matching** (e.g., `quart*` matches "quarterly", "quarter", "quarters").
5. Joins with **OR** — a meeting only needs one matching token to appear.

So the query "What did the Ryght AI meeting talk about?" becomes:
```
what* OR did* OR the* OR Ryght* OR AI* OR meeting* OR talk* OR about*
```

This is intentionally broad — it casts a wide net and lets BM25 ranking sort the signal from the noise.

### Snippet Extraction

The query retrieves per-column snippets using SQLite's `snippet()` function with `<b>` and `</b>` as highlight markers. Then it determines the **match source** by checking which snippet contains `<b>`:

```rust
if trans_snip.contains("<b>")      → "transcript"
else if notes_snip.contains("<b>") → "notes"
else if summ_snip.contains("<b>" ) → "summary"
else                               → "title"
```

Only the **best** match source is shown per meeting (no multi-column highlighting).

### Retrieval Limits

- Returns up to **20** results from the FTS query.
- **Top 10** FTS matches are selected for the chat context (filtered by date range + deduplicated).
- **8 most recent** meetings as fallback if no FTS matches.

---

## 6. LLM Client: Multi-Provider Abstraction

**File**: `frontend/src-tauri/src/summary/llm_client.rs` (391 lines)

### Provider Support

| Provider | API Format | Auth Method | Special Handling |
|---|---|---|---|
| **OpenAI** | OpenAI Chat Completions | `Bearer {api_key}` | — |
| **Claude** | Anthropic Messages API | `x-api-key` header | Uses `ClaudeRequest`/`ClaudeChatResponse` structs, `max_tokens: 2048` |
| **Groq** | OpenAI Chat Completions | `Bearer {api_key}` | — |
| **Ollama** | OpenAI-compatible on localhost | No auth | Defaults to `http://localhost:11434` |
| **OpenRouter** | OpenAI Chat Completions | `Bearer {api_key}` | — |
| **BuiltInAI** | Local sidecar (no HTTP) | N/A | Calls `summary_engine::generate_with_builtin()` with `app_data_dir` |
| **CustomOpenAI** | OpenAI-compatible on custom URL | `Bearer {api_key}` | Endpoint configurable, `temperature`/`top_p` overrides |
| **NVIDIA** | OpenAI Chat Completions | `Bearer {api_key}` | — |

### Request Building

**For OpenAI-compatible providers** (OpenAI, Groq, Ollama, OpenRouter, CustomOpenAI, NVIDIA):
```json
{
  "model": "{model_name}",
  "messages": [
    {"role": "system", "content": "{system_prompt}"},
    {"role": "user", "content": "{user_prompt}"}
  ],
  "max_tokens": 1024
}
```

**For Claude**:
```json
{
  "model": "{model_name}",
  "max_tokens": 2048,
  "system": "{system_prompt}",
  "messages": [
    {"role": "user", "content": "{user_prompt}"}
  ]
}
```

### Timeout and Cancellation

- Global timeout: **300 seconds** (5 minutes) via `reqwest::Client` timeout.
- The chat handler does **not** pass a `CancellationToken`, so the timeout is the only cancellation mechanism.
- If the request times out, the user sees: `"LLM request timed out after 60 seconds"` (the error message says 60s but the constant is 300s — minor inconsistency).

### Response Validation

```rust
fn non_empty_llm_content(content: &str) -> Result<String, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        Err(EMPTY_LLM_RESPONSE_ERROR)
    } else {
        Ok(trimmed.to_string())
    }
}
```

Empty responses are caught and trigger the retry logic in the chat handler.

---

## 7. Full Data Flow (Step by Step)

```
USER PRESSES ENTER
        │
        ▼
┌──────────────────────────────────────────────────────────────────────┐
│ FRONTEND                                                              │
│                                                                       │
│ 1. User types "What did we decide about the API design?" + Enter        │
│ 2. FloatingChatBubble.handleSend() called                               │
│ 3. useMeetingChat.sendMessage(text) called                              │
│ 4. Optimistically appends { role:'user', content:"..." } to messages[] │
│ 5. Sets isLoading = true                                                │
│ 6. invoke('api_chat_with_meetings', {                                  │
│      message: "What did we decide about the API design?",              │
│      history: [...previous turns...],                                  │
│      dateRangeDays: null                                                │
│    })                                                                   │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ Tauri IPC
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ RUST — api.rs                                                         │
│                                                                       │
│ 7. api_chat_with_meetings receives the request                        │
│ 8. Resolves app_data_dir from AppHandle                               │
│ 9. Delegates to chat::handler::chat_with_meetings()                   │
└──────────────────────────┬───────────────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ RUST — chat/handler.rs                                                │
│                                                                       │
│ 10. Fetches model config from SQLite (provider, model, API key)       │
│ 11. Fetches ALL meetings from SQLite                                   │
│ 12. infer_date_range_days("API design") → None (no time words)       │
│     → No date filtering on meetings                                    │
│ 13. Runs FTS5 search: search_fts(pool, "What did we decide about     │
│     the API design?") → tokenizes to: "what* OR did* OR the* OR      │
│     OR decide* OR about* OR API* OR design*"                           │
│ 14. Gets BM25-ranked results with highlighted snippets                │
│ 15. Selects top 10 FTS matches within the (unfiltered) meeting set    │
│ 16. For each selected meeting:                                        │
│     a. Fetch transcripts (up to 500 segments)                         │
│     b. Fetch notes from meeting_notes table                           │
│     c. Fetch AI summary from summary_processes table                  │
│     d. Build a formatted block with character caps per section        │
│ 17. Concatenate all blocks (max 60,000 chars total)                   │
│ 18. Build system prompt with meeting context                          │
│ 19. Build user prompt with conversation history                       │
│ 20. Call generate_chat_response_with_retry():                         │
│     a. generate_summary() → HTTP POST to LLM provider                  │
│     b. If empty response, retry once with stricter instruction        │
│ 21. Return response String                                            │
└──────────────────────────┬───────────────────────────────────────────┘
                           │ Tauri IPC
                           ▼
┌──────────────────────────────────────────────────────────────────────┐
│ FRONTEND                                                              │
│                                                                       │
│ 22. Receives response string                                           │
│ 23. Appends { role:'assistant', content: response } to messages[]      │
│ 24. Sets isLoading = false                                              │
│ 25. Auto-scrolls to bottom                                             │
│ 26. Renders response as ReactMarkdown (with tables, lists, code, etc.) │
└──────────────────────────────────────────────────────────────────────┘

TOTAL ROUND-TRIP: 1 Tauri IPC call + 1 HTTP call to LLM provider
                  (no streaming — user waits for full response)
```

---

## 8. Key Design Decisions & Limitations

### Design Decisions

| Decision | Rationale |
|---|---|
| **Self-contained in Rust** | Works offline with local models (Ollama, BuiltInAI), no dependency on the Python backend |
| **Keyword FTS5 over vector search** | Zero additional dependencies, works with SQLite built-in, good for the current small scale (~hundreds of meetings) |
| **Shared LLM infrastructure** | Chat reuses the same `generate_summary()` as meeting summaries — one model config for both features |
| **Context injected into system prompt** | No RAG pipeline or external vector DB needed — the LLM sees all relevant content in its context window |
| **Optimistic UI updates** | User message appears immediately in the UI before the backend responds |
| **In-memory chat history** | No persistence across app restarts — keeps the code simple and avoids stale conversation issues |
| **Date inference from natural language** | Users can say "last week" without needing a date picker |

### Current Limitations

| Limitation | Impact | Why It Exists |
|---|---|---|
| **No streaming** | User sees a blank loading state for the full LLM generation time (could be 5–30s) | Tauri command returns `String`, not a stream. Would require switching to Tauri events or a streaming response |
| **Keyword search only** | Cannot find conceptually related content that uses different wording (e.g., searching "budget" won't find "financial planning") | FTS5 doesn't do semantic/vector search. No embeddings infrastructure in the current codebase |
| **No cross-meeting synthesis optimization** | The LLM gets raw context blocks and must synthesize across them — no pre-compiled wiki articles or summary indices | The "Second Brain" plan exists but hasn't been implemented |
| **No citations in the UI** | The system prompt says "cite specific meetings" but citations are just text in the LLM response, not interactive clickable elements | No structured citation format passed back from the LLM |
| **Flat history (not a messages array)** | History is formatted as text in the user prompt, not passed as structured `messages` to the API | Workaround for reusing `generate_summary()` which only accepts system+user prompts |
| **No chat persistence** | All conversation history is lost on app restart | Intentionally simple; no DB schema for chat sessions |
| **No per-user token/usage tracking** | Unknown how many tokens each chat consumes | Not implemented |
| **Default max_tokens = 1024** | Long, detailed responses may be truncated | Prevents runaway generation with local models; configurable via CustomOpenAI provider |
| **Context budget is a flat 60K chars** | With ~10 meetings at ~6K chars each, not all meetings get their full content | Fixed constant — doesn't adapt to the model's actual context window |
| **No cancellation from frontend** | Once a request is sent, the user must wait for the LLM to finish or timeout | CancellationToken parameter exists in `generate_summary()` but chat doesn't wire it up |

### The "Second Brain" Plan (Not Yet Implemented)

The document `docs/plans/2026-04-06-second-brain-phase1-rag-chat.md` describes a more sophisticated future version:

1. **Wiki compilation**: After each meeting, the LLM compiles a structured `.md` wiki article with sections for Key Decisions, Action Items, People, and Topics.
2. **Vector embeddings**: Raw transcript chunks get embedded via Ollama `nomic-embed-text`, stored in a `memory_chunks` table, with numpy cosine similarity for retrieval.
3. **Wiki-first Q&A**: A Python backend service reads wiki articles (not raw chunks) as context for answering questions, with proper citations.
4. **Memory page**: A dedicated chat UI in the sidebar, not just a floating bubble.

This plan was designed but never implemented — the current chatbot is the simpler, Rust-native approach.

---

## 9. File Reference

### Frontend (TypeScript)

| File | Lines | Purpose |
|---|---|---|
| `frontend/src/components/ChatBubble/FloatingChatBubble.tsx` | 277 | Floating chat panel UI, message list, input, animations |
| `frontend/src/components/ChatBubble/useMeetingChat.ts` | 81 | Chat state hook: messages, loading, `invoke()` call |
| `frontend/src/app/layout.tsx` | — | Mounts `FloatingChatBubble` app-wide |

### Rust (Tauri Backend)

| File | Lines | Purpose |
|---|---|---|
| `frontend/src-tauri/src/api/api.rs` | 25 (lines 2080–2105) | Tauri command wrapper, resolves `app_data_dir` |
| `frontend/src-tauri/src/chat/mod.rs` | 9 | Module declaration |
| `frontend/src-tauri/src/chat/handler.rs` | 509 | **Core logic**: context assembly, prompt building, retry |
| `frontend/src-tauri/src/search/fts.rs` | 254 | FTS5 index management and keyword search |
| `frontend/src-tauri/src/summary/llm_client.rs` | 391 | Multi-provider LLM HTTP client |
| `frontend/src-tauri/src/lib.rs` | 1 (line 755) | Command registration in `invoke_handler` |

### Configuration / Settings

| File | Purpose |
|---|---|
| `frontend/src-tauri/src/database/commands.rs` | Default model config initialization (`builtin-ai` / `gemma3:1b`) |
| `frontend/src-tauri/src/database/repositories/setting.rs` | Read/write API keys, model config, endpoints |
| `frontend/src/components/ModelSettingsModal.tsx` | Provider selection UI |
| `frontend/src/components/SummaryModelSettings.tsx` | Model config wrapper component |
| `frontend/src/contexts/ConfigContext.tsx` | Global model config context |

### Future / Unimplemented

| File (in plan) | Purpose |
|---|---|
| `docs/plans/2026-04-06-second-brain-phase1-rag-chat.md` | Plan for vector search + wiki compilation |
| `backend/app/embeddings.py` | Ollama embedding service + numpy cosine search |
| `backend/app/memory_indexer.py` | Chunk + embed meetings into DB |
| `backend/app/wiki_compiler.py` | LLM compiles meetings into structured wiki articles |
| `backend/app/memory_chat.py` | Wiki-first Q&A with citations |
| `frontend/src/app/memory/page.tsx` | Dedicated Memory chat page |
