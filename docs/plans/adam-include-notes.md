# Feature Implementation Plan: Adam Reads Manual Notes

**Overall Progress:** `100%`

## TLDR

Adam the Wizard currently only reads meeting **transcripts** when answering questions. If you wrote notes manually during or after a meeting (using the notes panel), Adam has no access to them. This plan adds `notes_markdown` from the `meeting_notes` table to the context block Adam sees — so he can answer questions about things you wrote yourself, not just what was spoken.

## End Result

When you ask Adam a question, he sees both the spoken transcript **and** any notes you typed for each meeting. If a meeting has notes but no transcript (e.g. a quick note-taking session), Adam can still answer questions about it. The system prompt labels them clearly so Adam knows which content came from where.

## Critical Decisions

- **Single SQL query per meeting for notes** — fetch `notes_markdown` inline alongside transcripts using the existing per-meeting loop. No new repository method needed — it's a direct `sqlx::query_scalar` in `handler.rs`, consistent with how FTS5 queries `meeting_notes`.
- **Notes appended after transcript in the same meeting block** — keeps each meeting's context together. Format: transcript block first (if any), then `### Notes:\n{notes}` immediately after. Adam sees both in one coherent block.
- **Meetings with only notes (no transcript) are included** — the current code skips meetings with empty transcripts (`continue` on line 116). After this change, a meeting is included if it has a transcript OR notes. Neither being empty alone is a skip condition.
- **Shared 60,000 character budget** — notes and transcripts share the existing `MAX_CONTEXT_CHARS` budget. No separate limit. Notes are appended after transcript and get whatever budget remains for that meeting.
- **System prompt label updated** — change "MEETING TRANSCRIPTS:" to "MEETING CONTENT:" since Adam now receives more than just transcripts.
- **No `notes_markdown` stripping** — notes are stored as markdown (e.g. `**bold**`, `- bullet`). Pass them through as-is; most LLMs handle markdown natively.

---

## Tasks

- [x] 🟩 **Step 1: Fetch notes per meeting inside `chat_with_meetings()`**
  - [x] 🟩 In `frontend/src-tauri/src/chat/handler.rs`, inside the `'outer` loop (after fetching transcripts), add a `sqlx::query_scalar` to fetch `notes_markdown` for the current meeting:
    ```sql
    SELECT notes_markdown FROM meeting_notes WHERE meeting_id = ?
    ```
    Returns `Option<String>` — `None` if no notes row exists.
  - [x] 🟩 Change the skip condition: currently `if transcript_text.trim().is_empty() { continue; }`. Replace with: skip only if **both** transcript AND notes are empty.

- [x] 🟩 **Step 2: Append notes to the meeting context block**
  - [x] 🟩 After building `transcript_text`, build the meeting block to include notes:
    - If transcript is non-empty: include transcript section as before
    - If notes are non-empty: append `### Notes:\n{notes_text}` after the transcript
    - If only notes (no transcript): the block is just the header + notes section
  - [x] 🟩 The combined block (transcript + notes) is what gets measured against `remaining` budget and truncated if needed — same word-boundary truncation logic as before.

- [x] 🟩 **Step 3: Update system prompt label**
  - [x] 🟩 In the `system_prompt` format string, change `"MEETING TRANSCRIPTS:\n\n"` to `"MEETING CONTENT:\n\n"` and update the instruction sentence from *"based on the meeting transcripts provided below"* to *"based on the meeting content (transcripts and notes) provided below"*.

- [x] 🟩 **Step 4: Verify compilation**
  - [x] 🟩 Run `cargo check` inside `frontend/src-tauri` — zero errors required.

---

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
