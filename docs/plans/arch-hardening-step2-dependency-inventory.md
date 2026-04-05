# Architecture Hardening Step 2: Dependency Inventory

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a complete, accurate `docs/dependency-inventory.md` mapping every live code path that touches API keys, `localhost:5167`, recording state sync, and legacy/dead code — so that all subsequent hardening steps have a verified foundation to change against.

**Architecture:** This step is entirely code audit and documentation. No production code changes. The output is one committed markdown document that gates all later work.

**Tech Stack:** grep / ripgrep, Rust source audit, git

---

## Wave
Wave 1 — Low-Risk Foundations

## Dependency
Step 1 must be complete (ADR and freeze notice exist).

## Acceptance Criteria
- `docs/dependency-inventory.md` exists with all four sections populated.
- Every code path in the inventory is verified by grep output (no guesses).
- `audio_v2/` and `lib_old_complex.rs` are classified as compiled/referenced/dead.
- The document is committed.

---

## File Map

| Action | Path |
|--------|------|
| Create | `docs/dependency-inventory.md` |

---

### Task 1: Map all API key read/write code paths

- [ ] **Step 1: Find all Rust code that reads or writes API keys**

Run from the repo root:

```bash
grep -rn "api_key\|apiKey\|openaiApiKey\|anthropicApiKey\|groqApiKey\|openRouterApiKey\|deepgramApiKey\|elevenLabsApiKey\|get_api_key\|save_api_key\|get_transcript_api_key\|save_transcript_api_key" \
  frontend/src-tauri/src/ \
  --include="*.rs" \
  -l
```

Then for each file listed, run with `-n` to get line numbers. Document every hit.

Expected files to appear: `database/repositories/setting.rs`, `database/commands.rs` (if key commands exist there), `summary/service.rs` or `summary/llm_client.rs`, `openrouter/openrouter.rs`.

- [ ] **Step 2: Find all TypeScript/React code that reads or writes API keys**

```bash
grep -rn "apiKey\|api_key\|invoke.*key\|getApiKey\|saveApiKey" \
  frontend/src/ \
  --include="*.tsx" --include="*.ts" \
  -l
```

For each file, get line numbers. Pay special attention to:
- Any `invoke('api_get_model_config')` or similar that returns a config object containing `apiKey`
- Any field where the UI populates an input with an API key value loaded from Tauri

- [ ] **Step 3: Find all Python backend code that reads or writes API keys**

```bash
grep -rn "api_key\|apiKey\|openai_api_key\|anthropic\|groq" \
  backend/ \
  --include="*.py"
```

Document which endpoints accept or return key values.

- [ ] **Step 4: Find all Tauri commands that return raw API key values to the frontend**

```bash
grep -rn "api_key\|apiKey\|openaiApiKey\|anthropicApiKey\|groqApiKey\|openRouterApiKey" \
  frontend/src-tauri/src/database/commands.rs \
  frontend/src-tauri/src/summary/commands.rs \
  frontend/src-tauri/src/openrouter/commands.rs \
  -n
```

List every command that includes a raw key value in its return type. These are the commands that must be deprecated in Step 4.

---

### Task 2: Map all localhost:5167 dependencies

- [ ] **Step 5: Find all frontend references to the Python backend URL**

```bash
grep -rn "localhost:5167\|5167\|BACKEND_URL\|backendUrl\|api_url" \
  frontend/src/ \
  --include="*.tsx" --include="*.ts" --include="*.js"
```

For each hit, note: which feature uses it, and whether a Tauri equivalent already exists.

- [ ] **Step 6: Find all Rust references to the Python backend URL**

```bash
grep -rn "localhost:5167\|5167\|backend_url\|BACKEND_URL" \
  frontend/src-tauri/src/ \
  --include="*.rs"
```

- [ ] **Step 7: Document which frontend flows still require the Python backend to be running**

Based on Steps 5–6, classify each `localhost:5167` call as:
- **A — Already replaced:** Tauri command equivalent exists and is used elsewhere
- **B — Still required:** No Tauri equivalent; Python backend must stay for now
- **C — Unclear:** Needs further investigation

---

### Task 3: Map recording state synchronization points

- [ ] **Step 8: Find all recording state event emitters and listeners**

```bash
grep -rn "emit\|listen\|recording.*state\|is_recording\|RecordingState\|recording-started\|recording-stopped\|recording-update" \
  frontend/src-tauri/src/ \
  --include="*.rs"
```

```bash
grep -rn "listen\|recording.*state\|isRecording\|recordingState\|recording-started\|recording-stopped" \
  frontend/src/ \
  --include="*.tsx" --include="*.ts"
```

- [ ] **Step 9: Find all polling loops related to recording state**

```bash
grep -rn "setInterval\|poll\|setTimeout.*recording\|refetch\|polling" \
  frontend/src/ \
  --include="*.tsx" --include="*.ts"
```

```bash
grep -rn "sleep\|interval\|poll\|tokio::time::sleep" \
  frontend/src-tauri/src/audio/ \
  --include="*.rs"
```

For each polling site, note: what state it is polling for, and whether an event-based alternative already exists.

---

### Task 4: Classify legacy and dead code

- [ ] **Step 10: Determine if `audio_v2/` is compiled**

```bash
grep -rn "audio_v2\|mod audio_v2" \
  frontend/src-tauri/src/lib.rs \
  frontend/src-tauri/Cargo.toml
```

If no references: `audio_v2/` is not compiled. If referenced: determine which features use it.

```bash
grep -rn "audio_v2::" frontend/src-tauri/src/ --include="*.rs"
```

Classify as: **not compiled**, **compiled but unreferenced**, or **actively used**.

- [ ] **Step 11: Determine if `lib_old_complex.rs` is compiled**

```bash
grep -rn "lib_old_complex\|mod lib_old_complex" \
  frontend/src-tauri/src/lib.rs \
  frontend/src-tauri/src/main.rs
```

It is almost certainly not referenced (the name implies it is an archived copy). Confirm and classify.

- [ ] **Step 12: Scan for any other obvious dead artifacts**

```bash
find frontend/src-tauri/src -name "*old*" -o -name "*backup*" -o -name "*unused*" -o -name "*_v2*"
```

List every hit and classify.

---

### Task 5: Produce the inventory document

- [ ] **Step 13: Create `docs/dependency-inventory.md`**

Create the file using all findings from Steps 1–12. Use this structure exactly:

```markdown
# Dependency Inventory: Architecture Hardening

**Last updated:** YYYY-MM-DD
**Based on commit:** [git rev-parse --short HEAD]

---

## 1. API Key Code Paths

### 1.1 Rust — reads raw API keys
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|
| ... | ... | ... | ... |

### 1.2 Rust — writes raw API keys to SQLite
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|

### 1.3 TypeScript — receives or renders raw API keys
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|

### 1.4 Python — receives or returns API keys
| File | Line(s) | What it does | Needs change in Step |
|------|---------|--------------|----------------------|

### 1.5 Tauri commands that return raw keys (must be deprecated in Step 4)
| Command name | File | Return type | Replacement |
|-------------|------|------------|-------------|

---

## 2. localhost:5167 Dependencies

| File | Line(s) | Feature | Classification (A/B/C) | Notes |
|------|---------|---------|------------------------|-------|

---

## 3. Recording State Sync Points

### 3.1 Event emitters (Rust → Frontend)
| File | Line(s) | Event name | Payload |
|------|---------|-----------|---------|

### 3.2 Event listeners (Frontend)
| File | Line(s) | Event name | What it updates |
|------|---------|-----------|-----------------|

### 3.3 Polling loops
| File | Line(s) | What it polls | Interval | Event-based alternative exists? |
|------|---------|--------------|----------|--------------------------------|

---

## 4. Legacy / Dead Code Classification

| Path | Compiled? | Referenced? | Classification | Action in Step 14 |
|------|-----------|------------|----------------|-------------------|
| `src/lib_old_complex.rs` | | | | |
| `src/audio_v2/` | | | | |
| [other finds] | | | | |

---

## 5. Gate Readiness

Based on this inventory:
- **Gate A (Secret Migration):** [list any blockers found]
- **Gate C (DB Consolidation):** [list any mixed-ownership data domains found]
- **Gate D (State Simplification):** [list any polling-only paths with no event alternative]
- **Gate E (Dead Code Removal):** [classification results from Section 4]
```

- [ ] **Step 14: Commit the inventory**

```bash
git add docs/dependency-inventory.md
git commit -m "docs: add dependency inventory for architecture hardening (API keys, backend, recording state, dead code)"
```

---

## Done Criteria Checklist

- [ ] All 4 inventory sections are populated with line-level references
- [ ] Every Tauri command that returns a raw API key is named in Section 1.5
- [ ] Every `localhost:5167` call is classified A/B/C
- [ ] `audio_v2/` and `lib_old_complex.rs` are classified
- [ ] Gate readiness section is filled in
- [ ] Document is committed

## Not In Scope
- No code changes
- No deprecation of existing commands (that is Step 4)
- No deletion of legacy code (that is Step 14)
- No backend changes
