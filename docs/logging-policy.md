# Adamant Logging Policy

## Privacy Rule

Production logs must never contain:
- Transcript text (partial or full)
- Summary text (partial or full)
- API key values (any length)
- User names, meeting titles, or folder names

Production logs MAY contain:
- IDs (meeting_id, transcript_id, chunk_id - these are UUIDs with no PII)
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
