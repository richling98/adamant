# AI Cleanup Actions Implementation

**Overall Progress:** `100%`

## Delivered Behavior

- Transcript audio is transcribed from separate microphone and system-audio paths.
- Microphone transcript entries persist as `speaker = "mic"` and render as `[you]`.
- System-audio entries persist as `speaker = "system"` and never receive the `[you]` marker.
- AI Cleanup sends complete manual notes and the attributed transcript to the action extractor.
- Only user-owned actions are saved: unowned manual-note imperatives and actions identified from `[you]` transcript lines.
- Explicitly assigned tasks for other named people are excluded.
- Extracted todos are transactionally replaced only for the active cleanup run; manual Actions-page entries remain untouched.
- The Actions sidebar and an already open Actions page refresh after extraction is committed.

## Execution Checklist

- [x] Preserve microphone/system source through VAD and transcription.
- [x] Persist `mic` / `system` speaker metadata using the existing transcript column.
- [x] Carry attribution through native events, frontend types, saved transcripts, pagination, and exports.
- [x] Render microphone transcript segments as `[timestamp] [you] text`.
- [x] Include `[you]` markers in cleanup and transcript-copy formatting.
- [x] Replace split notes/transcript prompting with a structured full-source prompt.
- [x] Enforce user-only ownership for LLM and deterministic manual-note candidates.
- [x] Recognize compound headings including `next steps and actions`.
- [x] Add structured-output validation, bounded JSON recovery, and high-confidence filtering.
- [x] Replace extracted rows transactionally and preserve prior rows on failure.
- [x] Guard replacement and completion against stale regeneration runs.
- [x] Persist action-extraction lifecycle status separately from summary status.
- [x] Emit `todos-updated` only after terminal extraction persistence.
- [x] Refresh sidebar counts and mounted Actions pages from the confirmed update.
- [x] Add focused extractor regression tests, including the Weekly Team Meeting example.

## V1 Boundaries

- `mic` is intentionally treated as the Adamant user and `system` as other participants.
- Multiple people speaking into the same microphone are an accepted v1 attribution limitation.
- Speaker diarization, voice enrollment, and user confirmation are deliberately deferred.

## Verification

- [x] `cargo check` from `frontend/src-tauri`
- [x] `cargo test todo_extractor --lib` from `frontend/src-tauri`
- [x] `pnpm exec tsc --noEmit` from `frontend`
- [x] `git diff --check`
