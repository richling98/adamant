# ADA-8: Chat with Meeting Notes

## Summary

Add a persistent floating chat bubble to the app that lets users interactively
query their meeting transcripts with natural language. The AI powering the chat
is the same model the user already configured for summaries — no additional
setup required.

## Current State

- Users can view AI summaries generated from individual meetings
- There is no way to query _across_ multiple meetings interactively
- There is no conversational interface anywhere in the app

## Desired Outcome

1. A floating circular 😊 button is always visible in the **bottom-right corner**
   of the app, rendered on top of all content (`z-[9999]`)
2. Clicking the button opens a **right-side slide-in chat sheet** (w-96)
3. The user types a message (e.g. "summarize my past week") and receives an AI
   response that has full context of all stored meeting transcripts
4. Chat history persists for the session; closing/reopening the sheet keeps the
   conversation alive until the app restarts
5. A trash icon in the sheet header clears the history on demand
6. The feature works with every supported LLM provider: BuiltIn AI, Ollama,
   Claude, Groq, OpenRouter, CustomOpenAI — identical to the summary feature

## Implementation

### Rust (backend)

| File | Description |
|------|-------------|
| `frontend/src-tauri/src/chat/mod.rs` | New module declaration |
| `frontend/src-tauri/src/chat/handler.rs` | Context building, LLM call via existing `generate_summary()` |
| `frontend/src-tauri/src/api/api.rs` | New `api_chat_with_meetings` Tauri command |
| `frontend/src-tauri/src/lib.rs` | `mod chat;` + command registered in `invoke_handler` |

**Flow:**
1. Receive `{ message, history, date_range_days? }` from frontend
2. Load model config + API key from `SettingsRepository`
3. Fetch all meetings from `MeetingsRepository::get_meetings()` (optionally
   filtered by date)
4. For each meeting fetch transcripts via `get_meeting_transcripts_paginated()`
5. Build a context block (title + date + transcript text) truncated to ~60 k chars
6. Construct system prompt: persona + today's date + meeting context
7. Format conversation history into the user prompt for multi-turn context
8. Call `summary::llm_client::generate_summary()` — reuses existing function
9. Return the AI response string

### Frontend

| File | Description |
|------|-------------|
| `frontend/src/components/ChatBubble/useMeetingChat.ts` | Hook managing message state and Tauri invocation |
| `frontend/src/components/ChatBubble/FloatingChatBubble.tsx` | Floating button + Sheet UI with message list, input, loading state |
| `frontend/src/app/layout.tsx` | Injects `<FloatingChatBubble />` inside `RecordingPostProcessingProvider` |

## Risks & Notes

- **Token budget**: Each chat turn sends all meeting transcripts as context
  (~60 k char cap). Cloud API users (Claude, Groq, etc.) will consume more
  tokens per chat message than per summary. Users provide their own API keys so
  cost is borne by the user, not the developer.
- **BuiltIn AI model**: The handler accepts `app_data_dir` from the Tauri
  command layer so BuiltIn AI works identically to the summary feature.
- **Multi-turn history**: The existing `generate_summary()` function takes a
  single system+user pair. Conversation history is embedded into the user
  prompt as formatted text — compatible with all providers.
- **No persistence**: Chat history is in-memory only. This is intentional to
  keep the implementation simple and avoid PII being stored to disk.
