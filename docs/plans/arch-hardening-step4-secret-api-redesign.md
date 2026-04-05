# Architecture Hardening Step 4: Secret API Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add new Tauri commands (`api_has_key`, `api_test_key`) that let the settings UI know whether a key is present without receiving its value. Update the settings UI to use these presence-only APIs. Mark existing raw-key-returning commands as deprecated. Split custom OpenAI config so endpoint/model survive independently of the API key. No secrets are moved from SQLite in this step — that is Step 5/6.

**Architecture:** New Tauri commands are added to `database/commands.rs` alongside existing ones. `SettingsRepository` gains a `has_api_key` method. The settings UI replaces its "load raw key → populate input" pattern with "load presence bool → show masked indicator." Existing `get_api_key` commands are preserved with a deprecation comment and an internal `tracing::warn!` on each call so we can measure how many callers remain.

**Tech Stack:** Rust (Tauri commands, sqlx), TypeScript (React, `@tauri-apps/api/core`)

---

## Wave
Wave 1 — Low-Risk Foundations (clears Gate A when complete)

## Dependency
- Step 2 inventory must be complete. `docs/dependency-inventory.md` Section 1.5 must list every Tauri command that currently returns a raw key — this plan deprecates exactly those commands.
- Step 3 must be complete (no content logging regressions).

## Gate Cleared
**Gate A** is cleared when this step's acceptance criteria are met and the keychain fallback decision (from Open Questions) is recorded.

## Acceptance Criteria
- `api_has_key(provider)` returns `true`/`false` without exposing the key value.
- `api_test_key(provider)` makes a lightweight API probe and returns `true`/`false`.
- Settings UI loads key presence state on mount, not raw key values.
- Settings UI save flow preserves existing key when the user leaves the key field blank/unchanged.
- All previously raw-key-returning commands have a `#[deprecated]` annotation and emit a `log::warn!` on each invocation.
- Custom OpenAI endpoint and model fields save/load independently of the API key field.
- All new commands are registered in `lib.rs` invoke handler.
- Tests pass for all new repository methods.

---

## File Map

| Action | Path |
|--------|------|
| Modify | `frontend/src-tauri/src/database/repositories/setting.rs` — add `has_api_key`, `has_transcript_api_key` |
| Modify | `frontend/src-tauri/src/database/commands.rs` — add `api_has_key`, `api_test_key`; deprecate raw-key commands |
| Modify | `frontend/src-tauri/src/lib.rs` — register new commands in invoke handler |
| Modify | `frontend/src/app/settings/page.tsx` — use `api_has_key` instead of raw key load |
| Modify | `frontend/src/components/SummaryModelSettings.tsx` — presence-only key display |
| Modify | `frontend/src/components/TranscriptSettings.tsx` — presence-only key display |
| Modify | `frontend/src-tauri/src/summary/service.rs` — confirm it reads keys internally, not from frontend-passed values |

---

### Task 1: Add `has_api_key` to SettingsRepository

- [ ] **Step 1: Write the failing test for `has_api_key`**

Add to `frontend/src-tauri/src/database/repositories/setting.rs` (at the bottom, inside a `#[cfg(test)]` block):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .connect("sqlite::memory:")
            .await
            .expect("Failed to create in-memory SQLite pool");

        // Minimal schema for settings table
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL DEFAULT 'openai',
                model TEXT NOT NULL DEFAULT 'gpt-4o-2024-11-20',
                whisperModel TEXT NOT NULL DEFAULT 'large-v3',
                openaiApiKey TEXT,
                anthropicApiKey TEXT,
                groqApiKey TEXT,
                openRouterApiKey TEXT,
                ollamaApiKey TEXT,
                ollamaEndpoint TEXT,
                customOpenAIConfig TEXT
            )
            "#,
        )
        .execute(&pool)
        .await
        .expect("Failed to create settings table");

        pool
    }

    #[tokio::test]
    async fn test_has_api_key_returns_false_when_no_key() {
        let pool = test_pool().await;
        let result = SettingsRepository::has_api_key(&pool, "openai").await.unwrap();
        assert_eq!(result, false);
    }

    #[tokio::test]
    async fn test_has_api_key_returns_true_when_key_set() {
        let pool = test_pool().await;
        SettingsRepository::save_api_key(&pool, "openai", "sk-test-key-123").await.unwrap();
        let result = SettingsRepository::has_api_key(&pool, "openai").await.unwrap();
        assert_eq!(result, true);
    }

    #[tokio::test]
    async fn test_has_api_key_returns_false_after_delete() {
        let pool = test_pool().await;
        SettingsRepository::save_api_key(&pool, "openai", "sk-test-key-123").await.unwrap();
        SettingsRepository::delete_api_key(&pool, "openai").await.unwrap();
        let result = SettingsRepository::has_api_key(&pool, "openai").await.unwrap();
        assert_eq!(result, false);
    }
}
```

- [ ] **Step 2: Run the test to confirm it fails (function not yet defined)**

```bash
cd frontend && cargo test -p app-lib has_api_key 2>&1 | head -30
```

Expected: compilation error — `has_api_key` not found. If it compiles and passes, the method already exists; skip to Step 4.

- [ ] **Step 3: Implement `has_api_key` in `SettingsRepository`**

Add to `frontend/src-tauri/src/database/repositories/setting.rs` after the `get_api_key` method:

```rust
pub async fn has_api_key(
    pool: &SqlitePool,
    provider: &str,
) -> std::result::Result<bool, sqlx::Error> {
    if provider == "custom-openai" {
        let config = Self::get_custom_openai_config(pool).await?;
        return Ok(config.and_then(|c| c.api_key).map(|k| !k.is_empty()).unwrap_or(false));
    }

    let api_key_column = match provider {
        "openai" => "openaiApiKey",
        "claude" => "anthropicApiKey",
        "ollama" => "ollamaApiKey",
        "groq" => "groqApiKey",
        "openrouter" => "openRouterApiKey",
        "builtin-ai" => return Ok(true), // Built-in AI never needs a key
        _ => {
            return Err(sqlx::Error::Protocol(
                format!("Invalid provider: {}", provider).into(),
            ))
        }
    };

    let query = format!(
        "SELECT {} FROM settings WHERE id = '1' LIMIT 1",
        api_key_column
    );
    let key: Option<String> = sqlx::query_scalar(&query).fetch_optional(pool).await?;
    Ok(key.map(|k| !k.is_empty()).unwrap_or(false))
}

pub async fn has_transcript_api_key(
    pool: &SqlitePool,
    provider: &str,
) -> std::result::Result<bool, sqlx::Error> {
    if matches!(provider, "localWhisper" | "parakeet") {
        return Ok(true); // These providers don't need a key
    }
    let api_key_column = match provider {
        "deepgram" => "deepgramApiKey",
        "elevenLabs" => "elevenLabsApiKey",
        "groq" => "groqApiKey",
        "openai" => "openaiApiKey",
        _ => {
            return Err(sqlx::Error::Protocol(
                format!("Invalid transcript provider: {}", provider).into(),
            ))
        }
    };
    let query = format!(
        "SELECT {} FROM transcript_settings WHERE id = '1' LIMIT 1",
        api_key_column
    );
    let key: Option<String> = sqlx::query_scalar(&query).fetch_optional(pool).await?;
    Ok(key.map(|k| !k.is_empty()).unwrap_or(false))
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd frontend && cargo test -p app-lib has_api_key
```

Expected: all 3 tests pass.

- [ ] **Step 5: Commit the repository changes**

```bash
git add frontend/src-tauri/src/database/repositories/setting.rs
git commit -m "feat(secrets): add has_api_key and has_transcript_api_key to SettingsRepository"
```

---

### Task 2: Add `api_has_key` and `api_test_key` Tauri commands

- [ ] **Step 6: Add `api_has_key` and `api_test_key` to `database/commands.rs`**

Add the following to `frontend/src-tauri/src/database/commands.rs` (after the existing legacy DB commands):

```rust
/// Returns whether the given provider has an API key stored.
/// Never returns the key value — only presence state.
#[tauri::command]
pub async fn api_has_key(
    state: tauri::State<'_, crate::state::AppState>,
    provider: String,
) -> Result<bool, String> {
    let pool = state.db_manager.pool();
    crate::database::repositories::setting::SettingsRepository::has_api_key(pool, &provider)
        .await
        .map_err(|e| format!("Failed to check key presence for {}: {}", provider, e))
}

/// Returns whether the given transcript provider has an API key stored.
/// Never returns the key value — only presence state.
#[tauri::command]
pub async fn api_has_transcript_key(
    state: tauri::State<'_, crate::state::AppState>,
    provider: String,
) -> Result<bool, String> {
    let pool = state.db_manager.pool();
    crate::database::repositories::setting::SettingsRepository::has_transcript_api_key(pool, &provider)
        .await
        .map_err(|e| format!("Failed to check transcript key presence for {}: {}", provider, e))
}

/// Makes a lightweight probe to the provider's API to verify the stored key is valid.
/// Returns true if the key is accepted, false if rejected or not present.
/// Does not return the key value.
#[tauri::command]
pub async fn api_test_key(
    state: tauri::State<'_, crate::state::AppState>,
    provider: String,
) -> Result<bool, String> {
    let pool = state.db_manager.pool();

    // First check if a key exists at all
    let has_key = crate::database::repositories::setting::SettingsRepository::has_api_key(pool, &provider)
        .await
        .map_err(|e| format!("Failed to check key: {}", e))?;

    if !has_key {
        return Ok(false);
    }

    // Retrieve key internally for probe — never returned to caller
    let api_key = crate::database::repositories::setting::SettingsRepository::get_api_key(pool, &provider)
        .await
        .map_err(|e| format!("Failed to retrieve key for probe: {}", e))?;

    let Some(key) = api_key else {
        return Ok(false);
    };

    // Provider-specific lightweight probe
    let client = reqwest::Client::new();
    let valid = match provider.as_str() {
        "openai" => {
            let resp = client
                .get("https://api.openai.com/v1/models")
                .bearer_auth(&key)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            matches!(resp, Ok(r) if r.status().is_success())
        }
        "claude" => {
            let resp = client
                .get("https://api.anthropic.com/v1/models")
                .header("x-api-key", &key)
                .header("anthropic-version", "2023-06-01")
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            matches!(resp, Ok(r) if r.status().is_success())
        }
        "groq" => {
            let resp = client
                .get("https://api.groq.com/openai/v1/models")
                .bearer_auth(&key)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            matches!(resp, Ok(r) if r.status().is_success())
        }
        "openrouter" => {
            let resp = client
                .get("https://openrouter.ai/api/v1/models")
                .bearer_auth(&key)
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            matches!(resp, Ok(r) if r.status().is_success())
        }
        "ollama" | "builtin-ai" => true, // Local providers — always valid if reachable
        _ => false,
    };

    Ok(valid)
}
```

- [ ] **Step 7: Find and deprecate all existing Tauri commands that return raw key values**

Based on `docs/dependency-inventory.md` Section 1.5, add a deprecation comment and `log::warn!` to each command that returns a raw API key. The pattern:

```rust
/// Returns the raw API key for the given provider.
/// DEPRECATED: Use `api_has_key` for presence checks. Raw key access will be removed in Step 6.
/// Callers remaining: [list from inventory]
#[tauri::command]
pub async fn api_get_model_config(  // (replace with actual command name)
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SomeConfigType, String> {
    log::warn!(
        "DEPRECATED: api_get_model_config returns raw API key. \
         Migrate callers to api_has_key. This command will be removed in Step 6."
    );
    // ... existing implementation unchanged ...
}
```

Do NOT change the return type or behavior — only add the comment and `log::warn!`.

- [ ] **Step 8: Build to confirm no compilation errors**

```bash
cd frontend && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with 0 errors.

- [ ] **Step 9: Register new commands in `lib.rs` invoke handler**

Open `frontend/src-tauri/src/lib.rs` and find the `.invoke_handler(tauri::generate_handler![...])` call. Add the three new commands:

```rust
// In the generate_handler! macro, add:
database::commands::api_has_key,
database::commands::api_has_transcript_key,
database::commands::api_test_key,
```

- [ ] **Step 10: Build again to confirm registration compiles**

```bash
cd frontend && cargo check --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 11: Commit commands and registration**

```bash
git add frontend/src-tauri/src/database/commands.rs frontend/src-tauri/src/lib.rs
git commit -m "feat(secrets): add api_has_key, api_has_transcript_key, api_test_key Tauri commands; deprecate raw-key commands"
```

---

### Task 3: Update the settings UI to use presence-only key state

The settings UI currently calls something like `invoke('api_get_transcript_config')` and receives a config object that includes `apiKey`. The goal is: on load, call `api_has_key` instead; only call `api_save_key` (which already exists) if the user actually typed a new value.

> **Before starting:** Check `frontend/src/components/SummaryModelSettings.tsx` and `frontend/src/components/TranscriptSettings.tsx` to understand exactly how they currently load and display key values. The steps below cover the pattern — adjust for the exact variable names you find.

- [ ] **Step 12: Update `SummaryModelSettings.tsx` to load key presence instead of raw key**

Find where the component loads the current API key on mount (likely in a `useEffect`). Replace:

```typescript
// BEFORE — loads raw key value
const config = await invoke('api_get_model_config') as ModelConfig;
setApiKey(config.apiKey ?? '');  // raw key goes into state
```

With:

```typescript
// AFTER — loads presence only
const config = await invoke('api_get_model_config') as ModelConfig; // still called for non-secret fields
const hasKey = await invoke<boolean>('api_has_key', { provider: config.provider });
setApiKeyPresent(hasKey);  // boolean: does the user have a key?
setApiKey('');              // never populate input with the raw key
```

Add a new state variable:
```typescript
const [apiKeyPresent, setApiKeyPresent] = useState(false);
```

Update the API key input to show a masked placeholder when a key is present:
```tsx
<input
  type="password"
  placeholder={apiKeyPresent ? '••••••••••••••••' : 'Enter API key'}
  value={apiKey}
  onChange={(e) => setApiKey(e.target.value)}
/>
{apiKeyPresent && (
  <span className="text-xs text-zinc-400">Key saved. Enter a new value to replace it.</span>
)}
```

Update the save handler to preserve the existing key when the field is left blank:
```typescript
const handleSave = async () => {
  // Only save the key if the user actually typed something
  if (apiKey.trim().length > 0) {
    await invoke('api_save_key', { provider: selectedProvider, apiKey: apiKey.trim() });
  }
  // Always save non-secret config fields (provider, model, etc.)
  await invoke('api_save_model_config', { provider: selectedProvider, model: selectedModel, /* ... */ });
};
```

- [ ] **Step 13: Apply the same pattern to `TranscriptSettings.tsx`**

Same steps as Task 3 Step 12, but using `api_has_transcript_key` and the transcript config invoke commands. The `settings/page.tsx:39` console.log of config (already fixed in Step 3) is gone by this point.

- [ ] **Step 14: Verify the UI loads without errors**

```bash
cd frontend && pnpm run dev
```

Open `http://localhost:3118`, navigate to Settings → AI Models. Confirm:
- The API key input is empty (not pre-populated with the raw key)
- If a key was previously saved, the `"Key saved. Enter a new value to replace it."` indicator appears
- Saving with a blank key field does not clear the existing key

- [ ] **Step 15: Commit UI changes**

```bash
git add frontend/src/components/SummaryModelSettings.tsx \
        frontend/src/components/TranscriptSettings.tsx \
        frontend/src/app/settings/page.tsx
git commit -m "feat(secrets): update settings UI to use key presence indicators, not raw key values"
```

---

### Task 4: Verify custom OpenAI config splits secret from non-secret

The custom OpenAI config stores `endpoint`, `model`, `maxTokens`, `temperature`, `topP`, and `api_key` together in a JSON blob in `customOpenAIConfig`. This task ensures the non-secret fields (endpoint, model, tokens) survive independently if the API key is absent or cleared.

- [ ] **Step 16: Verify `save_custom_openai_config` does not overwrite endpoint/model when key is omitted**

Read `frontend/src-tauri/src/database/repositories/setting.rs` around `save_custom_openai_config`. Confirm that if `config.api_key` is `None`, the existing key in the DB is preserved (not overwritten with NULL).

If the current implementation overwrites the full JSON blob (including key) on every save, add a merge step:

```rust
pub async fn save_custom_openai_config_non_secret(
    pool: &SqlitePool,
    endpoint: &str,
    model: &str,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    top_p: Option<f32>,
) -> std::result::Result<(), sqlx::Error> {
    // Load existing config to preserve the api_key field
    let existing = Self::get_custom_openai_config(pool).await?;
    let api_key = existing.and_then(|c| c.api_key);

    let new_config = crate::summary::CustomOpenAIConfig {
        api_key,  // preserve existing key
        endpoint: endpoint.to_string(),
        model: model.to_string(),
        max_tokens,
        temperature,
        top_p,
    };

    Self::save_custom_openai_config(pool, &new_config).await
}
```

Update the Tauri command that saves custom OpenAI non-secret config to call `save_custom_openai_config_non_secret` instead of the full `save_custom_openai_config`.

- [ ] **Step 17: Build and run tests**

```bash
cd frontend && cargo test -p app-lib
```

Expected: all tests pass.

- [ ] **Step 18: Commit custom OpenAI split**

```bash
git add frontend/src-tauri/src/database/repositories/setting.rs \
        frontend/src-tauri/src/database/commands.rs
git commit -m "feat(secrets): split custom OpenAI config so endpoint/model persist independently of api_key"
```

---

## Done Criteria Checklist

- [ ] `SettingsRepository::has_api_key` and `has_transcript_api_key` implemented and tested
- [ ] `api_has_key`, `api_has_transcript_key`, `api_test_key` commands added and registered in `lib.rs`
- [ ] All previously raw-key-returning commands have deprecation comment + `log::warn!`
- [ ] Settings UI shows key presence indicator, never raw key value
- [ ] Save flow preserves existing key when field is left blank
- [ ] Custom OpenAI endpoint/model save independently of API key
- [ ] All tests pass: `cargo test`
- [ ] App runs and Settings page loads without errors

## Gate A Cleared When
All items above are checked AND the keychain fallback decision (from `docs/plans/architecture-hardening-v2.md` Open Questions) is recorded in `docs/adr/ADR-001-architecture-end-state.md`.

## Not In Scope
- Moving secrets from SQLite to keychain (that is Step 5)
- Deleting the raw `get_api_key` DB method (that is Step 6 — it is still needed for `api_test_key`'s internal probe)
- Transcript provider API key test endpoints (extend `api_test_key` in a later step if needed)
