/// Chat module — "Chat with your meetings" feature (ADA-8)
///
/// Exposes a single Tauri command (`api_chat_with_meetings`) that lets the
/// frontend send a message alongside conversation history and receive an AI
/// response that has full context of the user's stored meeting transcripts.
///
/// The underlying LLM is the same one the user already configured for
/// summaries — no extra setup required.
pub mod compilation_scheduler;
pub mod handler;
pub mod wiki_compiler;
pub mod wiki_fs;
