use std::path::PathBuf;
use tokio::fs;
use tracing::{info, warn};
use tauri::{Runtime, Manager};

const WIKI_ROOT: &str = "wiki";
const MEETINGS_DIR: &str = "meetings";
const CONCEPTS_DIR: &str = "concepts";

/// Return the wiki root directory (e.g. ~/Library/Application Support/Adamant/wiki).
pub fn wiki_root(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join(WIKI_ROOT)
}

/// Return the per-meeting article directory.
pub fn meetings_dir(app_data_dir: &PathBuf) -> PathBuf {
    wiki_root(app_data_dir).join(MEETINGS_DIR)
}

/// Return the concepts directory (reserved for Phase 2).
pub fn concepts_dir(app_data_dir: &PathBuf) -> PathBuf {
    wiki_root(app_data_dir).join(CONCEPTS_DIR)
}

/// Ensure wiki directory structure exists.
pub async fn ensure_dirs(app_data_dir: &PathBuf) -> Result<(), String> {
    let root = wiki_root(app_data_dir);
    fs::create_dir_all(root.join(MEETINGS_DIR))
        .await
        .map_err(|e| format!("Failed to create wiki/meetings dir: {e}"))?;
    fs::create_dir_all(root.join(CONCEPTS_DIR))
        .await
        .map_err(|e| format!("Failed to create wiki/concepts dir: {e}"))?;
    Ok(())
}

/// Read a meeting wiki article from disk. Returns None if the file does not
/// exist or is empty.
pub async fn read_meeting_article(app_data_dir: &PathBuf, meeting_id: &str) -> Option<String> {
    let path = meetings_dir(app_data_dir).join(format!("{meeting_id}.md"));
    match fs::read_to_string(&path).await {
        Ok(content) => {
            let trimmed = content.trim().to_string();
            if trimmed.is_empty() { None } else { Some(trimmed) }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => {
            warn!(meeting_id, error = %e, "Failed to read wiki article");
            None
        }
    }
}

/// Write a meeting wiki article using temp-file + atomic rename for crash
/// safety. Readers never see a partial write.
pub async fn write_meeting_article(
    app_data_dir: &PathBuf,
    meeting_id: &str,
    content: &str,
) -> Result<(), String> {
    ensure_dirs(app_data_dir).await?;
    let dir = meetings_dir(app_data_dir);
    let final_path = dir.join(format!("{meeting_id}.md"));
    let tmp_path = dir.join(format!(".{meeting_id}.tmp.md"));

    fs::write(&tmp_path, content)
        .await
        .map_err(|e| format!("Failed to write temp article: {e}"))?;
    fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to rename article (atomic commit): {e}"))?;
    info!(meeting_id, "Wiki article written");
    Ok(())
}

/// Delete a meeting wiki article from disk (called when a meeting is deleted).
pub async fn delete_meeting_article(app_data_dir: &PathBuf, meeting_id: &str) -> Result<(), String> {
    let path = meetings_dir(app_data_dir).join(format!("{meeting_id}.md"));
    match fs::remove_file(&path).await {
        Ok(_) => {
            info!(meeting_id, "Wiki article deleted");
            Ok(())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Already gone — not an error.
            Ok(())
        }
        Err(e) => Err(format!("Failed to delete wiki article: {e}")),
    }
}

/// Read the _index.md file. Returns empty string if it does not exist.
pub async fn read_index(app_data_dir: &PathBuf) -> Result<String, String> {
    let path = wiki_root(app_data_dir).join("_index.md");
    match fs::read_to_string(&path).await {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read _index.md: {e}")),
    }
}

/// Rewrite _index.md atomically (temp file + rename).
pub async fn write_index(app_data_dir: &PathBuf, content: &str) -> Result<(), String> {
    ensure_dirs(app_data_dir).await?;
    let dir = wiki_root(app_data_dir);
    let final_path = dir.join("_index.md");
    let tmp_path = dir.join("._index.tmp.md");

    fs::write(&tmp_path, content)
        .await
        .map_err(|e| format!("Failed to write temp _index.md: {e}"))?;
    fs::rename(&tmp_path, &final_path)
        .await
        .map_err(|e| format!("Failed to rename _index.md (atomic commit): {e}"))?;
    info!("_index.md updated atomically");
    Ok(())
}

/// Append a line to _log.md (for compilation history).
pub async fn append_log(app_data_dir: &PathBuf, line: &str) -> Result<(), String> {
    let path = wiki_root(app_data_dir).join("_log.md");
    let entry = format!("{line}\n");
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open _log.md for append: {e}"))?;
    file.write_all(entry.as_bytes())
        .map_err(|e| format!("Failed to append to _log.md: {e}"))?;
    Ok(())
}

/// Return the wiki directory path as a string.
#[tauri::command]
pub fn get_wiki_directory<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let path = wiki_root(&app_data_dir);
    Ok(path.to_string_lossy().to_string())
}

/// Open the wiki folder in the system file explorer.
#[tauri::command]
pub fn open_wiki_folder<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {e}"))?;
    let path = wiki_root(&app_data_dir);

    // Ensure directory exists before opening
    if !path.exists() {
        std::fs::create_dir_all(&path)
            .map_err(|e| format!("Failed to create wiki directory: {e}"))?;
    }

    let folder_path = path.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {e}"))?;
    }

    Ok(())
}
