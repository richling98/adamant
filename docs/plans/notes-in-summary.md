# Feature Implementation Plan: Include User Notes in AI Cleanup

**Overall Progress:** `100%`

## TLDR

AI Cleanup receives both the transcript and user-typed notes. The frontend fetches the note via `api_get_note`, flushes pending editor content before generation, passes `notes_markdown` into the Rust summary pipeline, and the final prompt injects the notes as a separate `<user_notes>` section.

## End Result

When a user clicks "Generate AI Cleanup", the LLM receives both the timestamped transcript and any notes the user typed in `My Notes`. The system prompt explicitly instructs the model to treat the notes as authoritative context. If no notes exist, behavior is unchanged for transcript-only cleanup.

## Critical Decisions

* **Flush and fetch notes in the frontend flow** — `useSummaryGeneration` already has `meeting.id` and calls the established `invoke('api_get_note')` pattern. The page flushes pending editor content before generation so the fetched Markdown is current.
* **`<user_notes>` as a separate XML section** — parallel to `<transcript_chunks>`, not prepended to transcript text. Lets the LLM clearly distinguish spoken content from written notes.
* **Notes are optional / gracefully skipped** — if `api_get_note` returns null or empty markdown, the `<user_notes>` block is omitted entirely. No behavioural change for meetings without notes.
* **System prompt updated to mention notes** — one sentence added so the LLM knows to treat notes as authoritative additional context.
* **No change to Ask Adam** — it already fetches `notes_markdown` from DB independently in `chat/handler.rs`.

---

## Tasks

- [x] 🟩 **Step 1: Fetch notes in `useSummaryGeneration` and pass to invoke**
  - [x] 🟩 In `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`, call `invoke('api_get_note', { meetingId: meeting.id })` and extract `content_markdown` (default to empty string if null/undefined).
  - [x] 🟩 Add `notesMarkdown: string` to the `invoke('api_process_transcript', {...})` call, passing the fetched markdown value.

- [x] 🟩 **Step 2: Add `notes_markdown` parameter to `api_process_transcript` in Rust**
  - [x] 🟩 In `frontend/src-tauri/src/api/api.rs`, add `notes_markdown: Option<String>` parameter to the `api_process_transcript` Tauri command function signature.
  - [x] 🟩 Pass `notes_markdown` through to `SummaryProcessor::process_transcript(...)`.

- [x] 🟩 **Step 3: Inject `<user_notes>` into the prompt in `processor.rs`**
  - [x] 🟩 In `frontend/src-tauri/src/summary/processor.rs`, add the `<user_notes>` block when `notes_markdown` is non-empty:
    ```rust
    if let Some(notes) = &notes_markdown {
        if !notes.trim().is_empty() {
            final_user_prompt.push_str("\n\n<user_notes>\n");
            final_user_prompt.push_str(notes);
            final_user_prompt.push_str("\n</user_notes>");
        }
    }
    ```
  - [x] 🟩 Update the system prompt so the model treats `<user_notes>` as authoritative context.
  - [x] 🟩 Thread `notes_markdown: Option<String>` through intermediate summary-processing function signatures.

- [x] 🟩 **Step 4: Flush notes before generation**
  - [x] 🟩 `NotesPanel` exposes `flushNotes()`.
  - [x] 🟩 AI Cleanup calls the flush path before collecting transcript and note inputs.
  - [x] 🟩 `api_get_note` returns `content_markdown` for the generation path.

- [x] 🟩 **Step 5: Verify**
  - [x] 🟩 Run `cargo check -p adamant` — zero errors.
  - [x] 🟩 Run `pnpm exec tsc --noEmit` — zero errors.
  - [x] 🟩 User confirmed AI Cleanup works after the notes-persistence fix.

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
