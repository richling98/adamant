# Adamant Feature Wishlist

This document captures the product and quality improvements requested for Adamant so they can be tracked in one place.

## Feature Table

| Date Added | Feature | Summary | Plan |
| --- | --- | --- | --- |
| 2026-04-06 | Improve silence detection during transcription | Redesign silence auto-stop so continuous speech is not mistaken for silence, and long speech still flushes transcript chunks. | Done. See [improve-silence-detection.md](/Users/richardling/Documents/Documents%20-%20Updated/Projects/adamant/docs/plans/improve-silence-detection.md) |
| 2026-04-06 | Preserve `My Notes` when transcripts save or refresh | Transcript and meeting refreshes must never wipe the user's personal notes. | Done. See [preserve-notes-on-transcript-save.md](/Users/richardling/Documents/Documents%20-%20Updated/Projects/adamant/docs/plans/preserve-notes-on-transcript-save.md) |
| 2026-04-06 | Apply silence settings live during active recordings | Changing the silence auto-stop duration or toggling it off in Settings should take effect immediately without restarting the recording. | Done. No separate plan (3-file change: new `update_silence_settings` Tauri command, registered in `lib.rs`, invoked from `RecordingSettings.tsx`). |
| 2026-04-06 | Turn AI Summary into AI Cleanup | Rename the frontend feature to `AI Cleanup`, make it use transcript and notes together, and allow notes-only cleanup generation. | In progress. See [comprehensive-ai-cleanup.md](/Users/richardling/Documents/Documents%20-%20Updated/Projects/adamant/docs/plans/comprehensive-ai-cleanup.md) |
| 2026-04-06 | Turn Adamant into a "second brain" | Build a personal wiki and knowledge base that the user can chat with over time. | Not yet split into its own plan |
| 2026-04-06 | Keep meeting titles strictly user-driven | The app must never overwrite or reset a meeting title, including resetting it to `Add title here` after transcript save or AI note generation. | Not yet split into its own plan |

## Current Wishlist

### 1. Improve silence detection during transcription

**Status:** Done

Adamant should stop ending transcript segments too early when a speaker is still talking. The current silence detection appears to be too aggressive, which causes speech to get cut off before a thought is finished.

**Desired outcome:**
- Better end-of-speech detection
- Fewer prematurely truncated transcript segments
- More natural transcript chunking during live capture

**Plan:** Completed. See [improve-silence-detection.md](/Users/richardling/Documents/Documents%20-%20Updated/Projects/adamant/docs/plans/improve-silence-detection.md)

### 2. Preserve `My Notes` when transcripts save or refresh

**Status:** Done

When the transcript saves, the UI currently refreshes too aggressively and wipes the user's personal notes. `My Notes` should remain intact across transcript saves, data refreshes, and other meeting updates.

**Desired outcome:**
- Transcript persistence does not overwrite user-authored notes
- Refresh behavior is incremental instead of destructive
- Notes remain stable while recording and after autosaves

**Plan:** Completed. See [preserve-notes-on-transcript-save.md](/Users/richardling/Documents/Documents%20-%20Updated/Projects/adamant/docs/plans/preserve-notes-on-transcript-save.md)

### 2b. Apply silence settings live during active recordings

**Status:** Done

Changing the silence auto-stop duration or toggling it off in Settings had no effect on an already-running recording — the monitor was baked in at recording start with the old value.

**What was built:**
- New `update_silence_settings` Tauri command aborts the running monitor and spawns a fresh one (or stops it) immediately when called
- `RecordingSettings.tsx` invokes this command after every silence preference save, so changes apply live

### 3. Turn AI Summary into AI Cleanup

**Status:** In progress

The end-of-meeting AI feature should act like a comprehensive cleanup rather than a short summary. It should consider both the transcript and the user's notes, and it should be available whenever either source has content.

**Desired outcome:**
- AI Cleanup uses both `My Notes` and `Transcript` together
- User notes can influence the final cleanup, action items, and takeaways
- The cleanup reflects what was said and what the user intentionally wrote down
- The frontend uses `AI Cleanup` naming instead of `AI Summary`
- The AI Cleanup button appears when transcript and/or notes content exists

**Implemented so far:**
- Notes are already passed into the generation path alongside transcript content
- The frontend has been renamed from `AI Summary` to `AI Cleanup` in the main meeting flow
- The generate button now appears when transcript content and/or `My Notes` content exists
- Notes-only cleanup generation now works by using live editor content instead of waiting for autosave
- The default cleanup template and backend prompt have been tightened to push the output toward a complete cleanup instead of a short summary

**Plan:** In progress. See [comprehensive-ai-cleanup.md](/Users/richardling/Documents/Documents%20-%20Updated/Projects/adamant/docs/plans/comprehensive-ai-cleanup.md)

### 4. Turn Adamant into a "second brain"

Adamant should evolve beyond a meeting recorder into a Karpathy-style second brain that develops its own personal wiki and knowledge base over time. The user should be able to chat with this memory system and retrieve useful context across meetings, notes, and summaries.

**Desired outcome:**
- Build a persistent personal knowledge base from meetings and notes
- Organize information into reusable entities like people, projects, concepts, decisions, and action items
- Maintain a living personal wiki that improves over time
- Let the user chat with their knowledge base and get grounded answers
- Include citations or links back to source meetings, notes, and summaries
- Preserve user control, privacy, and editability over what gets remembered

### 5. Keep meeting titles strictly user-driven

When the transcript saves and AI-generated notes or summaries are produced, the meeting title should never be changed by the app. In particular, the title must never be reset to the default placeholder `Add title here`. The title should only change when the user explicitly edits it.

**Desired outcome:**
- The app never overwrites a user-provided meeting title
- The app never resets a title to `Add title here` during save, refresh, summary generation, or AI note generation
- Title state is treated as user-owned and remains stable across all background app workflows

## Product Direction Summary

Taken together, these requests point toward a clear direction for Adamant:

- Improve transcript quality at capture time
- Protect the user's manual notes as a first-class input
- Preserve user-owned meeting metadata like titles
- Generate better summaries by combining transcript data with user-authored context
- Grow Adamant into a privacy-first memory system that users can query like a personal knowledge assistant

## Suggested Implementation Order

1. ✅ Fix note loss during transcript save/refresh
2. ✅ Refine silence detection so transcript capture is more reliable
3. ✅ Apply silence settings live during active recordings
4. 🟨 Finish AI Cleanup behavior and output-quality validation
5. Preserve meeting titles so the app never overwrites user-authored titles
6. Design and implement the long-term second-brain / personal wiki architecture
