# Fix: Savant Chat Meeting Selection

## Problem

The Savant chat relies entirely on FTS5 keyword search (`search/fts.rs`) to select which meetings to include in the LLM context. When a user asks a natural-language question like "Tell me about my most recent meeting", the FTS5 tokenizer produces generic keywords (`Tell* OR me* OR about* OR my* OR most* OR recent* OR meeting*`) that fail to match any meeting. The planned fallback ("LLM index routing") at `chat/handler.rs:247-248` is a stub that returns `Ok(vec![])`. With zero meeting IDs selected, the system prompt receives `MEETING CONTENT: No meeting content found.`, and the LLM responds with "I don't have access to your personal meeting history."

## Root Cause

Single point of failure at `chat/handler.rs:228-249` (`select_meetings`):

```
FTS5 keyword search
  └─ Returns results? → Use them ✓
  └─ Returns nothing? → Stub: Ok(vec![]) ✗
                         (LLM routing fallback never implemented)
```

The entire chat pipeline has no secondary retrieval mechanism. The LLM index routing — the core premise of the Savant second-brain feature — was never built.

## Plan: Implement LLM Index Routing Fallback

**File:** `chat/handler.rs` — `select_meetings()` (line 228)

**Change:** When FTS5 returns zero results, route through the LLM instead of returning empty. Build a compact manifest of all meetings (within the date range) and ask the LLM to select the relevant ones.

### Detailed Flow

```
select_meetings(message, allowed_ids)
  │
  ├─ 1. FTS5 keyword search on message
  │     └─ Returns results? → return those IDs ✓
  │
  └─ 2. FTS5 returned nothing → LLM index routing
        │
        ├─ Build meeting manifest:
        │   For each meeting in allowed_ids (sorted by created_at DESC)
        │     "ID: <meeting_id> | Title: <title> | Date: YYYY-MM-DD"
        │   Limit to last 100 meetings to cap token cost.
        │
        ├─ System prompt for routing LLM call:
        │   "You are a meeting retrieval system. Given the user's question,
        │    select up to 5 meeting IDs from the list below that are
        │    most relevant. Return ONLY the selected IDs, one per line.
        │    If none are relevant, return nothing."
        │
        ├─ Call the selected LLM with max_tokens ~200
        │     └─ Success? → Parse response → return valid IDs
        │     └─ Fail? → Retry up to N times, emit status events
        │     └─ All retries exhausted? → return vec![], log error
        │
        └─ All retries exhausted → graceful degradation
              (same as current behavior: "No meeting content found.")
```

### Why This Works

| Query type | FTS5 | LLM Routing | Result |
|-----------|------|-------------|--------|
| "What did John say about Q3 budget?" | Matches keywords | Not reached | ✅ FTS5 |
| "Tell me about my most recent meeting" | Nothing | LLM sees titles + dates → picks recent meetings | ✅ Routing |
| "What happened last week?" | Nothing | LLM sees dates → picks last week's meetings | ✅ Routing |
| "Tell me about the design review" | Matches "design" | Not reached | ✅ FTS5 |
| "Remind me about the meeting with Sarah" | Nothing (generic) | LLM sees titles → picks Sarah-related meetings | ✅ Routing |

### Implementation Details

#### A. Savant Model Picker (Frontend)

**File:** `frontend/src/app/memory/page.tsx`

Add a model picker dropdown in the Savant page header (alongside the wiki status and Re-compile button). Reuse the exact same provider/model lists and loading logic from `ChatModelPicker.tsx` (lines 16-107) — it already supports all providers, dynamic model fetching, and `api_save_model_config`.

**Behavior:**
- Load current model config on mount via `invoke('api_get_model_config')`
- Default to the summarization engine's current model
- On change, save via `invoke('api_save_model_config', { ... })`
- The selected model is used for **both** LLM routing and the main chat response

**Why this addresses the double-latency concern:**
The user consciously chooses the model. If they want fast routing, they can select a fast model. If they want the most capable model, they accept the latency. The same model handles both routing and chat — no separate routing model logic needed.

#### B. LLM Index Routing (Rust Backend)

**File:** `chat/handler.rs`, function `select_meetings()` (lines 228-249)

**Signature change:**
```rust
async fn select_meetings(
    pool: &sqlx::SqlitePool,
    message: &str,
    allowed_ids: &HashSet<&str>,
    meeting_pool: &HashMap<&str, &MeetingModel>,
    provider: &LLMProvider,
    model_name: &str,
    api_key: &str,
    ollama_endpoint: Option<&str>,
    custom_openai_endpoint: Option<&str>,
    app_data_dir: &Option<PathBuf>,
    app_handle: &AppHandle<R>,  // new: for emitting status events
) -> Result<Vec<String>, String>
```

**Routing logic:**
1. Build manifest from `meeting_pool` (capped at 100 most recent)
2. Construct routing prompt
3. Call LLM with `max_tokens=200`, with retry loop (up to 3 attempts)
4. Before each retry, emit `chat-status` event
5. Parse response, filter against `allowed_ids`
6. Return valid IDs (up to 5)

#### C. Retry Visualization via Tauri Events

**Rust side** — emit progress events throughout the pipeline:

```rust
fn emit_status(app_handle: &AppHandle, message: &str) {
    let _ = app_handle.emit("chat-status", message);
}

// In chat_with_meetings_v2():
emit_status(app_handle, "Searching your meetings...");
// ... FTS5 search ...
emit_status(app_handle, "Reading your meeting notes...");
// ... LLM routing call ...
emit_status(app_handle, "Retrying (attempt 2/3)...");
// ... main LLM call ...
emit_status(app_handle, "Generating response...");
```

**Frontend side** — listen and display in the chat window:

```typescript
// In memory/page.tsx:
import { listen } from "@tauri-apps/api/event";
useEffect(() => {
  const unlisten = listen<string>("chat-status", (event) => {
    setStatusMessage(event.payload);
  });
  return () => { unlisten.then(fn => fn()); };
}, []);
```

Display `statusMessage` as a small loading indicator above or below the loading spinner in the chat messages area.

### Retry Behavior

| Attempt | Event emitted | Action |
|---------|---------------|--------|
| 1 (first routing call) | `"Reading your meeting notes..."` | Normal LLM call |
| Fail | — | Log warning |
| 2 (first retry) | `"Retrying (attempt 2/3)..."` | Same LLM call |
| Fail | — | Log warning |
| 3 (final retry) | `"Retrying (attempt 3/3)..."` | Same LLM call |
| Fail | — | Return `vec![]`, log error, proceed with empty context |

Each retry uses the same prompt. A small jitter delay (~500ms) between retries to avoid tight loops on transient errors.

## Files to Modify

### Frontend

| File | Lines | Change |
|------|-------|--------|
| `frontend/src/app/memory/page.tsx` | ~90-124 | Add model picker dropdown in header |
| `frontend/src/app/memory/page.tsx` | ~55-59 | Pass `app_handle` or listen for `chat-status` events |
| `frontend/src/app/memory/page.tsx` | ~166-173 | Add status message display in chat area |

### Backend (Rust)

| File | Lines | Change |
|------|-------|--------|
| `frontend/src-tauri/src/chat/handler.rs` | 228-249 | Implement LLM routing in `select_meetings()` with retry loop |
| `frontend/src-tauri/src/chat/handler.rs` | 69-130 | Pass `app_handle` and new params; add `emit_status()` helper |
| `frontend/src-tauri/src/chat/handler.rs` | ~154-167 | Inject routing-selected IDs into system prompt context |

## Devil's Advocate Review

### 🔴 Double LLM Call = Double Latency

Addressed by the model picker: the user chooses which model to use for Savant. If they select a fast model, routing latency is low. The model picker is now explicit, transparent, and user-controlled.

### 🟡 Retry Failure → Silent Degradation

Addressed by retry loop (up to 3 attempts) with jitter. If all retries fail, the system degrades gracefully to the current behavior. The user sees the retry attempts via `chat-status` events, so the failure is visible.

### 🟡 Title-Only Routing Is Weak

Acceptable because FTS5 handles specific content queries. The LLM routes on title + date, which is sufficient for recency, people names, and general topic queries.

### 🟢 All Other Concerns

Hallucination is filtered by `allowed_ids`. Token cost is negligible (~8KB). The 100-meeting cap is a reasonable trade-off. Robust parsing handles chatty LLM responses.
