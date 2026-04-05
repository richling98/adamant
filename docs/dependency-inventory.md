# Dependency Inventory: Architecture Hardening

**Last updated:** 2026-04-04
**Based on commit:** `71d9416`

---

## 1. API Key Code Paths

### 1.1 Rust - reads raw API keys
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|
| `frontend/src-tauri/src/database/repositories/setting.rs` | 110-140 | Reads summary-provider API keys directly from `settings` SQLite columns. | 4 / 5 / 6 |
| `frontend/src-tauri/src/database/repositories/setting.rs` | 208-232 | Reads transcript-provider API keys directly from `transcript_settings` SQLite columns. | 4 / 5 / 6 |
| `frontend/src-tauri/src/database/repositories/setting.rs` | 277-310 | Reads `customOpenAIConfig` JSON, including `api_key`. | 4 / 5 / 6 |
| `frontend/src-tauri/src/api/api.rs` | 569-577 | Returns model config with raw `api_key` included in the Tauri response payload. | 4 |
| `frontend/src-tauri/src/api/api.rs` | 669-676 | Returns raw provider API key via `api_get_api_key`. | 4 |
| `frontend/src-tauri/src/api/api.rs` | 700-707 | Returns transcript config with raw `api_key` included in the Tauri response payload. | 4 |
| `frontend/src-tauri/src/api/api.rs` | 782-789 | Returns raw transcript API key via `api_get_transcript_api_key`. | 4 |
| `frontend/src-tauri/src/api/api.rs` | 1353-1361 | Returns full custom OpenAI config, including `api_key`. | 4 |
| `frontend/src-tauri/src/summary/service.rs` | 104-122, 138-171 | Runtime summary path reads provider API keys and custom OpenAI key from storage for live requests. | 5 |
| `frontend/src-tauri/src/chat/handler.rs` | 54-63 | Chat path reads provider API key and custom OpenAI config directly from storage. | 5 |

### 1.2 Rust - writes raw API keys to SQLite
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|
| `frontend/src-tauri/src/database/repositories/setting.rs` | 70-108 | Saves summary-provider API keys directly into `settings` SQLite columns. | 5 / 6 |
| `frontend/src-tauri/src/database/repositories/setting.rs` | 175-206 | Saves transcript-provider API keys directly into `transcript_settings` SQLite columns. | 5 / 6 |
| `frontend/src-tauri/src/database/repositories/setting.rs` | 234-267 | Deletes API keys by nulling SQLite columns. | 5 / 6 |
| `frontend/src-tauri/src/database/repositories/setting.rs` | 322-345 | Saves `customOpenAIConfig` JSON, including `api_key`, into SQLite. | 4 / 5 / 6 |
| `frontend/src-tauri/src/api/api.rs` | 601-655 | Accepts summary config payloads with `api_key` and persists them. | 4 / 5 / 6 |
| `frontend/src-tauri/src/api/api.rs` | 734-768 | Accepts transcript config payloads with `api_key` and persists them. | 4 / 5 / 6 |
| `frontend/src-tauri/src/api/api.rs` | 1271-1339 | Accepts custom OpenAI config payloads with `api_key` and persists them. | 4 / 5 / 6 |

### 1.3 TypeScript - receives or renders raw API keys
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|
| `frontend/src/app/settings/page.tsx` | 37-44 | Loads transcript config from Tauri and stores `apiKey` in React state. | 4 |
| `frontend/src/components/TranscriptSettings.tsx` | 38-47, 179-188 | Fetches raw transcript API key and binds it to an editable input field. | 4 |
| `frontend/src/components/SummaryModelSettings.tsx` | 26-47, 101-106 | Loads model config, fetches raw provider key and custom OpenAI key, and passes them through UI state/save flow. | 4 |
| `frontend/src/components/ModelSettingsModal.tsx` | 141-150, 232-267, 683-691, 870-877 | Fetches raw provider/custom keys and renders them into visible/editable inputs. | 4 |
| `frontend/src/components/Sidebar/index.tsx` | 254-263, 288-290 | Sidebar settings flow fetches raw model/transcript config and provider API keys into UI state. | 4 |
| `frontend/src/hooks/meeting-details/useModelConfiguration.ts` | 27-42, 48-61, 112-139 | Meeting details flow loads raw provider/custom keys and includes them in save payloads. | 4 |
| `frontend/src/services/configService.ts` | 11-33, 53-62, 85-102, 112-121 | Config service type shapes and calls treat `apiKey` as normal frontend data. | 4 |
| `frontend/src/contexts/ConfigContext.tsx` | 204, 237 | Stores transcript and custom OpenAI `apiKey` values in shared frontend config state. | 4 |

### 1.4 Python - receives or returns API keys
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|
| `backend/app/db.py` | 602-663 | Saves and reads summary-provider API keys from SQLite. | 8 / 9 / 10 / 11 |
| `backend/app/db.py` | 721-787 | Saves and reads transcript-provider API keys from SQLite. | 8 / 9 / 10 / 11 |
| `backend/app/db.py` | 883-898 | Deletes summary-provider API keys by clearing SQLite columns. | 8 / 11 |
| `backend/app/main.py` | 670-678 | `GET /get-model-config` returns model config and injects raw `apiKey` into the response. | 8 |
| `backend/app/main.py` | 680-686 | `POST /save-model-config` accepts raw `apiKey` and saves it. | 8 |
| `backend/app/main.py` | 688-696 | `GET /get-transcript-config` returns transcript config and injects raw `apiKey` into the response. | 8 |
| `backend/app/main.py` | 698-704 | `POST /save-transcript-config` accepts raw `apiKey` and saves it. | 8 |
| `backend/app/main.py` | 709-720 | `/get-api-key` and `/get-transcript-api-key` return raw key values directly. | 8 |
| `backend/app/transcript_processor.py` | 113-142 | Summary/transcript processing runtime reads raw provider keys from DB to create clients. | 11 |

### 1.5 Tauri commands that return raw keys (must be deprecated in Step 4)
| Command name | File | Return type | Replacement |
|-------------|------|------------|-------------|
| `api_get_model_config` | `frontend/src-tauri/src/api/api.rs` | `Result<Option<ModelConfig>, String>` where `ModelConfig.api_key` is populated | Return non-secret config only; add `api_has_key(provider)` |
| `api_get_api_key` | `frontend/src-tauri/src/api/api.rs` | `Result<String, String>` | `api_has_key(provider)` and later internal secret-store reads |
| `api_get_transcript_config` | `frontend/src-tauri/src/api/api.rs` | `Result<Option<TranscriptConfig>, String>` where `TranscriptConfig.api_key` is populated | Return non-secret transcript config only; add `api_has_transcript_key(provider)` |
| `api_get_transcript_api_key` | `frontend/src-tauri/src/api/api.rs` | `Result<String, String>` | `api_has_transcript_key(provider)` and later internal secret-store reads |
| `api_get_custom_openai_config` | `frontend/src-tauri/src/api/api.rs` | `Result<Option<CustomOpenAIConfig>, String>` including `api_key` | Split into non-secret config read plus presence-only secret API |

---

## 2. localhost:5167 Dependencies

| File | Line(s) | Feature | Classification (A/B/C) | Notes |
|------|---------|---------|------------------------|-------|
| `frontend/src-tauri/src/api/api.rs` | 22 | Hardcoded backend URL constant | B | Rust still carries `APP_SERVER_URL = "http://localhost:5167"` for backend-facing compatibility commands. |
| `frontend/src/components/Sidebar/SidebarProvider.tsx` | 185-189 | Frontend server-address bootstrap | A | Hardcodes `http://localhost:5167` into context, but downstream config fetches now use Tauri `invoke`, not direct HTTP. This is a leftover compatibility assumption. |
| `frontend/src/components/Sidebar/index.tsx` | 247-251, 281-285 | Guard before fetching settings/config | A | Waits for `serverAddress` even though it then calls Tauri commands. Behavior can be simplified after inventory cleanup. |
| `frontend/src/hooks/meeting-details/useModelConfiguration.ts` | 7-11, 21-27, 85-86 | Meeting details settings loader | A | Still depends on `serverAddress` prop to trigger loading, but actual reads are via Tauri commands. |

Summary of current frontend/backend URL dependency state:
- No verified frontend production code path in `frontend/src/` directly calls `http://localhost:5167`; the surviving dependency is mostly a loaded-URL compatibility flag.
- Rust still contains the backend URL constant, so the backend compatibility surface has not been fully retired.

---

## 3. Recording State Sync Points

### 3.1 Event emitters (Rust -> Frontend)
| File | Line(s) | Event name | Payload |
|------|---------|-----------|---------|
| `frontend/src-tauri/src/audio/recording_commands.rs` | 381-385, 579-586 | `recording-started` | JSON with start message, devices, workers |
| `frontend/src-tauri/src/audio/recording_commands.rs` | 1123-1130 | `recording-stopped` | JSON with stop message, `folder_path`, `meeting_name` |
| `frontend/src-tauri/src/audio/recording_commands.rs` | 1170-1175 | `recording-paused` | JSON message |
| `frontend/src-tauri/src/audio/recording_commands.rs` | 1204-1209 | `recording-resumed` | JSON message |
| `frontend/src-tauri/src/tray.rs` | 94-95, 190-191 | `recording-stop-complete` | Boolean completion flag |
| `frontend/src-tauri/src/audio/transcription/worker.rs` | 184-187 | `speech-detected` | JSON speech-detected event |
| `frontend/src-tauri/src/audio/transcription/worker.rs` | 222-225 | `transcript-update` | Transcript segment/update payload |
| `frontend/src-tauri/src/audio/recording_commands.rs` | 151, 436, 688, 739, 789, 817, 855, 1047 | `transcription-error`, `recording-auto-stopped`, `recording-shutdown-progress`, related recording lifecycle events | Mixed JSON/string lifecycle payloads |

### 3.2 Event listeners (Frontend)
| File | Line(s) | Event name | What it updates |
|------|---------|-----------|-----------------|
| `frontend/src/services/recordingService.ts` | 120-170 | `recording-started`, `recording-stopped`, `recording-paused`, `recording-resumed`, `chunk-drop-warning`, `speech-detected` | Shared wrappers that feed app-level state/hooks |
| `frontend/src/contexts/RecordingStateContext.tsx` | 133-216 | `recording-started`, `recording-stopped`, `recording-paused`, `recording-resumed` | Global recording state, polling lifecycle, pause/resume visibility |
| `frontend/src/contexts/TranscriptContext.tsx` | 99-191 | `recording-started`, `recording-stopped` | Transcript session setup, cleanup, reload recovery |
| `frontend/src/hooks/useRecordingStop.ts` | 101-136, 230-272 | `recording-stopped`, `transcription-complete` | Stop flow navigation, meeting metadata, save sequencing |
| `frontend/src/contexts/RecordingPostProcessingProvider.tsx` | 36-55 | `recording-stop-complete` | Post-processing state after tray/UI stop |

### 3.3 Polling loops
| File | Line(s) | What it polls | Interval | Event-based alternative exists? |
|------|---------|--------------|----------|--------------------------------|
| `frontend/src/contexts/RecordingStateContext.tsx` | 70, 87-117, 122-127 | `get_recording_state()` from Tauri while recording | 500ms | Yes - partial. Same file also listens to lifecycle events, but still polls for authoritative sync and refresh recovery. |
| `frontend/src/hooks/useRecordingStateSync.ts` | 10-16, 28-60 | `is_recording` from Tauri to reconcile backend/UI state | 1000ms | Yes - partial. Overlaps with `RecordingStateContext`, which suggests redundant polling. |
| `frontend/src-tauri/src/audio/recording_commands.rs` | 1353-1370 | Device disconnect/reconnect events via `poll_device_events()` | Intended 1-2s from frontend, but no verified current frontend caller | No verified event-only replacement in use. |

Notes:
- The main recording state already uses both events and polling at the same time.
- This confirms Step 12’s premise: we should inventory and measure before removing polling.

---

## 4. Legacy / Dead Code Classification

| Path | Compiled? | Referenced? | Classification | Action in Step 14 |
|------|-----------|------------|----------------|-------------------|
| `frontend/src-tauri/src/lib_old_complex.rs` | No | No | Not compiled; archived alternate entrypoint | Safe early cleanup candidate after preserving any useful reference notes |
| `frontend/src-tauri/src/audio_v2/` | No | No | Not compiled; parallel audio implementation | Defer cleanup until audio ownership review confirms nothing valuable is still being consulted manually |
| `frontend/src-tauri/src/audio/recording_saver_old.rs` | No | No | Not compiled old implementation | Safe cleanup candidate |
| `frontend/src-tauri/src/audio/recording_commands.rs.backup` | No | No | Backup artifact, not a Rust module | Safe cleanup candidate |
| `frontend/src-tauri/src/audio/core-old.rs` | No | No | Not compiled old implementation | Safe cleanup candidate |

Evidence summary:
- `frontend/src-tauri/src/audio/mod.rs` does not export `audio_v2`, `recording_saver_old`, or `core-old`.
- `frontend/src-tauri/src/lib.rs` does not declare `mod lib_old_complex`.
- `grep` for `audio_v2::` returned no in-repo references.

---
