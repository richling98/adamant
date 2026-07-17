# Speaker Attribution Improvement Plan

## Problem

The `[you]` tag (assigned to microphone-channel audio) is inaccurate — it tags speech that does not come from the Adamant user. This happens despite the existing channel-based architecture that separates mic and system audio before transcription.

## Root Cause

The architecture already separates mic and system audio **before** transcription (`pipeline.rs:853-854`), but the mic channel is not a pure signal. The likely cause is **acoustic echo**: when remote participants speak through the computer (Zoom/Teams/etc.), their audio plays through speakers, enters the room, and is picked up by the microphone. This causes:

1. Remote speech transcribed twice — once via system audio (correctly tagged as `"system"`) and once via mic audio (incorrectly tagged as `"mic"` → `[you]`)
2. Any room noise or other nearby voices on the mic are also incorrectly attributed as `[you]`

## Architecture Overview

```
Mic Audio ─────┬──► Mic VAD ──► Whisper ──► source="mic" ──► [you]
               │
System Audio ──┴──► Sys VAD ──► Whisper ──► source="system" ──► no tag
               │
               └── Mixed ──► WAV Recording
```

**Key**: The separation is already correct at the pipeline level. The issue is signal purity on the mic channel.

---

## Approach A: Acoustic Echo Cancellation (AEC) — Recommended

Apply adaptive filtering to subtract system audio from the mic signal before VAD/transcription.

### How it works

AEC uses the system audio as a "reference signal" and the mic audio as the "corrupted signal." An adaptive filter (typically NLMS — Normalized Least Mean Squares) models the room impulse response and subtracts the echo component from the mic signal.

```
System Audio (reference) ──┐
                           ├──► Adaptive Filter ──► Echo Estimate
Mic Audio (corrupted) ─────┤         │
                           │         ▼
                           └──► Subtract ──► Clean Mic Audio ──► VAD ──► Whisper
```

### Implementation

**Location**: `frontend/src-tauri/src/audio/pipeline.rs` (in the main loop, after ring buffer extraction, before VAD)

**Steps**:
1. Add an AEC processor module: `frontend/src-tauri/src/audio/aec.rs`
2. In the pipeline loop, after extracting `mic_window` and `sys_window`, run AEC:
   - Feed `sys_window` as the reference signal
   - Feed `mic_window` as the corrupted signal
   - Get back a clean mic signal with echo suppressed
3. Send clean mic through `process_source_audio` instead of raw mic
4. Optionally adjust the filter's learning rate based on double-talk detection (when both user and remote participant speak simultaneously)

**Complexity**: ~300-500 lines of Rust. Requires:
- NLMS adaptive filter implementation (can use existing DSP crates: `dasp` or `rubato`)
- Frame-by-frame processing with overlap handling
- Double-talk detector to prevent filter divergence

**Pros**:
- Addresses the root cause (echo on mic channel)
- No false negatives — actual user speech passes through unaffected
- Works in real-time (low latency)
- Existing `dasp` crate already in dependencies

**Cons**:
- Requires tuning filter parameters (step size, filter length)
- Adaptive filter can diverge in high-noise or non-linear echo paths
- Adds ~1-5ms latency depending on filter length

---

## Approach B: Temporal Overlap Suppression

Use the **already-transcribed** system audio timestamps to discard mic-transcribed segments that overlap in time.

### How it works

When a system-audio transcription and a mic-audio transcription have overlapping timestamps, the system-audio entry likely caused an echo on the mic. Discard or downgrade the mic version.

```
System trans: "Let's review the Q3 numbers"  [12:34.5 - 12:38.2]
Mic trans:    "Let's review the Q3 numbers"  [12:34.7 - 12:38.5]  ← ECHO, discard
```

### Implementation

**Location**: `frontend/src-tauri/src/audio/transcription/worker.rs` (after both transcriptions complete)

Two sub-approaches:

#### B1: Post-hoc dedup in worker.rs

After each transcription completes, check against recent system-transcribed segments using timestamp overlap + text similarity (cosine similarity of whisper embeddings or simple Levenshtein ratio). If overlap > 50% and text similarity > 70%, suppress the mic segment.

**Complexity**: ~150-200 lines of Rust

**Pros**:
- No audio processing needed
- Simple to implement
- Works even if AEC would fail (non-linear echo)

**Cons**:
- Post-hoc — echo already consumed Whisper inference time
- Needs text similarity comparison (adds latency)
- Hard to tune thresholds without false positives

#### B2: Pre-VAD suppression in pipeline.rs

Before running VAD on mic audio, check if the system audio had recent speech activity. Silence the mic VAD during high system-activity periods.

**Complexity**: ~50-100 lines of Rust

**Pros**:
- Saves Whisper inference time (don't transcribe echo at all)
- Simple — just gate mic VAD based on system VAD state

**Cons**:
- Crude — suppresses mic during ALL system speech, including when the user is actually speaking over someone (double-talk)
- Would cause false negatives for the user interrupting

---

## Approach C: Voice Fingerprinting (Speaker Embedding)

Enroll the user's voice with a short recording, then use speaker embeddings (e.g., ECAPA-TDNN or a simple i-vector model) to verify each mic segment is actually the user.

### Implementation

**Location**: New module `frontend/src-tauri/src/audio/speaker_id.rs`

1. **Enrollment**: During onboarding or first recording, capture 10-30 seconds of the user's voice from the mic
2. **Embedding extraction**: Run each mic VAD segment through a small speaker embedding model (or use a simple spectral comparison)
3. **Verification**: Compare the segment's embedding against the enrolled user embedding. If below similarity threshold, don't tag as `[you]`.

**Complexity**: ~500-800 lines of Rust + model integration

**Pros**:
- Robust against echo, room noise, and other nearby voices
- Industry-standard approach for speaker diarization

**Cons**:
- Requires a speaker embedding model (no small model currently in deps)
- Enrollment step creates UX friction
- Model inference adds latency and memory
- Speaker embeddings can degrade in noisy environments

---

## Approach D: Stereo Transcription (Whisper Server Diarization)

The Whisper server (`backend/whisper-custom/server/server.cpp:253-284`) already has `estimate_diarization_speaker` that uses stereo energy comparison. Send mic on left channel and system on right channel as a stereo WAV.

### Implementation

**Location**: `frontend/src-tauri/src/audio/transcription/worker.rs` and `backend/whisper-custom/server/server.cpp`

**Complexity**: ~200-300 lines

**Pros**:
- Leverages existing diarization code
- No new model dependencies

**Cons**:
- Only works with the Whisper server (not local Whisper/Parakeet)
- Energy-based diarization is unreliable (can't distinguish user from other speaker if volumes are similar)
- Doesn't solve the fundamental echo problem — both channels still have echo

---

## Recommendation

### Phase 1 (Quick Win) — Approach B1: Temporal Overlap Suppression

Implement in `worker.rs` within **2-3 days**. Simple, no audio processing changes, immediately reduces false `[you]` tags. Use timestamp overlap + Levenshtein ratio as the dedup heuristic.

### Phase 2 (Proper Fix) — Approach A: Acoustic Echo Cancellation

Implement a real-time AEC module in `pipeline.rs`. This addresses the root cause and improves recording quality for the WAV file as well. Timeline: **1-2 weeks**.

### Phase 3 (Future Hardening) — Approach C: Voice Fingerprinting

Add speaker embedding verification as a final confidence check. Only needed if echo cancellation + overlap suppression still produce false positives. Timeline: **2-4 weeks**.

## Success Criteria

- False `[you]` tags reduced by >90%
- No increase in false negatives (actual user speech not tagged `[you]`)
- Overall latency increase < 50ms
- Transcription accuracy preserved or improved
