use crate::chat::compilation_scheduler::CompilationScheduler;
use crate::database::manager::DatabaseManager;

pub struct AppState {
    pub db_manager: DatabaseManager,
    pub wiki_scheduler: CompilationScheduler,
}
