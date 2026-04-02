# Feature Implementation Plan: Include User Notes in AI Summary

**Overall Progress:** `75%`

## TLDR

AI summaries currently only receive the raw transcript. User-typed notes (stored in `meeting_notes.notes_markdown`) are ignored. This plan injects the notes as a second input alongside the transcript so the LLM produces richer, more contextually accurate summaries. Ask Adam already includes notes — this brings summary generation to parity.

## End Result

When a user clicks "Generate Summary", the LLM receives both the timestamped transcript and any notes the user typed in the Notes panel. The system prompt explicitly instructs the model to treat the notes as authoritative context — if the user wrote "action item: deploy by Friday", that appears in the summary even if it wasn't spoken aloud. If no notes exist, behaviour is identical to today.

## Critical Decisions

* **Fetch notes in the frontend hook, not Rust** — `useSummaryGeneration` already has `meeting.id` and calls `invoke('api_get_note')` pattern is established. Keeps Rust layer thin.
* **`<user_notes>` as a separate XML section** — parallel to `<transcript_chunks>`, not prepended to transcript text. Lets the LLM clearly distinguish spoken content from written notes.
* **Notes are optional / gracefully skipped** — if `api_get_note` returns null or empty markdown, the `<user_notes>` block is omitted entirely. No behavioural change for meetings without notes.
* **System prompt updated to mention notes** — one sentence added so the LLM knows to treat notes as authoritative additional context.
* **No change to Ask Adam** — it already fetches `notes_markdown` from DB independently in `chat/handler.rs`.

---

## Tasks

- [ ] 🟥 **Step 1: Fetch notes in `useSummaryGeneration` and pass to invoke**
  - [ ] 🟥 In `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`, inside `handleGenerateSummary` (just before building `fullTranscript`), call `invoke('api_get_note', { meetingId: meeting.id })` and extract `content_markdown` (default to empty string if null/undefined).
  - [ ] 🟥 Add `notesMarkdown: string` to the `invoke('api_process_transcript', {...})` call, passing the fetched markdown value.

- [ ] 🟥 **Step 2: Add `notes_markdown` parameter to `api_process_transcript` in Rust**
  - [ ] 🟥 In `frontend/src-tauri/src/api/api.rs`, add `notes_markdown: Option<String>` parameter to the `api_process_transcript` Tauri command function signature.
  - [ ] 🟥 Pass `notes_markdown` through to `SummaryProcessor::process_transcript(...)` (or however the processor is invoked in that command).

- [ ] 🟥 **Step 3: Inject `<user_notes>` into the prompt in `processor.rs`**
  - [ ] 🟥 In `frontend/src-tauri/src/summary/processor.rs`, in the function that builds the final user prompt (around line 449), after the `<transcript_chunks>` block and before/after `<user_context>`, add:
    ```rust
    if let Some(notes) = &notes_markdown {
        if !notes.trim().is_empty() {
            final_user_prompt.push_str("\n\n<user_notes>\n");
            final_user_prompt.push_str(notes);
            final_user_prompt.push_str("\n</user_notes>");
        }
    }
    ```
  - [ ] 🟥 Update the system prompt string (around line 425) to add one sentence: `"In addition to the transcript, the user may have provided their own notes in <user_notes> — treat these as authoritative context."`
  - [ ] 🟥 Thread `notes_markdown: Option<String>` through any intermediate function signatures between the Tauri command and the prompt builder (e.g., `process_transcript`, `build_final_summary_prompt`, or similar).

- [ ] 🟥 **Step 4: Verify**
  - [ ] 🟥 Run `cargo check` inside `frontend/src-tauri` — zero errors.
  - [ ] 🟥 Open a meeting, type notes in the Notes panel, generate a summary — confirm the summary reflects content from the notes that wasn't spoken in the transcript.
  - [ ] 🟥 Open a meeting with no notes, generate a summary — confirm behaviour is identical to today (no regression).

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
