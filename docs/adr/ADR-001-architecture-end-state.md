# ADR-001: End-State Architecture for Secrets, Persistence, and Backend Ownership

**Date:** 2026-04-04
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
- Steps 5-6 (keychain migration) flow from this decision.
- Steps 9-10 (DB consolidation) flow from this decision.
- Python backend retirement is a valid end state, not a risk to be avoided.

## Rollback
This ADR can be revised if hidden Python dependencies are found during the Step 2 inventory
that make full retirement infeasible within the current release cycle.
