# Architecture Hardening Step 3: Privacy-Safe Observability

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all transcript-content and summary-content logging with metadata-only structured logs across Rust, Python, and TypeScript. Add a developer-only verbose mode gated behind an explicit opt-in. Add a CI-enforced lint check to prevent content logging regressions.

**Architecture:** Three parallel changes: (1) Rust log-line replacements, (2) Python log-line replacements, (3) TypeScript/frontend `console.log` audit. All gated by a developer verbose flag so debugging is still possible without re-introducing privacy risk. A grep-based CI check enforces the policy going forward.

**Tech Stack:** Rust (`log` crate), Python (standard `logging`), TypeScript, bash (CI check script)

---

## Wave
Wave 1 — Low-Risk Foundations

## Dependency
Step 2 inventory must be complete. Use `docs/dependency-inventory.md` to confirm which files contain content logging before executing this plan.

## Acceptance Criteria
- `grep -rn "transcript\|summary" frontend/src-tauri/src/ --include="*.rs"` produces no lines that log raw content strings (only metadata: lengths, counts, IDs).
- Same check passes for `backend/`.
- `grep -rn "console\.log" frontend/src/ --include="*.tsx" --include="*.ts"` returns zero hits in production code paths (test files excluded).
- A `scripts/check-content-logging.sh` script exists and exits non-zero if a content log is re-introduced.
- `ADAMANT_VERBOSE=1` re-enables content logging for local development only, gated behind a runtime env check.
- `docs/logging-policy.md` exists and is committed.

---

## File Map

| Action | Path |
|--------|------|
| Create | `docs/logging-policy.md` |
| Modify | `frontend/src-tauri/src/whisper_engine/whisper_engine.rs` — replace content log lines |
| Modify | `frontend/src-tauri/src/summary/service.rs` — replace content log lines |
| Modify | `frontend/src-tauri/src/summary/processor.rs` — replace content log lines |
| Modify | `backend/app/main.py` — replace content log lines |
| Modify | `frontend/src/app/settings/page.tsx` — remove console.log of config |
| Modify | Any other files identified in Step 2 inventory |
| Create | `scripts/check-content-logging.sh` |

> **Note:** Exact file list may grow after running the Step 2 inventory. Add any new files found to this map before executing.

---

### Task 1: Write the logging policy

- [x] **Step 1: Create `docs/logging-policy.md`**

```markdown
# Adamant Logging Policy

## Privacy Rule

Production logs must never contain:
- Transcript text (partial or full)
- Summary text (partial or full)
- API key values (any length)
- User names, meeting titles, or folder names

Production logs MAY contain:
- IDs (meeting_id, transcript_id, chunk_id — these are UUIDs with no PII)
- Counts and lengths (e.g., "transcript: 342 chars", "summary: 3 sections")
- Timestamps and durations
- Provider names (e.g., "provider: openai") but NOT key values
- Error codes and structured error types (not raw error messages that may echo user content)

## Developer Verbose Mode

Set `ADAMANT_VERBOSE=1` in your environment to enable full content logging locally.
This variable must never be set in CI or production builds.

### Rust
```rust
if std::env::var("ADAMANT_VERBOSE").is_ok() {
    log::debug!("transcript content: {}", text);
}
```

### Python
```python
import os
if os.environ.get("ADAMANT_VERBOSE"):
    logger.debug("transcript content: %s", text)
```

### TypeScript
```typescript
if (process.env.NODE_ENV === 'development' && process.env.ADAMANT_VERBOSE) {
  console.debug('transcript content:', text);
}
```

## CI Enforcement

`scripts/check-content-logging.sh` runs in CI and fails if any log statement
contains raw content. See that script for the exact rules.
```

- [ ] **Step 2: Commit the logging policy**

```bash
git add docs/logging-policy.md
git commit -m "docs: add logging policy — no transcript/summary/key content in production logs"
```

---

### Task 2: Fix Rust content logging

- [x] **Step 3: Find every Rust log line that emits transcript or summary content**

Run from repo root:

```bash
grep -rn \
  'log::info!.*transcript\|log::debug!.*transcript\|log::warn!.*transcript\|info!.*transcript\|debug!.*transcript\|tracing::info!.*transcript\|log::info!.*summary\|info!.*summary\|debug!.*summary' \
  frontend/src-tauri/src/ \
  --include="*.rs"
```

Also check for any log line that interpolates a variable that might hold transcript text:

```bash
grep -rn 'log.*!.*{}\|tracing.*!.*{}' frontend/src-tauri/src/ --include="*.rs" | grep -i 'text\|content\|transcript\|summary\|chunk'
```

Document every hit before changing anything.

- [x] **Step 4: Replace each content log line with a metadata-only equivalent**

For each hit from Step 3, apply this pattern:

**Before (content log):**
```rust
log::info!("Processing transcript: {}", transcript_text);
log::debug!("Summary result: {}", summary_content);
log::info!("Transcript chunk: {}", chunk.transcript_text);
```

**After (metadata log):**
```rust
log::info!("Processing transcript: {} chars", transcript_text.len());
log::debug!("Summary result: {} chars", summary_content.len());
log::info!("Transcript chunk: {} chars, meeting_id={}", chunk.transcript_text.len(), chunk.meeting_id);
```

Where content logging is genuinely useful for debugging, wrap it in the verbose guard:

```rust
if std::env::var("ADAMANT_VERBOSE").is_ok() {
    log::debug!("Transcript content: {}", transcript_text);
}
log::info!("Processing transcript: {} chars", transcript_text.len());
```

- [x] **Step 5: Build to confirm no compilation errors**

```bash
cd frontend && cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: `Finished` with 0 errors. Fix any errors before proceeding.

- [ ] **Step 6: Commit Rust logging fixes**

```bash
git add frontend/src-tauri/src/
git commit -m "fix(privacy): replace transcript/summary content logs with metadata-only in Rust"
```

---

### Task 3: Fix Python content logging

- [x] **Step 7: Find every Python log line that emits transcript or summary content**

```bash
grep -rn \
  'logger\.\(info\|debug\|warning\|error\).*transcript\|print.*transcript\|logger\.\(info\|debug\).*summary\|print.*summary' \
  backend/ \
  --include="*.py"
```

Also:

```bash
grep -rn 'logging\.\(info\|debug\)' backend/ --include="*.py" | grep -i 'text\|content\|transcript\|summary'
```

- [x] **Step 8: Replace each Python content log with metadata-only equivalent**

**Before:**
```python
logger.info(f"Processing transcript: {transcript_text}")
print(f"Summary: {summary}")
logger.debug(f"Transcript chunk: {chunk}")
```

**After:**
```python
logger.info(f"Processing transcript: {len(transcript_text)} chars")
logger.info(f"Summary: {len(summary)} chars")
logger.debug(f"Transcript chunk: {len(chunk)} chars")
```

Where needed for debugging:
```python
import os
if os.environ.get("ADAMANT_VERBOSE"):
    logger.debug(f"Transcript content: {transcript_text}")
logger.info(f"Processing transcript: {len(transcript_text)} chars")
```

- [ ] **Step 9: Commit Python logging fixes**

```bash
git add backend/
git commit -m "fix(privacy): replace transcript/summary content logs with metadata-only in Python"
```

---

### Task 4: Fix TypeScript console.log usage

- [x] **Step 10: Find every console.log in production frontend code that emits config or content**

```bash
grep -rn "console\.log\|console\.debug\|console\.warn\|console\.error" \
  frontend/src/ \
  --include="*.tsx" --include="*.ts" \
  | grep -v "\.test\.\|\.spec\.\|__tests__"
```

Pay special attention to any line that logs:
- API config objects (may contain `apiKey` field)
- Transcript text
- Summary results

Example from `frontend/src/app/settings/page.tsx:39`: `console.log('Loaded saved transcript config:', config)` — this logs the full config object which may include an `apiKey` field.

- [x] **Step 11: Remove or sanitize each hit**

For each `console.log` that logs a config object containing `apiKey`:

**Before (`frontend/src/app/settings/page.tsx:39`):**
```typescript
console.log('Loaded saved transcript config:', config);
```

**After:**
```typescript
// Omit: config object may contain apiKey — use structured logging or remove entirely
if (process.env.NODE_ENV === 'development') {
  console.debug('Loaded transcript config: provider=%s model=%s hasKey=%s',
    config.provider, config.model, Boolean(config.apiKey));
}
```

For `console.log` that logs transcript or summary content, apply the same pattern:

```typescript
// Replace content log with metadata
console.debug('Transcript updated: %d chars', text.length);
```

- [ ] **Step 12: Commit frontend logging fixes**

```bash
git add frontend/src/
git commit -m "fix(privacy): remove/sanitize console.log of config and transcript content in frontend"
```

---

### Task 5: Add CI enforcement script

- [x] **Step 13: Create `scripts/check-content-logging.sh`**

```bash
#!/usr/bin/env bash
# check-content-logging.sh
# Fails if any log statement in production code emits raw transcript or summary content.
# Run in CI or pre-commit to catch regressions.

set -euo pipefail

FAIL=0

echo "Checking Rust for content logging regressions..."
# Pattern: log macro that directly interpolates a known content variable name
if grep -rn \
  'log::\(info\|debug\|warn\|error\)!.*transcript_text\|log::\(info\|debug\)!.*summary_content\|info!.*transcript_text\|debug!.*summary_content' \
  frontend/src-tauri/src/ \
  --include="*.rs" \
  | grep -v "ADAMANT_VERBOSE\|#\[cfg(test\)\|// allow"; then
  echo "ERROR: Rust content log found above. Wrap in ADAMANT_VERBOSE guard or convert to metadata log."
  FAIL=1
fi

echo "Checking Python for content logging regressions..."
if grep -rn \
  'logger\.\(info\|debug\)(f.*transcript_text\|logger\.\(info\|debug\)(f.*summary' \
  backend/ \
  --include="*.py" \
  | grep -v "ADAMANT_VERBOSE\|# allow"; then
  echo "ERROR: Python content log found above. Wrap in ADAMANT_VERBOSE guard or convert to metadata log."
  FAIL=1
fi

echo "Checking TypeScript for console.log of config objects..."
if grep -rn "console\.\(log\|debug\).*config\b" \
  frontend/src/ \
  --include="*.tsx" --include="*.ts" \
  | grep -v "\.test\.\|\.spec\.\|__tests__\|// allow\|NODE_ENV"; then
  echo "ERROR: TypeScript config log found above. Remove or gate behind NODE_ENV check."
  FAIL=1
fi

if [ $FAIL -eq 1 ]; then
  exit 1
fi

echo "✓ No content logging regressions found."
```

- [ ] **Step 14: Make the script executable and verify it passes on the current codebase**

```bash
chmod +x scripts/check-content-logging.sh
./scripts/check-content-logging.sh
```

Expected output: `✓ No content logging regressions found.`

If it fails: go back and fix the flagged lines in Tasks 2–4.

- [ ] **Step 15: Commit the CI script**

```bash
git add scripts/check-content-logging.sh
git commit -m "ci: add check-content-logging.sh to enforce privacy-safe logging policy"
```

---

## Done Criteria Checklist

- [ ] `docs/logging-policy.md` committed
- [ ] All Rust content log lines converted to metadata-only (or ADAMANT_VERBOSE gated)
- [ ] All Python content log lines converted to metadata-only (or ADAMANT_VERBOSE gated)
- [ ] All frontend `console.log` of config/transcript/summary removed or sanitized
- [ ] `scripts/check-content-logging.sh` passes with exit 0
- [ ] All changes committed with descriptive messages

## Not In Scope
- Structured logging framework adoption (e.g., replacing `log` crate with `tracing` — that is a separate refactor)
- Log aggregation or remote logging infrastructure
- Any changes to what data is stored (that is Steps 5–10)
- Removing transcript content from the database (not a logging concern)
