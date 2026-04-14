# Feature Implementation Plan: Turn AI Summary Into Comprehensive AI Cleanup

**Overall Progress:** `58%`

## TLDR

This feature is partially already implemented, but not fully aligned with the desired product behavior.

What is already true in the code today:
- `My Notes` are already fetched in `frontend/src/hooks/meeting-details/useSummaryGeneration.ts` and passed into `api_process_transcript`.
- `notes_markdown` is already threaded through the Rust summary pipeline.
- The final prompt in `frontend/src-tauri/src/summary/processor.rs` already injects `<user_notes>` and instructs the model to produce a complete record rather than a short summary.

What is still not fully true:
- The product is still named and presented as a "summary" throughout the UI and code paths.
- The template system still contains summary-oriented naming and section semantics.
- There is not yet an explicit end-to-end guarantee that the generated output is a comprehensive cleanup of both transcript and notes without omitting details.

This plan focuses only on the remaining work: verify the current behavior, tighten the prompt/template contract, and shift the feature from "summary" semantics to "comprehensive AI cleanup" semantics.

## Key Changes (Laymans Version)

- Make the app stop thinking of this feature as a short summary and instead treat it like a full AI cleanup of the meeting.
- Keep using both the transcript and `My Notes`, so the AI includes what was said and what the user intentionally wrote down.
- Rename the frontend feature from `AI Summary` to `AI Cleanup` so the product language matches the actual goal.
- Make the AI button appear when there is useful content in either place: the transcript or `My Notes`.
- Tighten the instructions and templates so the AI produces a complete, clean writeup without leaving out important details.
- Test real outputs to make sure note-only details and transcript-only details both show up in the final result.

## Desired End Result

When the user runs this feature, Adamant should generate a comprehensive AI cleanup that:

- uses both the meeting transcript and `My Notes`
- preserves all substantive details from both sources
- avoids compressing, condensing, or omitting content
- produces a clean, cohesive writeup rather than a short summary
- reflects what was said and what the user intentionally wrote down
- becomes available whenever there is user content to work from, meaning a non-empty transcript and/or non-empty `My Notes`

## Current State Verification

The codebase already includes user notes in the generation path:

- `frontend/src/hooks/meeting-details/useSummaryGeneration.ts`
  - fetches `api_get_note`
  - extracts `content_markdown`
  - passes `notesMarkdown` into `processSummary(...)`
- `frontend/src-tauri/src/summary/commands.rs`
  - accepts `notes_markdown: Option<String>` in `api_process_transcript`
- `frontend/src-tauri/src/summary/processor.rs`
  - appends `<user_notes>` to the final prompt when notes exist
  - instructs the model to produce a "complete, organized record of everything discussed — not a short summary"

So the "include My Notes" part is already done.

## Critical Decisions

* **Do not reimplement note inclusion** - the notes-input plumbing already exists, so the plan should build on it rather than duplicate it.
* **Treat this as a semantics and output-contract change** - the main remaining gap is not data plumbing but ensuring the product consistently behaves like a complete cleanup instead of a summary.
* **Keep compatibility at the API/storage layer where possible** - internal names like `summary` may remain temporarily if renaming them everywhere would create unnecessary migration risk.
* **Rename the frontend feature to `AI Cleanup`** - user-facing app language should stop calling this an "AI Summary" and should instead present it as cleanup/comprehensive notes generation.
* **Gate generation on transcript OR notes, not transcript only** - if the user has typed meaningful content into `My Notes`, the AI Cleanup action should be available even when no transcript exists yet.
* **Change prompt, templates, and UI in a coordinated way** - if only the prompt changes but the templates and UI still say "summary", the product intent will remain muddy.
* **Verify with real examples, not prompt assumptions** - because the backend prompt is already fairly strong, we need to test actual outputs to identify where the model still compresses or drops details.

## Tasks

- [ ] 🟨 **Step 1: Audit the current end-to-end behavior with real output samples**
  - [ ] 🟥 Generate output for a meeting that includes both transcript content and meaningful `My Notes`.
  - [ ] 🟥 Confirm whether note-only details appear in the generated output.
  - [ ] 🟥 Confirm whether the current output still compresses, summarizes, or drops detail despite the existing prompt language.
  - [x] 🟩 Identify whether omissions come primarily from prompt wording, template structure, chunk-combine logic, or frontend presentation.

- [x] 🟩 **Step 2: Tighten the backend prompt contract around “cleanup, not summary”**
  - [x] 🟩 In `frontend/src-tauri/src/summary/processor.rs`, replace remaining summary-oriented framing in the final-generation path with explicit "comprehensive cleanup" language.
  - [x] 🟩 Make the instructions unambiguous that the model must preserve all material details from both `<transcript_chunks>` and `<user_notes>`.
  - [x] 🟩 Add explicit guidance that the output should read as a cohesive cleaned-up writeup, while still retaining all decisions, action items, questions, corrections, and context.
  - [ ] 🟥 Review the chunk-combine prompt so it also preserves the "do not summarize or compress" contract before the final cleanup stage.

- [x] 🟩 **Step 3: Align the template system with comprehensive-record behavior**
  - [x] 🟩 Audit the built-in templates and their section instructions to find summary-oriented sections or wording that encourage compression.
  - [x] 🟩 In `frontend/src-tauri/src/summary/templates/types.rs`, update generated section guidance so it consistently asks for full capture rather than summary extraction.
  - [x] 🟩 Review bundled templates such as `standard_meeting` and `daily_standup` to ensure their sections support a complete record instead of an executive summary.
  - [x] 🟩 Decide whether a new cleanup-oriented default template is needed, or whether the existing templates can be safely reworded in place.

- [x] 🟩 **Step 4: Align the frontend UX with the new product intent**
  - [x] 🟩 Audit the meeting-details UI for copy such as "Generate Summary", "summary is ready", and other summary-oriented labels.
  - [x] 🟩 Rename user-facing frontend copy from `AI Summary` / `Generate Summary` to `AI Cleanup` / `Generate AI Cleanup` where appropriate.
  - [x] 🟩 Keep internal compatibility names only where changing them would create unnecessary backend/storage migration risk.
  - [x] 🟩 Update the button-visibility logic so the AI Cleanup action appears whenever the transcript has content and/or `My Notes` has at least one character.
  - [x] 🟩 Ensure notes-only meetings can trigger AI Cleanup without requiring transcript content first.
  - [x] 🟩 Update user-facing descriptions so expectations match the new output style: complete writeup, not condensed summary.
  - [x] 🟩 Ensure loading, empty, success, and regenerate states all use consistent `AI Cleanup` language.

- [ ] 🟨 **Step 5: Verify notes-plus-transcript behavior explicitly**
  - [ ] 🟥 Add or update a regression check that confirms `My Notes` are still included in the final generation path.
  - [ ] 🟥 Verify that the AI Cleanup button appears when only `My Notes` has content.
  - [ ] 🟥 Verify that the AI Cleanup button appears when only transcript content exists.
  - [ ] 🟥 Verify that the AI Cleanup button appears when both sources have content.
  - [ ] 🟥 Verify that the AI Cleanup button stays hidden only when both transcript and `My Notes` are empty.
  - [ ] 🟥 Verify behavior when notes add context not present in the transcript.
  - [ ] 🟥 Verify behavior when notes overlap with transcript content, ensuring the output is cohesive rather than duplicative.
  - [ ] 🟥 Verify behavior when no notes exist, ensuring the cleanup still works correctly from transcript-only input.

- [ ] 🟨 **Step 6: Validate completeness with manual acceptance checks**
  - [ ] 🟥 Test a meeting where the user notes contain corrections, action items, and context not stated aloud.
  - [ ] 🟥 Confirm the final output includes those note-driven details.
  - [ ] 🟥 Test a dense meeting with many details and confirm the generated cleanup is materially more complete than a traditional summary.
  - [ ] 🟥 Review whether the output feels like a cohesive cleaned-up record rather than a compressed recap.

## Open Questions To Resolve During Execution

- Should the default output still include an AI-generated title, or should that be revisited as part of the cleanup-style output contract?
- Should the existing `standard_meeting` template be upgraded, or should there be a separate cleanup-first template that becomes the new default?

## Out of Scope

- Reworking note persistence bugs
- Reworking title-preservation bugs
- Building second-brain / knowledge-base functionality
- Redesigning transcript capture itself

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
