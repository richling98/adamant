# Chatbot: Model Picker & Initialization Fix

> Spec for fixing the "No model configured" bug and adding a model status/picker to the chatbot UI.

---

## Table of Contents

1. [Part A: Fix the "No model configured" Bug](#part-a-fix-the-no-model-configured-bug)
2. [Part B: Add Model Picker to Chatbot UI](#part-b-add-model-picker-to-chatbot-ui)
3. [Files Modified](#files-modified)
4. [Tasks](#tasks)

---

## Part A: Fix the "No model configured" Bug

### Problem

When a user opens the app (non-first-launch path) and sends their first chat message, they see the error:

> "No model configured. Please set up a model in Settings."

This happens even when a model is configured via the Settings page. The user must refresh or send a second message for it to work.

### Root Cause

The `setup.rs` startup flow has a gap in the **non-first-launch** path:

```
setup.rs :: initialize_database_on_startup()

  First-launch path (no DB file exists):
    └─ emit "first-launch-detected" → frontend calls initialize_fresh_database()
         ├─ DatabaseManager::new_from_app_handle() → runs migrations
         ├─ app.manage(AppState { db_manager })
         ├─ save_model_config("builtin-ai", "gemma3:1b", ...)  ← seeds default row
         └─ emit "database-initialized"

  Non-first-launch path (DB file exists):
    └─ DatabaseManager::new_from_app_handle() → runs migrations
         ├─ app.manage(AppState { db_manager })
         └─ ← NO default settings row seeded!
```

On the **non-first-launch path**, the database is opened, migrations are run, and AppState is managed — but **no default `settings` row is ever inserted**. If the `settings` table was dropped by a migration (which has happened — the migration `20250920155811_add_openrouter_api_key.sql` drops and recreates the table), or if it was never seeded (e.g., the first-launch path's `save_model_config` failed silently), the table will be empty.

When `chat_with_meetings` calls `SettingsRepository::get_model_config()`:

```rust
// chat/handler.rs:54-57
let setting = SettingsRepository::get_model_config(&pool)
    .await
    .map_err(|e| format!("Failed to read model config: {e}"))?
    .ok_or_else(|| "No model configured. Please set up a model in Settings.".to_string())?;
```

It gets `Ok(None)` → the ".ok_or_else" converts it to the error message.

**Why the Settings page shows a model**: The frontend `ConfigContext` falls back to hardcoded defaults (`ollama` / `llama3.2:latest`) when `api_get_model_config` returns `None`. So the Settings page appears populated even though no row exists in the database.

### Fix

#### Fix 1: Seed default settings row on all startup paths

In `setup.rs`, after the non-first-launch path creates `AppState`, check if a settings row exists and insert defaults if not:

```rust
// setup.rs — after app.manage(AppState { db_manager })
let pool = db_manager.pool();
let setting = SettingsRepository::get_model_config(pool).await
    .map_err(|e| format!("Failed to read model config: {e}"))?;

if setting.is_none() {
    info!("No model config found — seeding default settings row");
    SettingsRepository::save_model_config(
        pool,
        "builtin-ai",
        "gemma3:1b",
        "large-v3",
        None,
    ).await.map_err(|e| format!("Failed to seed default model config: {e}"))?;
}
```

This ensures the settings table is never empty, regardless of how the app was started.

#### Fix 2: Propagate errors from default seeding in `initialize_fresh_database`

In `commands.rs::initialize_fresh_database()` (line 194), the `save_model_config` and `save_transcript_config` calls currently log errors but do NOT propagate them:

```rust
// Current code (line 194-202):
if let Err(e) = SettingsRepository::save_model_config(...).await {
    error!("Failed to set default summary model config: {}", e);
    // ← error swallowed, function returns Ok(())
}
```

Change to return an error so the frontend knows defaults weren't written:

```rust
if let Err(e) = SettingsRepository::save_model_config(...).await {
    error!("Failed to set default summary model config: {}", e);
    return Err(format!("Failed to set default model config: {e}"));
}
```

#### Fix 3: Chat handler retry on empty settings

In `chat/handler.rs`, add a one-time retry with a small delay if `get_model_config` returns `None`, to handle any residual WAL snapshot isolation edge case:

```rust
let setting = match SettingsRepository::get_model_config(&pool).await {
    Ok(Some(s)) => s,
    Ok(None) => {
        // Retry once in case of WAL snapshot isolation
        tokio::time::sleep(Duration::from_millis(100)).await;
        SettingsRepository::get_model_config(&pool).await
            .map_err(|e| format!("Failed to read model config: {e}"))?
            .ok_or_else(|| "No model configured. Please set up a model in Settings.".to_string())?
    }
    Err(e) => return Err(format!("Failed to read model config: {e}")),
};
```

### Verification

1. Delete `~/Library/Application Support/com.adamant.ai.dev/meeting_minutes.sqlite`
2. Launch dev app
3. Skip or complete onboarding
4. Open chat → send a message → should NOT see "No model configured"
5. Verify in Settings that model shows as "Built-in AI" / "gemma3:1b"

---

## Part B: Add Model Picker to Chatbot UI

### Problem

The chatbot window shows no indication of which model is being used. Users have to navigate to the Settings page to see or change the model. This creates confusion when errors occur ("No model configured" with no way to fix it from the chat window).

### Design

Add a lightweight model status indicator + inline model selector to the chatbot panel header. The design should be:

1. **A small pill/badge** in the header showing the current provider + model (e.g., `Built-in AI · gemma3:1b`)
2. **When there's no model configured**, the badge shows "No model selected" in amber/warning color
3. **Clicking the badge** opens a compact inline model picker dropdown inside the panel (no modal, no navigation to Settings)
4. **The model picker** shows the same provider dropdown and model dropdown as `ModelSettingsModal`, in a compact layout
5. **Changing the model** in the chatbot picker immediately calls `api_save_model_config` (same as Settings Save) and updates the UI
6. **Syncing**: If the model is changed in the Settings page, the chatbot picker reflects the change via the existing `model-config-updated` Tauri event
7. **Scope**: The chatbot model picker only shows summary/chat model config (not transcription config)

### UI Mockup

```
┌──────────────────────────────────────────────────────────────┐
│  Chat with your meetings                         [🗑] [✕]   │
│  ┌──────────────────────────────────── Model ────────────┐  │
│  │  Built-in AI · gemma3:1b                          [▼] │  │
│  └────────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  (messages area...)                                      ││
│  │                                                          ││
│  └──────────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────────┐│
│  │  Ask about your meetings…                          [➤]  ││
│  └──────────────────────────────────────────────────────────┘│
│                    Enter to send · Shift+Enter for new line   │
└──────────────────────────────────────────────────────────────┘
```

When the badge is clicked, it expands to an inline picker:

```
┌──────────────────────────────────────────────────────────────┐
│  Chat with your meetings                         [🗑] [✕]   │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  AI Model                                                ││
│  │  ┌─────────────────────────────────────────────────────┐ ││
│  │  │  Built-in AI (Offline, No API needed)          [▼] │ ││
│  │  ├─────────────────────────────────────────────────────┤ ││
│  │  │  Gemma 3 1B (Default)                            │ ││
│  │  │  (or other models in dropdown)                      │ ││
│  │  └─────────────────────────────────────────────────────┘ ││
│  └──────────────────────────────────────────────────────────┘│
│  (messages area...)                                          │
└──────────────────────────────────────────────────────────────┘
```

The expandable picker replaces the badge in-place. Clicking outside or selecting a model collapses it back to the badge.

### Data Flow

#### Loading model config in the chatbot

```
FloatingChatBubble mounts
  │
  └─ useMeetingChat hook initializes
       │
       ├─ On mount: invoke('api_get_model_config')
       │    └─ Returns { provider, model, whisperModel, hasApiKey, ollamaEndpoint }
       │
       └─ Stores as local state: chatModelConfig
            │
            └─ Renders provider + model in the header badge
```

#### Changing model in the chatbot picker

```
User selects new provider/model in inline picker
  │
  └─ handleSaveModelConfig(newConfig)
       │
       ├─ invoke('api_save_model_config', { provider, model, whisperModel, apiKey, ollamaEndpoint })
       │    └─ Rust: saves to SQLite, shuts down old sidecar
       │
       ├─ On success: emit('model-config-updated', savedConfig)
       │    └─ ConfigContext listens → updates its state
       │    └─ SummaryModelSettings listens → updates its state
       │    └─ Sidebar listens → updates its state
       │
       └─ Update local chatModelConfig state → badge updates immediately
```

#### Reacting to model changes from Settings page

```
User changes model in Settings → SummaryModelSettings
  │
  ├─ invoke('api_save_model_config') → success
  │
  └─ emit('model-config-updated', config)
       │
       └─ FloatingChatBubble listens for 'model-config-updated' event
            └─ Updates chatModelConfig → badge updates
```

### What to show in the picker

The inline picker should expose a **subset** of what `ModelSettingsModal` provides:

| Feature | Include? | Reason |
|---|---|---|
| Provider dropdown | ✅ | Core choice |
| Model dropdown | ✅ | Core choice |
| API key input | ❌ | Too complex for inline — users go to Settings |
| Ollama endpoint | ❌ | Configure-once setting |
| Custom OpenAI config | ❌ | Too complex for inline |
| Built-in model manager | ❌ | Too complex for inline |

If the user selects a provider that requires an API key (e.g., OpenAI, Claude, Groq) but no key is configured, the `sendMessage` function should detect this and return a helpful error: "This provider requires an API key. Configure it in Settings."

### Implementation Details

#### Frontend changes

1. **`FloatingChatBubble.tsx`** — Add model state management + badge in header
   - New state: `modelConfig: ModelConfig | null` and `showModelPicker: boolean`
   - On mount, call `invoke('api_get_model_config')` to load current config
   - Listen for `model-config-updated` Tauri event
   - Render model badge in header area
   - Render inline model picker when badge clicked

2. **New file `ChatModelPicker.tsx`** — Compact inline model picker component
   - Provider dropdown (same options as `ModelSettingsModal`)
   - Model dropdown (dynamic per provider)
   - On change: calls `api_save_model_config`, emits `model-config-updated`
   - Compact inline layout (no modal, no overlay)

3. **`useMeetingChat.ts`** — Add model config awareness
   - Add `modelConfig` state
   - Add `checkModelConfig()` function that calls `api_get_model_config`
   - In `sendMessage`, check if model is configured before sending; if not, return early with error

4. **`configService.ts`** — Already has `getModelConfig()`, no changes needed

#### Rust changes

No Rust changes needed for the model picker itself — all the needed commands (`api_get_model_config`, `api_save_model_config`, `api_has_key`) already exist.

### Error States

| State | Badge shows | User action |
|---|---|---|
| Model configured | `Built-in AI · gemma3:1b` | Can use chat normally |
| No model in DB | ⚠️ `No model selected` in amber | Click to open picker, select a model |
| Provider requires key, no key set | ⚠️ `OpenAI · (no API key)` in amber | Click to open picker or go to Settings |
| Picker loading models | `Loading...` | Wait |
| Save failed | `Failed to save` in red | Try again or use Settings |

---

## Files Modified

### Part A: Bug Fix

| File | Change |
|---|---|
| `frontend/src-tauri/src/database/setup.rs` | After `app.manage(AppState)`, check for settings row and seed defaults if missing |
| `frontend/src-tauri/src/database/commands.rs` | `initialize_fresh_database`: propagate errors from `save_model_config` instead of swallowing |
| `frontend/src-tauri/src/chat/handler.rs` | Add one-time retry with 100ms delay if `get_model_config` returns `None` |

### Part B: Model Picker

| File | Change |
|---|---|
| `frontend/src/components/ChatBubble/FloatingChatBubble.tsx` | Add model config state, badge in header, `model-config-updated` listener, show picker |
| `frontend/src/components/ChatBubble/ChatModelPicker.tsx` | **New**: Compact inline model picker (provider + model dropdowns) |
| `frontend/src/components/ChatBubble/useMeetingChat.ts` | Add `modelConfig` state, `checkModelConfig()`, guard `sendMessage` |

---

## Tasks

### Task 1: Fix the settings initialization gap

**Files**: `setup.rs`, `commands.rs`

- [ ] In `setup.rs::initialize_database_on_startup`, after the non-first-launch `app.manage(AppState)`, read model config and seed defaults if missing
- [ ] In `commands.rs::initialize_fresh_database`, propagate errors from `save_model_config` instead of swallowing

### Task 2: Add chat handler resilience

**Files**: `chat/handler.rs`

- [ ] Add a one-time retry with `tokio::time::sleep(Duration::from_millis(100))` if `get_model_config` returns `None`
- [ ] Add `use tokio::time::Duration` import if not present

### Task 3: Add model config state to useMeetingChat

**Files**: `useMeetingChat.ts`

- [ ] Add `modelConfig: ModelConfig | null` state
- [ ] Add `loadModelConfig()` that calls `invoke('api_get_model_config')` on mount
- [ ] In `sendMessage`, if `modelConfig` is null, append an error message and return early (don't send to backend)
- [ ] Expose `modelConfig` and `updateModelConfig` from the hook return

### Task 4: Add model badge to FloatingChatBubble header

**Files**: `FloatingChatBubble.tsx`

- [ ] Import `ModelConfig` type from `configService` or define locally
- [ ] On mount, call `loadModelConfig()` from the hook
- [ ] Listen for `model-config-updated` Tauri event → update `modelConfig`
- [ ] Render a small pill/badge in the header (between title and action buttons) showing `{provider} · {model}`
- [ ] If `modelConfig` is null, show amber warning pill: `⚠️ No model selected`
- [ ] Clicking the pill sets `showModelPicker = true`

### Task 5: Create ChatModelPicker component

**Files**: `ChatModelPicker.tsx` (new)

- [ ] Compact inline component with:
  - Provider dropdown (same provider list as `ModelSettingsModal`)
  - Model dropdown (dynamic: `get_ollama_models` for Ollama, `builtin_ai_list_models` for BuiltInAI, hardcoded lists for others)
  - Save button or auto-save on change
- [ ] On model change:
  - Call `invoke('api_save_model_config', { provider, model, ... })`
  - On success: `emit('model-config-updated', config)` and close picker
  - On error: show inline error text
- [ ] If selected provider needs API key but none is set, show `"Requires API key — configure in Settings"`
- [ ] Compact layout: ~120px tall, fits within the 520px panel height

### Task 6: Verify end-to-end

- [ ] Build and run dev app
- [ ] Delete dev database, relaunch, verify default model is auto-seeded
- [ ] Open chat → verify model badge shows in header
- [ ] Click badge → verify picker opens
- [ ] Change model in picker → verify it saves and badge updates
- [ ] Change model in Settings → switch back to chat → verify badge reflects change
- [ ] Remove all settings from DB (simulate edge case) → verify badge shows "No model selected"
- [ ] Select a provider without API key → verify chat shows helpful error
