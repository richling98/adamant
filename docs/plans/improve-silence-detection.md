# Feature Implementation Plan: Redesign Silence Detection and Speech Segmentation

**Overall Progress:** `88%`

## TLDR

Adamant currently uses completed VAD segments as the proxy for "recent voice activity." That is the core architectural bug. If a speaker talks continuously and no segment closes, the silence monitor can incorrectly conclude that the room is silent and auto-stop the meeting.

This plan replaces that coupling with a two-signal design:

- a continuous `speech_presence` signal for silence auto-stop and live activity tracking
- a separate `speech_segments` / chunking pipeline for transcription and transcript UX

The redesign keeps silence detection focused on whether speech is happening now, while transcript chunking decides when to flush text to Whisper and the UI. This is a structural fix, not a threshold tweak.

## End Result

When someone is speaking continuously, Adamant keeps refreshing recent voice activity even if no natural pause occurs. The app no longer interprets uninterrupted speech as silence. At the same time, the transcript still updates during long monologues by flushing chunks on max-duration boundaries, not only on pause boundaries.

## Critical Decisions

* **Separate activity detection from transcript segmentation** - silence auto-stop should be driven by live speech presence, not by whether a transcript segment happened to close.
* **Treat VAD as a continuous signal first, segment builder second** - the base unit should be frame- or batch-level speech presence, with chunk emission layered on top.
* **Add forced transcript flushes for long continuous speech** - transcript UX should not stall just because a speaker never pauses.
* **Keep overlap between forced chunks** - chunk overlap reduces word loss and awkward transcript boundaries when we flush mid-utterance.
* **Prefer explicit state and metrics over hidden heuristics** - the new design should expose why speech is considered active, why a segment was flushed, and why silence auto-stop did or did not advance.

## Current Problem Summary

Today the silence monitor in `frontend/src-tauri/src/audio/recording_commands.rs` only looks at `last_voice_activity_ms`. That timestamp is updated by `RecordingState::update_voice_activity()` in `frontend/src-tauri/src/audio/recording_state.rs`, and the pipeline currently calls that only when the VAD returns one or more completed speech segments in `frontend/src-tauri/src/audio/pipeline.rs`.

That means:

- continuous speech without a pause may produce no new completed segment
- no completed segment means no `last_voice_activity_ms` refresh
- stale voice-activity state can be mistaken for silence
- silence auto-stop can fire while someone is still talking

This is the wrong dependency direction. Silence detection must be based on current speech presence, not transcript-boundary creation.

## Target Architecture

### Signal 1: Continuous Speech Presence

The VAD layer should expose a continuous notion of whether speech is present in recent audio, based on short frames or batches. This signal should be updated while speech is ongoing, not only when a segment ends.

**Responsibilities:**
- refresh `last_voice_activity_ms` whenever recent frames indicate speech
- drive silence auto-stop
- support speaking indicators or live activity UI
- remain independent from transcript flush timing

### Signal 2: Speech Segments / Transcript Chunks

A separate segment builder should decide when to emit audio to transcription. It can close chunks on natural pauses, but it should also force-flush long-running speech so transcript updates continue during monologues.

**Responsibilities:**
- build natural transcript chunks when pauses occur
- force flush on max duration even without pauses
- optionally use overlap when flushing during continuous speech
- drive Whisper transcription and transcript UI updates

## Tasks

- [x] 🟩 **Step 1: Untangle silence auto-stop from completed transcript segments**
  - [x] 🟩 In `frontend/src-tauri/src/audio/recording_state.rs`, introduce a dedicated speech-activity update path intended for continuous VAD presence, distinct from "segment completed" semantics.
  - [x] 🟩 In `frontend/src-tauri/src/audio/pipeline.rs`, stop using `speech_segments.is_empty()` as the only trigger for refreshing recent voice activity.
  - [x] 🟩 In `frontend/src-tauri/src/audio/recording_commands.rs`, keep the silence monitor focused on `last_voice_activity_ms`, but ensure that timestamp now represents live speech presence rather than completed chunk emission.

- [x] 🟩 **Step 2: Extend the VAD layer to expose continuous speech presence**
  - [x] 🟩 In `frontend/src-tauri/src/audio/vad.rs`, add state that tracks whether recent frames indicate active speech, even before a `SpeechEnd` transition occurs.
  - [x] 🟩 Expose a per-batch result from the VAD processor that distinguishes:
    - current speech presence
    - completed speech segments ready for transcription
  - [x] 🟩 Preserve the existing VAD transition logic where possible, but refactor the API so the pipeline can consume both signals independently.

- [x] 🟩 **Step 3: Redesign transcript chunk emission for continuous speech**
  - [x] 🟩 In `frontend/src-tauri/src/audio/vad.rs` or a dedicated helper, introduce a chunking policy that supports both:
    - natural flush on genuine end-of-speech
    - forced flush on max segment duration during uninterrupted speech
  - [x] 🟩 Define a max-duration target for live transcription chunks so long monologues still appear incrementally in the transcript.
  - [x] 🟩 Add chunk overlap for forced flushes so words near boundaries are less likely to be dropped or split awkwardly.

- [x] 🟩 **Step 4: Update the pipeline to consume both signals correctly**
  - [x] 🟩 In `frontend/src-tauri/src/audio/pipeline.rs`, refresh voice activity based on continuous speech-presence results, not only on completed segments.
  - [x] 🟩 Continue sending completed or forced-flush segments to the transcription worker.
  - [x] 🟩 Ensure shutdown and flush behavior still drains remaining in-flight speech correctly without falsely training the silence monitor to think speech is absent during active audio.

- [x] 🟩 **Step 5: Add observability for the redesigned behavior**
  - [x] 🟩 Add structured logs or metrics that show:
    - speech-presence refreshes
    - segment-open and segment-close events
    - forced flushes due to max duration
    - silence-monitor ticks and why they reset or advanced
  - [x] 🟩 Log the active chunking policy at pipeline startup so test sessions are interpretable.
  - [x] 🟩 Make it easy to tell from logs whether a stop was caused by true inactivity or stale activity state.

- [ ] 🟨 **Step 6: Add regression coverage for the architectural failure mode**
  - [x] 🟩 Add a test or harness case for continuous speech with no pause and verify that speech activity stays alive while transcript chunks still flush periodically.
  - [ ] 🟥 Add a case for short natural pauses within one thought and verify they do not incorrectly trip silence counting.
  - [ ] 🟥 Add a case for genuine silence after speech and verify the silence monitor eventually advances toward auto-stop.
  - [x] 🟩 Add a case for shutdown flush behavior and verify it preserves the tail of speech without corrupting silence state.

- [ ] 🟨 **Step 7: Verify behavior in the live app**
  - [x] 🟩 Run `cargo check` in `frontend/src-tauri`.
  - [x] 🟩 Run targeted automated tests for the new speech-presence gate and forced-flush chunking helpers.
  - [ ] 🟥 Test a long uninterrupted monologue and confirm:
    - the meeting does not auto-stop
    - transcript chunks still appear during the monologue
  - [ ] 🟥 Test a normal conversational meeting with brief pauses and confirm chunking still feels natural.
  - [ ] 🟥 Test genuine silence and confirm auto-stop still works as intended.

## Proposed Behavioral Policy

The redesign should follow this policy:

- `speech_presence` updates on small audio windows, continuously
- silence auto-stop resets whenever recent speech presence is observed
- transcript segments close on real end-of-speech when possible
- transcript segments also force-flush after a max duration during continuous speech
- forced-flush chunks include overlap so we do not lose boundary words

This gives Adamant the correct behavior for both live meetings and transcript UX.

## Risks and Watchouts

* **Over-flushing can hurt transcript quality** - if max-duration flushes are too aggressive, transcripts may become choppy or repetitive.
* **Under-flushing hurts live UX** - if max-duration flushes are too rare, the transcript can feel frozen during long speech.
* **Overlap requires careful deduplication downstream** - overlapping chunks can improve recall, but transcript merging must avoid obvious duplicates.
* **Silence-monitor behavior must remain pause-aware** - manual pause state still needs to freeze auto-stop cleanly.

## Out of Scope

- Replacing Silero with a different VAD engine
- Reworking summary generation
- Broader transcript post-processing or diarization changes unrelated to silence/activity tracking

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do
