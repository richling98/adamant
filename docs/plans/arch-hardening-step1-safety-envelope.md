# Architecture Hardening Step 1: Safety Envelope

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce three documents — an ADR defining the end-state architecture, a risk register for all 10 hardening issues, and a freeze notice — so every subsequent step has a shared contract to execute against.

**Architecture:** This step is entirely documentation. No code changes. Output is three committed markdown files in `docs/`.

**Tech Stack:** Markdown, git

---

## Wave
Wave 1 — Low-Risk Foundations

## Dependency
None. This is the first step.

## Acceptance Criteria
- `docs/adr/ADR-001-architecture-end-state.md` exists and is committed.
- `docs/risk-register-architecture-hardening.md` exists with all 10 issues populated.
- `docs/FREEZE.md` exists and clearly states which work areas are frozen.

---

## File Map

| Action | Path |
|--------|------|
| Create | `docs/adr/ADR-001-architecture-end-state.md` |
| Create | `docs/risk-register-architecture-hardening.md` |
| Create | `docs/FREEZE.md` |

---

### Task 1: Create the ADR directory and ADR-001

- [x] **Step 1: Create the `docs/adr/` directory and `ADR-001` file**

Create `docs/adr/ADR-001-architecture-end-state.md` with this exact content (fill in the date):

```markdown
# ADR-001: End-State Architecture for Secrets, Persistence, and Backend Ownership

**Date:** YYYY-MM-DD
**Status:** Accepted
**Deciders:** Engineering lead

---

## Context

Adamant currently has three unresolved ownership ambiguities:
1. API keys are stored in plaintext in SQLite and returned raw to React components.
2. Both the FastAPI Python backend and the Tauri Rust backend persist meeting/config data, with no canonical owner.
3. The Python backend binds on localhost:5167 and is exposed to CORS `"*"` with no narrowing.

These create privacy risk, upgrade risk, and maintenance confusion.

## Decision

### Secrets
Tauri (Rust) is the sole owner of all API key secrets. Secrets are stored in the OS keychain
(macOS Keychain, Windows Credential Manager, Linux Secret Service), not in SQLite. No raw API
key value is ever returned to a React component. UI components receive only a boolean
presence/masked indicator.

### Persistence
Tauri SQLite (sqlx) is the canonical store for all user data: meetings, notes, transcripts,
summaries, settings, folders. The Python FastAPI backend moves toward a stateless worker role
(LLM inference, transcript processing) and is eventually retired from data ownership.

### Backend Ownership
FastAPI survives only for workloads that cannot run in Rust: heavy LLM inference (Ollama
integration), transcript post-processing pipelines. It does not own any user-visible data.
Its localhost binding is restricted to 127.0.0.1 and CORS is narrowed to the Tauri webview origin.

## Consequences

- All migration work targets Tauri as the destination, not a dual-ownership state.
- Steps 5–6 (keychain migration) flow from this decision.
- Steps 9–10 (DB consolidation) flow from this decision.
- Python backend retirement is a valid end state, not a risk to be avoided.

## Rollback
This ADR can be revised if hidden Python dependencies are found during the Step 2 inventory
that make full retirement infeasible within the current release cycle.
```

- [ ] **Step 2: Commit ADR-001**

```bash
git add docs/adr/ADR-001-architecture-end-state.md
git commit -m "docs: add ADR-001 end-state architecture for secrets, persistence, backend ownership"
```

Expected: commit succeeds, file appears in `docs/adr/`.

---

### Task 2: Create the risk register

- [x] **Step 3: Create `docs/risk-register-architecture-hardening.md`**

```markdown
# Risk Register: Architecture Hardening

Each row covers one of the 10 CTO-level findings. Update **Status** as work progresses.

| # | Issue | Owner | Blast Radius | Rollback Plan | Status |
|---|-------|-------|-------------|---------------|--------|
| 1 | Raw API keys in SQLite | Engineering | High — credential exposure for all users | Keep DB columns until keychain write verified; re-enable raw read if keychain fails | 🟥 Open |
| 2 | Raw API keys returned to React | Engineering | High — keys visible in JS heap and DevTools | Revert Tauri command to raw return; UI falls back to existing behavior | 🟥 Open |
| 3 | Notification auto-consent at startup | Engineering | Medium — degrades UX for users who wanted to opt out | Revert `initialize()` to prior behavior; no data loss | 🟥 Open |
| 4 | Transcript/summary content in production logs | Engineering | Medium — PII exposure in log files | Remove offending log lines; no state change needed | 🟥 Open |
| 5 | Backend binds on 0.0.0.0 with CORS `"*"` | Engineering | Medium — local network API exposure | Revert binding config in FastAPI startup | 🟥 Open |
| 6 | Dual DB ownership (Python + Tauri) | Engineering | High — data loss if migration is wrong | Keep compatibility reads until validation passes; never delete old owner first | 🟥 Open |
| 7 | Legacy users lose data on upgrade | Engineering | Critical — irreversible user data loss | Full migration rehearsal required before any production execution | 🟥 Open |
| 8 | Recording state desync (tray/UI/post-processing) | Engineering | High — silent recording failures | Polling remains active as fallback until event-driven path is proven | 🟥 Open |
| 9 | `static mut` / unsafe globals in audio pipeline | Engineering | Medium — undefined behavior under concurrent access | Replace incrementally; each replacement guarded by race tests | 🟥 Open |
| 10 | Dead / parallel code (`audio_v2`, `lib_old_complex.rs`) | Engineering | Low — compilation and confusion risk | Classify before deleting; preserve reference logic in docs | 🟥 Open |

## Status Key
- 🟥 Open
- 🟨 In Progress
- 🟩 Resolved
```

- [ ] **Step 4: Commit the risk register**

```bash
git add docs/risk-register-architecture-hardening.md
git commit -m "docs: add architecture hardening risk register for all 10 issues"
```

---

### Task 3: Create the freeze notice

- [x] **Step 5: Create `docs/FREEZE.md`**

```markdown
# Feature Freeze Notice: Architecture Hardening Program

**Effective:** [date Step 1 is completed]
**Lifted:** When Steps 1–4 are complete and Gates A–E are defined in the dependency inventory.

## Frozen Work Areas

The following areas must not receive new feature work until the architecture hardening program
completes Wave 1 (Steps 1–4):

- **Settings UI** — no new API key fields, no new provider integrations
- **Secrets / API key storage** — no new columns, no new Tauri commands that read or write raw keys
- **Summary ownership** — no moving summary storage to new backends or new tables
- **Persistence layer** — no new migrations that add user data to the Python backend DB
- **Backend CORS / binding** — no relaxing of network exposure

## What Is NOT Frozen

- Bug fixes to existing recording, transcription, and playback flows
- UI polish that does not touch settings, secrets, or persistence
- Documentation, tests, and observability improvements
- Work that is explicitly part of the hardening program itself

## How to Request an Exception

If a critical bug requires touching a frozen area, document the change in a new ADR and confirm
it does not conflict with the hardening plan's end state before merging.
```

- [ ] **Step 6: Commit the freeze notice**

```bash
git add docs/FREEZE.md
git commit -m "docs: add feature freeze notice for architecture hardening program"
```

---

## Done Criteria Checklist

- [ ] `docs/adr/ADR-001-architecture-end-state.md` committed
- [ ] `docs/risk-register-architecture-hardening.md` committed with all 10 issues
- [ ] `docs/FREEZE.md` committed with frozen areas clearly listed
- [ ] All 3 commits are clean and pushed (or ready for PR)

## Not In Scope
- No code changes
- No migration logic
- No dependency inventory (that is Step 2)
