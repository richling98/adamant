# Feature Implementation Plan: AI Summary Quality Fixes

**Overall Progress:** `100%`

## TLDR
Three targeted fixes to improve AI-generated meeting notes: (1) eliminate all brevity bias from prompts so output is a complete, organized record of everything said; (2) remove the "Attendees" section from all templates since audio transcription cannot reliably identify who was present vs merely mentioned; (3) strip owner attribution from Next Steps / Action Items instructions so the focus is on the action itself.

## Architecture Overview

**Touch points (no Rust recompile needed for template changes — templates are loaded from disk at runtime):**

- **`processor.rs`** — system prompts for chunk summarization, chunk combination, and final report generation
- **`standard_meeting.json`** — primary template: remove "Key Attendees", update Topics Covered + Next Steps instructions
- **`daily_standup.json`** — remove "Attendees" section
- **`project_sync.json`** — remove "Attendees" section, update "Action Items" instruction (remove owner/due date emphasis)
- **`sales_marketing_client_call.json`** — remove "Attendees" section, update "Next Steps" instruction

## End Result

Generated meeting notes read as a thorough, organized record of the conversation — every topic covered in detail, every decision captured, every action item listed clearly. No attendees section that guesses who was present. Action items are stated as plain tasks without incorrectly assigning owners the AI can't verify.

## Critical Decisions

* **Remove Attendees from ALL templates, not just standard_meeting:** The root cause (audio has no speaker identity) applies equally to every template. Leaving it in daily_standup or project_sync would produce the same inaccurate output there.
* **Reframe role from "summarizer" to "scribe" in processor.rs:** The word "summarizer" semantically primes the model toward compression. Replacing it with "scribe" or "documentation specialist" shifts the frame toward completeness without changing the structural output format.
* **Don't remove owner field from templates where it's structural (e.g. Agreed Deliverables in sales template):** Owner attribution makes sense when the user has explicitly agreed on a deliverable owner during a client call. Only strip it from action-item / next-steps instructions where the AI is guessing.

## Tasks

- [x] 🟩 **Step 1: Update `processor.rs` — eliminate brevity bias from all LLM prompts**
  - [x] 🟩 Chunk summary system prompt: changed to "expert meeting scribe, capture everything — not condense"
  - [x] 🟩 Chunk summary user prompt: reframed to "transcribe and organize ALL content, do NOT summarize"
  - [x] 🟩 Chunk combination system prompt: same scribe reframe, forbids discarding content
  - [x] 🟩 Chunk combination user prompt: every concept from every section must appear in merged output
  - [x] 🟩 Final system prompt: role changed to "expert meeting scribe", added instructions 8 & 9 making completeness mandatory

- [x] 🟩 **Step 2: Update `standard_meeting.json`**
  - [x] 🟩 Remove the entire "Key Attendees" section object
  - [x] 🟩 Update "Topics Covered" instruction to emphasize verbatim capture of every concept discussed
  - [x] 🟩 Update "Next Steps & Action Items" instruction: focus on the action itself, remove the owner-attribution format (`**[Owner]** —`)

- [x] 🟩 **Step 3: Update other templates — remove Attendees, fix action item instructions**
  - [x] 🟩 `daily_standup.json` — remove "Attendees" section
  - [x] 🟩 `project_sync.json` — remove "Attendees" section; update "Action Items" instruction to remove owner/due-date emphasis
  - [x] 🟩 `sales_marketing_client_call.json` — remove "Attendees" section; update "Next Steps" instruction to focus on the action

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
