# Code Review: Storage Size Feature

**Date:** 2026-03-24
**Reviewer:** Claude Code
**Files Reviewed:**
- `frontend/src-tauri/src/audio/recording_preferences.rs`
- `frontend/src-tauri/src/lib.rs`
- `frontend/src/components/PreferenceSettings.tsx`

---

## Summary

Adds a "X.X MB used" badge to the Meeting Recordings card in the Data Storage Locations settings page. A new Rust Tauri command (`get_recordings_folder_size`) recursively walks the recordings directory and sums all file sizes. The result is fetched on mount in `PreferenceSettings.tsx` and displayed as a formatted pill badge next to the section title. The Rust approach was chosen (over `@tauri-apps/plugin-fs`) because the recordings directory lives in `~/Movies/` which falls outside the JS filesystem plugin's allowed scope (`$APPDATA/*`).

---

## Checklist

| Category | Status | Notes |
|----------|--------|-------|
| Logging | ✅ | Rust uses `info!()` correctly; TS uses `console.warn` in catch (acceptable for non-critical UI) |
| Error Handling | ✅ | Rust maps all errors to strings; TS try-catch hides badge on failure rather than crashing |
| TypeScript | ⚠️ | `invoke<number>` for a `u64` return — safe in practice but see note below |
| Production Ready | ✅ | No debug statements, no TODOs, no hardcoded values |
| React/Hooks | ⚠️ | `formatBytes` defined inside component after the effect that uses it — works but may trigger `react-hooks/exhaustive-deps` lint warning |
| Performance | ✅ | One-shot effect, no polling, no unnecessary re-renders |
| Security | ✅ | Path comes from saved user preferences, no path traversal possible |
| Architecture | ✅ | Follows existing Tauri command patterns in `recording_preferences.rs` |
| Translations | ✅ | "used" is the only new string — hardcoded, consistent with existing style in this file |

---

## ✅ Looks Good

- Iterative stack-based directory walk instead of recursion — avoids stack overflow on deeply nested directories
- Gracefully returns `0` if the directory doesn't exist yet (first-time users)
- Badge is hidden (`null` state) when the command fails, rather than showing a confusing error
- Correct placement in the invoke handler list in `lib.rs`
- `formatBytes` correctly handles the 0-byte case and uses 1024-based units

---

## ⚠️ Issues Found

- **LOW** `PreferenceSettings.tsx:30` — `formatBytes` is defined as a `const` inside the component body *after* the `useEffect` that references it. This is functionally safe (effects run after render, so the closure captures the defined value), but eslint's `react-hooks/exhaustive-deps` rule may flag it as a missing dependency. **Fix:** Move `formatBytes` outside the component as a plain module-level function.

- **LOW** `PreferenceSettings.tsx:38` — `invoke<number>` is used for a Rust `u64` return type. JS `number` is a 64-bit float with 53 bits of integer precision, meaning values above ~9 petabytes would lose precision. Entirely safe for any realistic recording library size. **Fix:** Not urgent — document with a comment if desired.

- **MEDIUM** `PreferenceSettings.tsx:30` — The size is fetched once on mount and never refreshed. If a user records a meeting and then navigates to Settings in the same session, the displayed size will be stale. **Fix:** Trigger a refresh when the settings tab is focused, or add a small "↻ Refresh" button next to the badge. Non-blocking for merge.

---

## 📊 Final Summary

- **Files reviewed:** 3
- **Critical issues:** 0
- **Warnings:** 1 medium, 2 low
- **Ready for merge:** Yes — all issues are non-blocking

---

## Severity Levels

- **CRITICAL** - Security, data loss, crashes
- **HIGH** - Bugs, performance issues, bad UX
- **MEDIUM** - Code quality, maintainability
- **LOW** - Style, minor improvements
