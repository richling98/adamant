use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use sqlx::SqlitePool;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use super::wiki_compiler;

/// The debounce delay: wait this long after the last trigger before compiling.
const DEBOUNCE_MS: u64 = 5_000;

/// Holds per-meeting cancellation tokens for debounced compilation scheduling.
#[derive(Clone)]
pub struct CompilationScheduler {
    /// Map of meeting_id → cancellation token for the pending compile task.
    debounce_map: Arc<RwLock<HashMap<String, CancellationToken>>>,
}

impl CompilationScheduler {
    pub fn new() -> Self {
        Self {
            debounce_map: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Schedule a compilation for `meeting_id`.
    ///
    /// If a previous compilation was already scheduled for this meeting but
    /// hasn't started yet (within the 5s debounce window), it is cancelled and
    /// replaced by this new one.
    pub async fn schedule(
        &self,
        pool: SqlitePool,
        app_data_dir: PathBuf,
        meeting_id: String,
    ) {
        // Cancel any existing pending compilation for this meeting.
        let previous = {
            let mut map = self.debounce_map.write().await;
            map.remove(&meeting_id)
        };
        if let Some(token) = previous {
            token.cancel();
        }

        // Create a fresh cancellation token and store it.
        let token = CancellationToken::new();
        {
            let mut map = self.debounce_map.write().await;
            map.insert(meeting_id.clone(), token.clone());
        }

        let mid = meeting_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(tokio::time::Duration::from_millis(DEBOUNCE_MS)).await;

            if token.is_cancelled() {
                info!(meeting_id = %mid, "compilation_debounce_cancelled");
                return;
            }

            info!(meeting_id = %mid, "compilation_starting");
            match wiki_compiler::compile_meeting(&pool, &app_data_dir, &mid).await {
                Ok(article) => {
                    info!(meeting_id = %mid, article_len = article.len(), "compilation_completed");
                }
                Err(e) => {
                    warn!(meeting_id = %mid, error = %e, "compilation_failed");
                }
            }
        });
    }
}
