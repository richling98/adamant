# Architecture Hardening Plan V2

**Overall Progress:** `20%`

## TLDR
This is a safer version of the remediation plan for the 10 CTO-level findings. The core change is not "fix everything at once," but "reduce risk in controlled waves with dependency gates, rollback points, and explicit proof before each high-blast-radius migration."

The highest-risk mistakes would be:
- moving secrets before the UI stops expecting raw secrets back
- unifying databases before we model every real upgrade/install path
- removing polling before event delivery is proven reliable
- deleting legacy code before we prove it is truly unused

This plan avoids those failure modes by sequencing work into low-risk foundations first, then guarded migrations, then structural simplification only after we have confidence.

## End Result

When this plan is fully executed, a user will:
- Open Settings and see their provider API keys displayed as masked/present indicators — never as raw strings.
- Upgrade from any prior install (fresh, legacy Python-only, Tauri-only, or mixed) without losing a single meeting, note, summary, or provider setting.
- On first launch after an upgrade, receive an explicit notification consent prompt rather than a silent auto-grant.
- Generate summaries and use all provider APIs exactly as before — the secret migration is invisible to them.
- See production logs that contain no transcript text or summary content, only metadata.
- Use the app with the Python backend either retired or narrowed to a stateless worker role, with Tauri as the single owner of all persistence.
- Experience recording state that stays consistent whether they start/stop from the tray, the UI, or after a reload.

## Critical Decisions
* **Decision 1:** Tauri remains the long-term owner of desktop app configuration, secrets, and user-facing persistence. Python should move toward a stateless worker role or be retired from app-critical ownership.
* **Decision 2:** Secret migration is blocked until every UI and runtime consumer can operate without round-tripping raw API keys.
* **Decision 3:** Database consolidation is blocked until we have a complete install-history matrix and validated migration rehearsals using real fixture databases.
* **Decision 4:** Recording-state simplification is blocked until event reliability is measured and proven across tray, reload, post-processing, and recovery flows.
* **Decision 5:** Dead-code removal requires evidence by classification: not compiled, compiled-but-unreferenced, or still indirectly operational.

## Success Criteria
- No raw API keys are stored in SQLite.
- No raw API keys are returned to frontend components.
- Notification consent is explicit opt-in.
- Production logs contain no transcript or summary payloads.
- Backend localhost exposure is narrowed or eliminated without breaking current app flows.
- One clear ownership model exists for meeting/config persistence.
- Legacy users can upgrade without losing meetings, notes, summaries, or provider settings.
- Recording state stays correct across UI, tray, reloads, and error recovery.
- Unsafe runtime shortcuts are reduced only where correctness is preserved and tested.

## Dependency Gates

### Gate A: Secret Migration Gate
Do not start secret migration until all of the following are true:
- Settings UI uses presence or masked-state APIs instead of fetching raw keys.
- Save flows preserve existing secrets when the user leaves the field unchanged.
- Runtime consumers can load secrets internally without exposing them to React state.
- Custom OpenAI config is split into secret and non-secret fields.
- Keychain fallback strategy is decided (see open question below — required before this gate clears).

> **Note:** Gate A is cleared when Step 4 is complete and the keychain fallback decision is recorded. Gate A's conditions are Step 4's acceptance criteria — they are the same thing.

### Gate B: Notification Consent Gate
Do not remove startup consent behavior until all of the following are true:
- `NotificationManager::initialize()` no longer auto-prompts for permission.
- First-launch UX includes an explicit user decision point.
- Recording lifecycle UX has a fallback when notifications are unavailable.

### Gate C: Database Consolidation Gate
Do not unify databases until all of the following are true:
- We document all current persistence owners and file locations.
- We build upgrade fixtures for fresh install, old backend DB only, Tauri DB only, and mixed-state installs.
- Migration validation checks row counts, summary integrity, notes integrity, and config integrity.
- Backup and restore flow is tested.

### Gate D: State Simplification Gate
Do not remove polling until all of the following are true:
- All recording lifecycle events are inventoried and tested.
- Missed-event cases are measured in logs or diagnostics.
- Event-driven sync works across tray starts/stops, reload recovery, and delayed post-processing.
- Polling frequency has already been reduced safely without regressions.

### Gate E: Dead Code Removal Gate
Do not delete legacy files until all of the following are true:
- We confirm whether each target is compiled, referenced, or operationally depended on.
- We preserve any valuable reference logic in docs, an archive branch, or extracted notes.
- CI and local verification cover affected flows.

## Tasks

- [x] 🟩 **Step 1: Establish The Safety Envelope**
  - [x] 🟩 Write an ADR describing the desired end-state architecture for secrets, persistence, and backend ownership.
  - [x] 🟩 Define rollout waves: low-risk foundations, guarded migrations, structural simplification.
  - [x] 🟩 Freeze feature work that touches settings, secrets, summary ownership, or persistence until this program is sequenced.
  - [x] 🟩 Create a risk register for each of the 10 issues with owner, blast radius, and rollback plan.

- [x] 🟩 **Step 2: Inventory All Live Dependencies Before Changing Them**
  - [x] 🟩 Map every frontend, Rust, and Python code path that reads summary config, transcript config, or API keys.
  - [x] 🟩 Map every route and command still depending on `localhost:5167` semantics.
  - [x] 🟩 Map every place recording state is synchronized by event, polling, or both.
  - [x] 🟩 Classify legacy code into: not compiled, compiled but unused, indirectly used, or uncertain.

- [x] 🟩 **Step 3: Build Privacy-Safe Observability Before Removing Debugging**
  - [x] 🟩 Introduce a shared logging policy for Rust, Python, and frontend.
  - [x] 🟩 Replace transcript and summary content logging with metadata-only structured logs.
  - [x] 🟩 Add a developer-only verbose mode gated behind explicit opt-in.
  - [x] 🟩 Add detection for accidental `console.log`, `print`, or transcript-content logging in production paths.

- [ ] 🟥 **Step 4: Redesign Secret APIs Without Migrating Secrets Yet**
  - [ ] 🟥 Add new Tauri command shapes for `has_key`, `save_key`, `delete_key`, and `test_key`.
  - [ ] 🟥 Keep old raw-key APIs temporarily for compatibility, but mark them deprecated and internally trace their remaining callers.
  - [ ] 🟥 Update settings UI to use masked-state semantics instead of expecting raw secrets back.
  - [ ] 🟥 Split custom OpenAI config into secret and non-secret handling so endpoint/model survive independently of the API key.

- [ ] 🟥 **Step 5: Introduce Keychain Storage Behind A Compatibility Layer**
  - [ ] 🟥 Evaluate `tauri-plugin-stronghold` (encrypted local vault) and `tauri-plugin-store` (persistent KV) as the implementation vehicle before building a custom abstraction — prefer existing Tauri plugins over custom code.
  - [ ] 🟥 Create a Tauri secret-store abstraction for macOS Keychain, Windows Credential Manager, and Linux Secret Service fallback (or stronghold as universal fallback).
  - [ ] 🟥 Read secrets from keychain first, then fall back to DB during migration mode.
  - [ ] 🟥 Make runtime consumers use the abstraction directly instead of reading secret columns.
  - [ ] 🟥 Verify summary generation, transcript providers, and custom OpenAI all work without returning secrets to the frontend.
  - [ ] 🟥 **Tests:** Before wiring up the abstraction, write unit tests covering: keychain read success, keychain read miss (falls back to DB), DB fallback value returned correctly, and abstraction used by at least one runtime consumer (summary generation).

- [ ] 🟥 **Step 6: Migrate Secrets Safely**
  - [ ] 🟥 **Tests FIRST (before executing migration):** Write migration tests covering: (1) successful keychain write + read-after-write verify + DB copy cleanup, (2) keychain write failure → DB copy preserved → user-visible error shown, (3) partial migration (some keys migrated, some not) → recovery resumes from checkpoint. These tests must pass before any migration code runs in production.
  - [ ] 🟥 Perform one-time migration from SQLite secret columns into keychain.
  - [ ] 🟥 Verify each migrated secret by read-after-write before deleting the DB copy.
  - [ ] 🟥 Preserve DB values until migration success is confirmed and recorded.
  - [ ] 🟥 Add recovery behavior for keychain write failures, including user-visible remediation (never silent failure).

- [ ] 🟥 **Step 7: Fix Notification Consent Without Breaking Recording UX**
  - [ ] 🟥 Refactor notification initialization so startup does not auto-consent or auto-prompt.
  - [ ] 🟥 Add a first-launch or settings-based consent flow with clear user intent.
  - [ ] 🟥 Ensure recording-started, recording-stopped, and processing-complete UX remain understandable when notifications are off.
  - [ ] 🟥 Migrate existing users carefully so prior notification preferences are preserved where possible.

- [ ] 🟥 **Step 8: Harden Backend Exposure In Compatibility Mode**
  - [ ] 🟥 Restrict backend binding and CORS more safely without assuming it can disappear immediately.
  - [ ] 🟥 Remove secret-returning backend endpoints only after the Tauri replacement path is fully live.
  - [ ] 🟥 Add a temporary compatibility strategy for any still-live frontend/backend meeting-management flows.
  - [ ] 🟥 Document whether FastAPI is still required for any user-visible scenario after this wave.

- [ ] 🟥 **Step 9: Rehearse Database Consolidation Before Executing It**
  - [ ] 🟥 Inventory all data domains stored in Python DB, Tauri DB, or both.
  - [ ] 🟥 Build representative fixture databases for fresh installs, legacy-only installs, migrated installs, and mixed-state installs.
  - [ ] 🟥 Define canonical ownership for meetings, notes, summaries, settings, transcript config, and custom provider config.
  - [ ] 🟥 Write migration validation checks for row counts, orphan rows, summaries, notes, transcript timing fields, and settings presence.

- [ ] 🟥 **Step 10: Consolidate Persistence In Controlled Stages**
  - [ ] 🟥 **Tests FIRST:** For each domain being migrated, write tests covering: fresh install path, legacy-only Python DB path, mixed-state path, and rollback path. Tests must pass before migrating that domain.
  - [ ] 🟥 Move one data domain at a time to canonical ownership rather than all at once.
  - [ ] 🟥 Keep compatibility reads during the transition so users are not stranded between stores.
  - [ ] 🟥 Replace copy-on-first-launch logic with versioned migration steps and status recording.
  - [ ] 🟥 Provide backup, rollback, and failure visibility before deleting old ownership paths.
  - [ ] 🟥 **Cleanup gate:** Remove compatibility dual-reads only after (a) all validation checks pass for that domain and (b) a `migration_complete` flag for that domain is recorded in the DB. Do not leave dual-read code permanently in place.

- [ ] 🟥 **Step 11: Clean Up Backend Async And Ownership Drift**
  - [ ] 🟥 Remove blocking `sqlite3` usage from async backend paths that survive the consolidation.
  - [ ] 🟥 Make Python stateless where possible if it remains in the stack.
  - [ ] 🟥 Remove duplicate config persistence responsibilities from FastAPI once Rust equivalents are proven.
  - [ ] 🟥 Keep backend retirement optional until all hidden dependencies are verified gone.

- [ ] 🟥 **Step 12: Instrument Recording State Before Simplifying It**
  - [ ] 🟥 Inventory all events affecting recording state across tray, UI, and post-processing.
  - [ ] 🟥 Add diagnostics for missed or delayed state transitions.
  - [ ] 🟥 **Tests FIRST:** Write tests for each state transition before reducing polling: tray start → UI sync, UI stop → tray sync, reload → state recovery, post-processing completion → state cleared.
  - [ ] 🟥 Reduce redundant polling frequency first and observe regressions.
  - [ ] 🟥 Only then converge on one authoritative state machine and event-driven synchronization model.

- [ ] 🟥 **Step 13: Harden Audio Concurrency With Tests First**
  - [ ] 🟥 **Tests FIRST:** Add race-focused tests for start/stop, force flush, device disconnect, reload, and sleep/wake before touching any unsafe code. Tests must reproduce the failure mode, not just the happy path.
  - [ ] 🟥 Replace `static mut` counters and unsafe globals in observable increments, not one sweep. (Primary targets: `audio_v2/sync.rs`, any `unsafe impl Send` in `audio/` modules.)
  - [ ] 🟥 Audit every `unsafe impl Send` and document the invariant before changing it.
  - [ ] 🟥 Preserve performance and shutdown semantics while reducing unsafe escape hatches.

- [ ] 🟥 **Step 14: Remove Dead And Parallel Code Only After Classification**
  - [ ] 🟥 Confirm which legacy files are truly not compiled or reachable.
  - [ ] 🟥 Remove obvious dead artifacts first: backups, old alternates, abandoned entrypoints.
  - [ ] 🟥 Defer ambiguous modules like `audio_v2` until ownership is clear.
  - [ ] 🟥 Re-run focused verification after each cleanup batch.

- [ ] 🟥 **Step 15: Verify Rollout And Upgrade Safety**
  - [ ] 🟥 Add integration coverage for first launch, upgrade, legacy import, secret migration, summary generation, and note persistence.
  - [ ] 🟥 Add tests or scripted verification for backend lockdown and secret non-exposure.
  - [ ] 🟥 Validate recording correctness across UI reloads, tray actions, and post-processing.
  - [ ] 🟥 Create a release checklist for privacy regressions, migration failures, and rollback execution.

## Wave Structure

### Wave 1: Low-Risk Foundations
- Step 1
- Step 2
- Step 3
- Step 4

Goal:
- make the system observable and dependency-aware before any migration

### Wave 2: Secret Safety
- Step 5
- Step 6
- Step 7

Goal:
- remove the highest-trust failures without breaking settings UX

### Wave 3: Backend Compatibility Hardening
- Step 8

Goal:
- reduce backend exposure (binding, CORS, secret-returning endpoints) while preserving compatibility
- Step 11 is intentionally deferred to Wave 5 — Python config cleanup requires Wave 4 persistence consolidation to be complete first

### Wave 4: Persistence Consolidation
- Step 9
- Step 10

Goal:
- unify data ownership only after migration confidence exists

### Wave 5: Runtime Simplification
- Step 11
- Step 12
- Step 13
- Step 14
- Step 15

Goal:
- simplify the runtime and codebase only after correctness is proven
- Step 11 (Python config cleanup) runs here because it requires Wave 4 data domains to be in Rust first

## Explicit Non-Goals For Early Waves
- Do not remove polling in Wave 1 or Wave 2.
- Do not delete Python backend ownership in Wave 1 or Wave 2.
- Do not delete legacy audio modules before classification.
- Do not perform one-shot "remove all unsafe" refactors.
- Do not merge DBs by copying files without versioned migration logic.

## Rollback Strategy
- Every migration writes status to a recoverable record before destructive cleanup.
- Secret migration keeps DB copies until keychain verification succeeds.
- Database consolidation keeps compatibility reads until post-migration validation passes.
- Polling remains available as a fallback until event-driven synchronization is proven.
- Backend lockdown changes should be reversible via feature flag or compatibility mode during rollout.

## Acceptance Criteria By Workstream

### Secrets
- Raw keys are no longer returned to React components.
- Runtime consumers can still generate summaries and use provider APIs.
- Existing users do not need to re-enter secrets unless migration fails.

### Notifications
- First launch does not auto-consent.
- Permission prompts occur only after explicit user action.
- Recording UX remains understandable with notifications disabled.

### Persistence
- Users can upgrade from every known install state without losing meetings, notes, or summaries.
- Only one canonical ownership model remains after consolidation.

### Recording State
- Tray, UI, reload, and post-processing all converge on the same recording state.
- Polling can be reduced or removed with no measurable correctness regressions.

### Audio Runtime
- Start/stop, flush, and device-disconnect flows remain stable.
- Unsafe state is reduced only where correctness and performance remain intact.

## All Changes, Explained Simply

This section explains the whole plan in plain English.

### Step 1: Write down the rules before we touch risky code
- We will create a short architecture decision record that says Rust/Tauri is the long-term owner of app settings, secrets, and saved user data.
- We will create a risk register so every big risk has an owner, a blast radius, and a rollback plan.
- We will create a freeze notice so we do not keep changing secrets, settings, and persistence in random directions while the hardening work is happening.

### Step 2: Find every place the old behavior still exists
- We will search the frontend, Rust code, and Python code to find every place that reads API keys, writes API keys, calls the backend on `localhost:5167`, syncs recording state, or depends on legacy code.
- We will write all of that down in one inventory document so later changes are based on evidence, not guesses.

### Step 3: Stop leaking sensitive content into logs
- We will remove logs that print transcript text, summary text, or risky config data in normal app runs.
- We will replace those logs with safer logs that only show metadata, like lengths, IDs, counts, or provider names.
- We will add a developer-only verbose mode for local debugging, so sensitive content is never logged by default.
- We will add a script that fails checks if someone accidentally adds unsafe logging again.

### Step 4: Stop sending raw API keys to the frontend
- We will add new commands that answer simple questions like “does a key exist?” instead of returning the full key.
- We will update the Settings UI so it shows a masked or present state, rather than loading the raw secret into the page.
- We will keep the old raw-key APIs temporarily so the app does not break all at once, but we will mark them as deprecated and track any remaining callers.
- We will split custom OpenAI settings so the endpoint and model can be saved separately from the secret key.

### Step 5: Add a safer place to store secrets
- We will build a secret-storage layer that uses the operating system’s secure storage, such as Keychain or Credential Manager, instead of plain SQLite fields.
- We will make the app read secrets from this new secure layer first, while still supporting a temporary fallback during migration.
- We will update summary generation and other runtime code so those systems load secrets internally without sending them back to React.

### Step 6: Move existing secrets carefully
- We will migrate stored API keys from the database into secure storage.
- We will verify each secret after writing it before removing the old database copy.
- If anything fails, we will keep the old value, show the user a real error, and support recovery instead of failing silently.

### Step 7: Make notification permission a real user choice
- We will stop asking for or assuming notification permission automatically at startup.
- We will add a clear in-app prompt so users explicitly choose whether they want notifications.
- We will make sure recording and processing still make sense even if notifications are turned off.

### Step 8: Reduce backend exposure without breaking the app
- We will tighten how the Python backend is exposed on localhost and narrow CORS.
- We will keep compatibility paths for any features that still depend on the backend until replacements are truly ready.
- We will remove secret-returning backend endpoints only after the Tauri path is fully live.

### Step 9: Prepare for database consolidation
- We will map which data lives in the Python database, which data lives in the Tauri database, and where both are involved.
- We will create realistic fixture databases that represent fresh installs, old installs, and mixed installs.
- We will define who should own each type of data in the final architecture.

### Step 10: Move persistence one domain at a time
- We will not merge everything at once.
- We will move meetings, notes, summaries, settings, and other data in controlled stages, one domain at a time.
- We will keep compatibility reads during the transition so users are not stranded between old and new storage locations.
- We will only delete old ownership paths after validation passes and migration completion is recorded.

### Step 11: Remove backend ownership drift
- If Python remains in the system, we will make it more stateless and remove any leftover app-critical data ownership from it.
- We will clean up async backend paths that still use blocking database patterns.
- We will only retire backend ownership after hidden dependencies are proven gone.

### Step 12: Fix recording state carefully before simplifying it
- We will map every way recording state changes across the tray, UI, reloads, and post-processing.
- We will add diagnostics for missed or delayed state changes.
- We will reduce polling slowly and only after event-based syncing is proven reliable.

### Step 13: Reduce risky audio concurrency code
- We will add race-focused tests first so we can catch start/stop and device-disconnect bugs before changing low-level code.
- We will replace unsafe globals and unsafe concurrency shortcuts in small steps, not in one giant rewrite.
- We will document why each unsafe piece exists before changing it.

### Step 14: Remove dead code only after proving it is dead
- We will classify old files and alternate modules before deleting anything.
- We will remove obvious dead artifacts first, like backups or unused alternates.
- We will leave ambiguous code alone until ownership and usage are fully clear.

### Step 15: Prove upgrades and rollout are safe
- We will add integration coverage for upgrades, legacy imports, secret migration, summary generation, and note persistence.
- We will test backend lockdown and secret non-exposure directly.
- We will validate recording behavior across tray actions, UI reloads, and post-processing.
- We will create a release checklist so privacy or migration regressions are less likely to slip out.

### In one sentence
- This entire plan is about making the app safer and more predictable without breaking upgrades, losing user data, or forcing a dangerous all-at-once rewrite.

## Open Questions To Resolve Before Execution

> ⚠️ The keychain fallback question **must be decided before Gate A clears** (it is a Gate A prerequisite). The others can be deferred to their respective waves but should be answered before those waves start.

- Do we want Python to survive as a local worker, or is full retirement a real target? *(Decide before Wave 3)*
- Which current release channels and user cohorts are most likely to have mixed DB states? *(Decide before Wave 4)*
- **[Gate A blocker]** Do we want a temporary feature flag to fall back to DB-stored secrets if keychain fails? Options: (a) feature flag fallback to DB, (b) user re-entry flow with clear error, (c) stronghold as universal fallback eliminating the question. Must be decided and recorded before Step 5 begins.
- How much backward compatibility do we want to preserve for current internal debug workflows? *(Decide before Wave 1 Step 3)*

## Recommended First Implementation Slice
- Build the dependency inventory.
- Add privacy-safe logging.
- Add non-secret config APIs and masked secret presence APIs.
- Update the settings UI to stop depending on raw key reads.

This slice reduces risk immediately and unlocks the later migrations safely.

**Status Tracking:**
* 🟩 Done
* 🟨 In Progress
* 🟥 To Do

Update the overall progress percentage and step statuses as work progresses.
