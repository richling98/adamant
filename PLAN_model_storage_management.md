# Plan: Model Storage Management — Open Folder + Delete from UI + External Deletion Detection

## 1. Overview & Goals

**Problem Statement:**
- Users download AI models (Transcription: Parakeet ~670MB, Whisper ~85-850MB; Summary: Gemma/Qwen/DeepSeek ~1-2.4GB). These accumulate disk space quickly.
- No way to see *where* models are stored on disk from in-app.
- No consistent way to delete models from UI (some managers have trash, but Whisper's is hover-only and invisible on touch, Built-in has it but no confirmation, no storage summary).
- If user manually deletes files from OS file manager, app may still think model is "Available" until restart/refresh — no feedback loop.
- User can't easily open the folder to inspect/clean manually.

**Goals:**
1. **Visibility:** Show local folder path for each engine, with one-click "Open Folder" button.
2. **Deletability:** Every downloaded model shows a trash icon (always visible, not hover-only) with confirmation dialog before deletion.
3. **Reconciliation:** If user deletes outside app, app detects and updates status to "Not Downloaded" automatically (via refresh on window focus + explicit Refresh button + show path exists check).
4. **Storage awareness:** Show per-model size and optionally total size per engine.
5. **Safety:** If deleting currently-selected/active model, warn and handle graceful fallback (unload, select alternative, toast).
6. **Consistency:** Works for all local engines: Whisper, Parakeet, Built-in Summary. Ollama already has delete, but also gets open-folder info note (external location).

---

## 2. Current State Analysis

### 2.1 Storage Locations (Rust side)

| Engine | Production Path | File Pattern | Index File |
|--------|----------------|--------------|------------|
| **Whisper** | `app_data_dir/models/` | `ggml-{name}.bin` | `whisper_engine/commands.rs: set_models_directory` calls `app.path().app_data_dir().join("models")` |
| **Parakeet** | `app_data_dir/models/parakeet/{model}/` | `encoder-model.int8.onnx`, `decoder_joint...`, `nemo128.onnx`, `vocab.txt` | `parakeet_engine/commands.rs: models_dir.join("parakeet")` |
| **Built-in Summary** | `app_data_dir/models/summary/` | `*.gguf` e.g. `gemma-3-1b-it-Q8_0.gguf` | `summary_engine/commands.rs: app_data_dir.join("models").join("summary")` |
| **Ollama** | External `~/.ollama` or Ollama config | Managed by Ollama binary | `ollama/ollama.rs` via HTTP `GET /api/tags` |

- **macOS Dev:** `~/Library/Application Support/com.adamant.ai.dev/models/...`
- **Prod:** `~/Library/Application Support/com.adamant.ai/models/...`
- All set in `frontend/src-tauri/src/lib.rs:549-570` at startup via `set_models_directory`.

### 2.2 Existing Tauri Commands

```rust
// Whisper
whisper_get_available_models() -> Vec<ModelInfo> // scans FS via discover_models()
whisper_has_available_models() -> bool
whisper_delete_corrupted_model(model_name) // despite name, deletes Available too - checks metadata + removes file
open_models_folder() // opens app_data_dir/models via explorer/open/xdg-open
whisper_get_models_directory() -> String

// Parakeet
parakeet_get_available_models()
parakeet_delete_corrupted_model(model_name) // removes dir_all
open_parakeet_models_folder() // opens .../models/parakeet
parakeet_get_models_directory() -> String

// Built-in Summary
builtin_ai_list_models() -> Vec<ModelInfo> // calls scan_models() each time, checks file exists + size in 90-110% range
builtin_ai_delete_model(model_name) // removes .gguf file
builtin_ai_is_model_ready(model_name, refresh: Option<bool>) // optional re-scan
// MISSING: builtin_ai_open_models_folder, builtin_ai_get_models_directory

// Ollama
get_ollama_models(endpoint) -> Vec<OllamaModel>
delete_ollama_model(name, endpoint)
pull_ollama_model(...)
```

**Pattern for open folder (existing):** `whisper_engine/commands.rs:465-505`
```rust
pub async fn open_models_folder() -> Result<(), String> {
  let models_dir = get_models_directory().ok_or(...)?;
  if !models_dir.exists() { create_dir_all }
  let folder_path = models_dir.to_string_lossy().to_string();
  #[cfg(target_os="windows")] Command::new("explorer").arg(&folder_path).spawn()
  #[cfg(target_os="macos")] Command::new("open").arg(&folder_path).spawn()
  #[cfg(target_os="linux")] Command::new("xdg-open").arg(&folder_path).spawn()
}
```

Replicate for built-in.

### 2.3 Frontend Managers

- `WhisperModelManager.tsx` (`ModelManager`): 
  - Actions: Download / Cancel / Retry / Delete (trash hover-only via `isHovered` + `AnimatePresence` Line ~624)
  - `WhisperAPI.openModelsFolder()` exists but never called.

- `ParakeetModelManager.tsx`:
  - Actions: always-visible trash for available L520.
  - `ParakeetAPI.openModelsFolder()` exists unused.

- `BuiltInModelManager.tsx`:
  - Actions: trash for available L438, Retry+Delete for corrupted L408-434.
  - No open-folder; needs new invoke.
  - `openModelsFolder` not defined in `lib/builtin-ai.ts` – has `getModelsDirectory` only.

- `Settings page` (`/settings/page.tsx`): Tabs, `aiModels` tab renders `TranscriptSettings` + `SummaryModelSettings`.

### 2.4 Detection of External Deletion

- `builtin_ai_list_models()` calls `scan_models()` each invoke – so if file deleted externally, next fetch will show NotDownloaded, **but**:
  - Whisper/Parakeet `get_available_models()` also scans each call.
  - Problem: UI doesn't auto-refetch on window focus; user must interact or app restart. Also selected model may still be marked active in DB even if file gone.

Need:
- Auto-refresh on `window` focus event (Tauri `tauri://focus` or browser `visibilitychange`).
- Explicit Refresh button per section.
- On delete success, clear selected if it was the deleted one.

---

## 3. Proposed Solution — Architecture

### 3.1 Rust Backend Changes

#### File: `frontend/src-tauri/src/summary/summary_engine/commands.rs`

**Add:**
```rust
#[tauri::command]
pub async fn builtin_ai_open_models_folder<R: Runtime>(app: AppHandle<R>) -> Result<(), String>
  // mirrors open_models_folder: get models directory (app_data_dir/models/summary), create if missing, open via platform command
#[tauri::command]
pub fn builtin_ai_get_models_directory<R: Runtime>(app: AppHandle<R>) -> Result<String, String>
  // return path string, similar to whisper_get_models_directory
#[tauri::command]
pub async fn builtin_ai_get_storage_info<R: Runtime>(app: AppHandle<R>) -> Result<Vec<(String, u64)>, String>
  // optional: list files + sizes for summary dir, for UI total usage
```

Register in `lib.rs` `invoke_handler`.

#### File: `frontend/src-tauri/src/lib.rs`

- Register new commands `builtin_ai_open_models_folder`, `builtin_ai_get_models_directory`.
- Ensure `set_models_directory` for summary also called at startup (already via `init_model_manager_at_startup`).

#### Optional: Unified storage summary command

In `lib.rs` or new `models/storage_info.rs`:
```rust
#[tauri::command]
pub fn get_all_models_storage_summary() -> Result<StorageSummary, String>
struct StorageSummary { whisper_dir: String, whisper_size: u64, parakeet_dir: ..., summary_dir: ..., total: u64 }
```
Lets frontend show total disk usage at top of AI Models tab.

Not strictly required for MVP – can compute size in frontend by summing model.file_size? but model list doesn't have file sizes always. Easier to get dirs and do fs walk.

For MVP, skip unified summary; just expose per-engine dir path via existing `*_get_models_directory` commands.

#### Deletion safety improvements

- `whisper_delete_corrupted_model` and `parakeet_delete_corrupted_model` should check if model is currently loaded via `whisper_is_model_loaded` / `parakeet_is_model_loaded` and unload first (set current_model to None). Or return specific error so frontend can prompt unload.
- `builtin_ai_delete_model` already handles file delete; add check for active built-in model manager holding file handle? Not needed, but ensure file closed before delete (manager drops handle).

- Also add handling for config DB: if deleted model was selected provider's model in `transcript_config` or `model_config`, need to clear? Rather keep config but mark not available; `validate_model_ready_with_config` will fail gracefully and fallback to first available on next recording. Frontend should toast guidance: "Deleted active model; please select another."

### 3.2 Frontend — lib wrappers

#### `frontend/src/lib/builtin-ai.ts`

Add:
```ts
export async function openModelsFolder(): Promise<void> {
  return invoke('builtin_ai_open_models_folder');
}
export async function getModelsDirectory(): Promise<string> {
  return invoke('builtin_ai_get_models_directory');
}
```

#### `frontend/src/lib/whisper.ts` and `parakeet.ts`

Already have `openModelsFolder()`, `getModelsDirectory()` wrappers. Verify exposed.

Add new wrapper maybe `getStorageSummary()` if backend implements.

### 3.3 Frontend — UI Changes

#### A. Global AI Models tab header (`settings/page.tsx`)

Add a card at top of `aiModels` tab:
```
[FolderOpen Icon] Models stored at: ~/Library/.../models
[Button: Open Models Folder] (opens base models dir)
[Text: Total usage: 3.2 GB] — optional
```
Simpler: Per-engine sections each get their own open folder button (more useful since dirs are separate).

#### B. TranscriptSettings.tsx

Above provider Select, add row:
```tsx
<div className="flex items-center justify-between mb-2">
  <span className="text-xs text-zinc-500">{modelsDirPath}</span>
  <div className="flex gap-2">
    <Button variant="ghost" size="sm" onClick={handleOpenWhisperFolder}><FolderOpenIcon/> Whisper Folder</Button>
    <Button variant="ghost" size="sm" onClick={handleOpenParakeetFolder}><FolderOpenIcon/> Parakeet Folder</Button>
  </div>
</div>
```
Load paths via useEffect invoking `whisper_get_models_directory` / `parakeet_get_models_directory`.

Also add Refresh button that re-fetches transcript model availability.

#### C. BuiltInModelManager.tsx — Major upgrades

Header currently L274-276 only title. Change to:
```tsx
<div className="flex items-center justify-between mb-4">
  <h4>Built-in AI Models</h4>
  <div className="flex items-center gap-2">
    <span className="text-[11px] text-zinc-500 hidden sm:inline">{modelsDir}</span>
    <button onClick={fetchModels} title="Refresh"><RefreshCw/></button>
    <button onClick={openFolder} className="inline-flex items-center gap-1 rounded-md border..."><FolderOpen/> Open Folder</button>
  </div>
</div>
<p className="text-[11px] text-zinc-600 mb-3">Stored at: {modelsDir} • Total: {totalSize}</p>
```

Per-card:
- Trash icon: **Always visible** (currently yes for BuiltIn). Keep but improve: instead of only trash for Available, also include delete for all statuses? Currently: Available -> trash icon; Corrupted -> Delete+Retry buttons; NotDownloaded -> no delete. Good.
- Add confirmation dialog: wrap `deleteModel` with `confirm` or use `Dialog` component. On click trash -> set `modelToDelete` state -> show AlertDialog "This model is X MB and will be permanently removed. This cannot be undone." -> Confirm triggers actual invoke.
- If `model.name === selectedModel` and is Available, after delete clear selected or toast.

#### D. WhisperModelManager.tsx (`ModelManager`)

- Change hover-only trash to always visible. Replace:
  ```tsx
  // Before: AnimatePresence only when isHovered
  {isAvailable && !modelIsDownloading && (
    <motion.button ... className="opacity-0 group-hover:opacity-100 ...">
  )}
  ```
  After:
  ```tsx
  {isAvailable && !isDownloading && (
    <button className="p-2 rounded hover:bg-white/10 text-zinc-400 hover:text-red-400">
      <Trash2 className="h-4 w-4"/>
    </button>
  )}
  ```
  Same as BuiltIn fix.

- Add header with Open Folder + Refresh + path display (similar to BuiltIn).
- Add same confirmation dialog.

#### E. ParakeetModelManager.tsx

- Already always-visible trash – keep, but add confirmation dialog.
- Add header Open Folder + path.

#### F. Ollama Section in ModelSettingsModal.tsx

- Already has delete per model. Add note: "Ollama models stored externally in ~/.ollama managed by Ollama binary. Open folder not applicable."
- Optionally add link to Ollama models dir if detectable.

#### G. Auto-refresh on focus / external deletion

Add in `settings/page.tsx` or each manager:

```ts
useEffect(() => {
  const handleFocus = () => {
    if (activeTab === 'aiModels') {
      // trigger refetch in children via event or prop
      window.dispatchEvent(new Event('refresh-ai-models'));
    }
  };
  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') handleFocus();
  });
  return () => { window.removeEventListener('focus', handleFocus); ... }
}, [activeTab]);
```

Managers listen:
```ts
useEffect(() => {
  const handler = () => fetchModels();
  window.addEventListener('refresh-ai-models', handler);
  return () => window.removeEventListener('refresh-ai-models', handler);
}, []);
```

Also after successful `openModelsFolder`, listen for window focus to refresh (user may delete in Finder while folder open). So focus refresh covers it.

#### H. New shared component: `ModelStorageHeader.tsx`

Create reusable header used by all three managers:
```tsx
interface Props {
  title: string;
  directory: string | null;
  onOpenFolder: () => void;
  onRefresh: () => void;
  totalSize?: string;
}
```
Renders Title left, folder path truncated with tooltip full path, Open Folder + Refresh buttons right.

---

### 3.4 Edge Cases & Safety

1. **Delete active/selected model:**
   - If `model.name === selectedModel` (prop), after delete, set selected to first available or none, show toast "Active model deleted. Please select another."
   - If model currently loaded in Rust (`is_model_loaded` true for that model), call unload first or let delete succeed and next `validate_model_ready` will fallback. Add backend check to unload if needed.

2. **Concurrent downloads + delete:**
   - Disable delete if status is Downloading (already done). Disable download if another download in progress? Existing logic cancels? Keep.
   - If delete called while file handle open, Rust `fs::remove_file` may fail on Windows (file locked). Catch error and toast "Close any app using model and try again."

3. **Permissions:**
   - `open_models_folder` may fail if dir doesn't exist (create) or platform command fails. Toast error.

4. **Ollama external storage:**
   - Don't show Open Folder for Ollama; show explanation text.

5. **Storage summary accuracy:**
   - For Parakeet, total size is sum of 4 files per model; display precomputed size from model info? Use file_size reported in ModelInfo.

6. **Large dirs:**
   - Don't recursively calculate size on UI thread; do in Rust command async.

---

## 4. Implementation Steps

### Phase 1: Rust Backend (30 min)

1. In `summary_engine/commands.rs`:
   - Add `builtin_ai_get_models_directory` returning `get_models_directory(app_data_dir)` string.
   - Add `builtin_ai_open_models_folder` mirroring whisper implementation (platform match explorer/open/xdg-open).
   - (Optional) `builtin_ai_get_storage_info` walking dir, summing file sizes.

2. In `lib.rs`:
   - Add `#[tauri::command]` registrations for new built-in commands.
   - Ensure new commands imported via `summary_engine::commands::*`.
   - `cargo check` passes.

### Phase 2: TS Lib Wrappers (10 min)

1. `frontend/src/lib/builtin-ai.ts`: Added `openModelsFolder`, `getModelsDirectory`, `getStorageInfo` wrappers.
2. Confirm `whisper.ts` and `parakeet.ts` wrappers already present.

### Phase 3: Shared UI Component (20 min)

1. Create `frontend/src/components/ModelStorageHeader.tsx`:
   - Props: title, directoryPath, onOpenFolder, onRefresh, totalSize?, isRefreshing.
   - Shows truncated path with tooltip, Open Folder button (FolderOpen icon), Refresh button (RefreshCw).
   - Responsive: hide path text on mobile, keep icons.

2. Add confirmation dialog component `DeleteModelDialog.tsx` or reuse existing `Dialog` from `ui/dialog`:
   - Shows model name, size, warning.
   - Confirm / Cancel.

### Phase 4: Update Managers (60 min)

For each manager:

**BuiltInModelManager.tsx:**
- State: `modelsDirectory`, `deleteTarget`, `showDeleteDialog`, `isRefreshing`.
- useEffect: fetch directory via `getModelsDirectory()`.
- Header: Replace simple title with `<ModelStorageHeader ... />`.
- Delete flow: onTrashClick => setDeleteTarget => show dialog => onConfirm => invoke delete => fetchModels => toast.
- Add focus listener for auto-refresh.
- Show total size: calculate from `models.filter(m=>m.type==='available').reduce(...)` or use storage info.

**WhisperModelManager.tsx:**
- Same: always-visible trash, add header, confirmation, directory fetch.
- Remove hover-only logic (Line ~624 AnimatePresence conditional on isHovered).
- Add open folder button.

**ParakeetModelManager.tsx:**
- Add header, directory, confirmation dialog (currently no confirmation).

**TranscriptSettings.tsx:**
- Optionally show global open folder buttons for quick access, but managers already have it; could add top-level summary of both paths.

### Phase 5: Settings Page Integration (20 min)

- In `settings/page.tsx` aiModels tab, add optional total usage card at top (if storage summary implemented) or just ensure managers' headers suffice.
- Make `refresh-ai-models` event dispatched on tab switch to aiModels and on window focus.

### Phase 6: External Deletion Reconciliation (15 min)

- In each manager's `fetchModels` (which calls list/get models), it already re-scans FS. So external deletion will be detected on next fetch. Focus handler ensures auto-detect.
- Add toast when model previously Available is now Missing after focus refresh: "Model X no longer found on disk – marked as not downloaded."
- For config persistence: if active model file gone, next `validate_model_ready` will error; ensure error path clears selection.

### Phase 7: Testing (30 min)

- Manual:
  1. Open Settings > AI Models, note path shown, click Open Folder – Finder/Explorer opens correct dir.
  2. Delete Parakeet model via trash icon -> confirmation dialog -> deletes dir, list updates, file gone from disk, toast.
  3. Delete Whisper model via trash (always visible, not just hover).
  4. Delete Built-in model via trash, confirm, size gone.
  5. Manually delete a .gguf file via Finder while app open, focus app – list updates to Not Downloaded (focus refresh).
  6. Delete currently selected model – app selects another or shows none, toast.
  7. Test with no models downloaded – shows Open Folder still works (creates dir).
  8. macOS + Windows path (use `open` vs `explorer`).
  9. Storage size displays correctly.
- Automated: cargo check, pnpm tsc, frontend build passes.

---

## 5. File List to Modify

**Rust:**
- `frontend/src-tauri/src/summary/summary_engine/commands.rs` — add 2-3 new commands
- `frontend/src-tauri/src/summary/summary_engine/models.rs` — if adding storage info helper
- `frontend/src-tauri/src/lib.rs` — register commands
- `frontend/src-tauri/src/whisper_engine/commands.rs` — optional add storage size fn (or just use existing dir fn)
- `frontend/src-tauri/src/parakeet_engine/commands.rs` — same

**TS Libs:**
- `frontend/src/lib/builtin-ai.ts` — add wrappers
- `frontend/src/lib/whisper.ts` — verify wrappers
- `frontend/src/lib/parakeet.ts` — verify

**Components:**
- `frontend/src/components/BuiltInModelManager.tsx` — header + open folder + confirmation + focus refresh
- `frontend/src/components/WhisperModelManager.tsx` (`ModelManager`) — always-visible trash + header + confirmation
- `frontend/src/components/ParakeetModelManager.tsx` — header + confirmation
- `frontend/src/components/ModelSettingsModal.tsx` — ensure header changes propagate (or embedded BuiltIn shows header)
- `frontend/src/app/settings/page.tsx` — optional global storage card + focus listener setup
- **New:** `frontend/src/components/ModelStorageHeader.tsx` — shared header
- **New/Reuse:** `frontend/src/components/DeleteModelDialog.tsx` — confirmation dialog (or use AlertDialog from ui)

**Docs (optional):**
- Update settings screenshot in README if needed.

---

## 6. UI Mockups (Text)

### BuiltInModelManager Header After:
```
+---------------------------------------------------------------+
| Built-in AI Models                  [↻ Refresh] [📁 Open Folder]|
| Stored at: ~/Lib/App Support/.../models/summary • 3.2 GB used |
| [Grid of model cards with trash icons always visible]         |
+---------------------------------------------------------------+
```

### Model Card After (available):
```
[Icon] Gemma 3 1B  [Ready] [Selected]
Fastest • Quickest download... 
~1.0 GB  •  32768 context
                              [🗑️ Delete]   <- trash icon button, red on hover
```

### Delete Confirmation Dialog:
```
Delete Model?
Gemma 3 1B (1.0 GB) will be permanently removed from
~/.../models/summary/gemma-3-1b-it-Q8_0.gguf

This cannot be undone. You can re-download it anytime.

[Cancel] [Delete permanently - red]
```

### Open Folder Button:
- Click -> OS file manager opens at exact directory.
- If deletion externally while folder open, on app focus, model list auto-refreshes and shows Not Downloaded.

---

## 7. Future Enhancements (Out of Scope but Noted)

- **Bulk delete:** Select multiple models, delete all with one confirmation.
- **Auto-cleanup:** Suggest deleting unused models older than 30 days.
- **Storage usage in system tray:** Show total models size in settings.
- **Model move:** Allow user to choose custom models directory path in Preferences (already exists `open_models_folder` generic).
- **Progress for deletion:** For large files, show progress? Not needed, instant.
- **Watch filesystem:** Use `notify` crate to watch models dir and auto-emit Tauri event when file deleted externally, instead of focus listener.

---

## 8. Acceptance Criteria

- [ ] In Settings > AI Models, each engine (Parakeet, Whisper, Built-in) shows local folder path and Open Folder button that opens correct dir in Finder/Explorer.
- [ ] Each downloaded model shows trash icon always visible (desktop and mobile), not hover-only.
- [ ] Clicking trash shows confirmation dialog with model name/size.
- [ ] Confirming delete removes file/dir from disk, updates UI to NotDownloaded, toast success.
- [ ] If active model deleted, UI handles gracefully (selection cleared, warning toast).
- [ ] If user deletes file via OS file manager, returning focus to app refreshes list and shows correct status (auto-detect).
- [ ] No regressions: download, cancel, retry still work.
- [ ] Works across Rune/Mithril/Bronze/Adamant themes.
- [ ] `cargo check` and `pnpm tsc` pass.

---

## 9. Risks & Mitigations

- **File locks on Windows:** Delete may fail if model file open by sidecar. Mitigation: ensure sidecar not using, or close handle before delete, show friendly error.
- **Parakeet dir deletion race:** `remove_dir_all` async while download active – disable delete while downloading (already).
- **Path permissions:** User may not have write perms to app_data_dir (rare). Toast error with details.
- **Ollama confusion:** User expects Open Folder for Ollama too – show note explaining external management.

---

## 10. Timeline Estimate

- Backend commands + wrappers: 45 min
- Shared header + dialog components: 30 min
- Manager updates x3: 60 min
- Integration + focus refresh: 20 min
- Testing across engines: 30 min
- **Total: ~3 hours**

