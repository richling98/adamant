# Risk Register: Architecture Hardening

Each row covers one of the 10 CTO-level findings. Update **Status** as work progresses.

| # | Issue | Owner | Blast Radius | Rollback Plan | Status |
|---|-------|-------|-------------|---------------|--------|
| 1 | Raw API keys in SQLite | Engineering | High - credential exposure for all users | Keep DB columns until keychain write verified; re-enable raw read if keychain fails | 🟥 Open |
| 2 | Raw API keys returned to React | Engineering | High - keys visible in JS heap and DevTools | Revert Tauri command to raw return; UI falls back to existing behavior | 🟥 Open |
| 3 | Notification auto-consent at startup | Engineering | Medium - degrades UX for users who wanted to opt out | Revert `initialize()` to prior behavior; no data loss | 🟥 Open |
| 4 | Transcript/summary content in production logs | Engineering | Medium - PII exposure in log files | Remove offending log lines; no state change needed | 🟥 Open |
| 5 | Backend binds on 0.0.0.0 with CORS `"*"` | Engineering | Medium - local network API exposure | Revert binding config in FastAPI startup | 🟥 Open |
| 6 | Dual DB ownership (Python + Tauri) | Engineering | High - data loss if migration is wrong | Keep compatibility reads until validation passes; never delete old owner first | 🟥 Open |
| 7 | Legacy users lose data on upgrade | Engineering | Critical - irreversible user data loss | Full migration rehearsal required before any production execution | 🟥 Open |
| 8 | Recording state desync (tray/UI/post-processing) | Engineering | High - silent recording failures | Polling remains active as fallback until event-driven path is proven | 🟥 Open |
| 9 | `static mut` / unsafe globals in audio pipeline | Engineering | Medium - undefined behavior under concurrent access | Replace incrementally; each replacement guarded by race tests | 🟥 Open |
| 10 | Dead / parallel code (`audio_v2`, `lib_old_complex.rs`) | Engineering | Low - compilation and confusion risk | Classify before deleting; preserve reference logic in docs | 🟥 Open |

## Status Key
- 🟥 Open
- 🟨 In Progress
- 🟩 Resolved
