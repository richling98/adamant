# TODOS

Deferred items captured during plan review. Each item includes enough context to pick up in a future session without re-deriving the motivation.

---

## TODO-1: Audit Gate A partial completion before starting Step 4

**What:** Before building the full `has_key / save_key / delete_key / test_key` API suite in Step 4, check which Gate A conditions already hold in the current codebase.

**Why:** `setting.rs:save_model_config` already strips `api_key` from DB writes — one Gate A condition may already be satisfied. Discovering this early could shrink Step 4's scope significantly.

**Pros:** Prevents redundant implementation work; correct scoping for Step 4 effort estimates.

**Cons:** Small upfront audit cost before Step 4 begins.

**Context:** Gate A requires: (1) settings UI uses masked-state APIs, (2) save flows preserve existing secrets when field unchanged, (3) runtime consumers don't expose keys to React state, (4) custom OpenAI config split into secret/non-secret. Condition (1) may already be partially met at the DB layer. Check `frontend/src-tauri/src/database/repositories/setting.rs` and the settings UI component.

**Depends on / blocked by:** None — do this at the start of Step 4.

---

## TODO-2: Evaluate `tauri-plugin-stronghold` before designing custom keychain abstraction (Step 5)

**What:** Research whether `tauri-plugin-stronghold` (Tauri's official encrypted vault plugin) can replace the custom cross-platform keychain abstraction described in Step 5.

**Why:** Step 5 currently describes building a custom abstraction for macOS Keychain, Windows Credential Manager, and Linux Secret Service — three platform-specific backends. Stronghold is a Tauri-maintained plugin that provides a single encrypted vault API across all platforms, which could eliminate that custom abstraction entirely.

**Pros:** If it fits, Step 5 shrinks from "build a cross-platform abstraction" to "wire up an existing plugin." Reduces maintenance surface and platform-specific edge cases.

**Cons:** Stronghold uses a file-based vault (not OS keychain), which may not meet security requirements if OS keychain integration is explicitly required.

**Context:** See `tauri-plugin-stronghold` in the Tauri v2 plugin ecosystem. Evaluate: (a) Does it meet the threat model (keys at rest)? (b) Is it cross-platform and stable? (c) Does it integrate with `tauri-plugin-store`? If stronghold is unsuitable, the custom abstraction plan stands.

**Depends on / blocked by:** Keychain fallback open question (Gate A blocker) — the stronghold evaluation and the fallback decision can be done together in one spike.

---

## TODO-3: Classify `audio_v2/` compilation status before Step 14

**What:** Audit whether the `audio_v2/` directory (8 files: `compatibility.rs`, `mixer.rs`, `normalizer.rs`, `recorder.rs`, `resampler.rs`, `stream.rs`, `sync.rs`, `lib.rs`) is compiled, referenced from live code, or fully dead.

**Why:** Step 14 requires evidence-based classification before deleting any legacy files. Step 2 covers this conceptually, but `audio_v2/` is the most likely dead-code candidate and warrants an explicit audit note.

**Pros:** Directly gates Step 14 deletion; prevents accidentally removing code that is still operationally depended on. Short to execute (Cargo feature flag check + grep for imports).

**Cons:** None — this is a prerequisite for Step 14, not optional work.

**Context:** `audio_v2/` sits alongside `audio/` in `frontend/src-tauri/src/`. It appears to be a parallel implementation (the naming mirrors `audio/`'s modules). Check: (1) Is `audio_v2` referenced in `Cargo.toml` or `lib.rs`? (2) Are any `audio_v2::*` imports present in other modules? (3) Is it gated behind a feature flag? Do this during Step 2 inventory work.

**Depends on / blocked by:** Step 2 (inventory all live dependencies).
