use tauri::State;

use crate::git::RepoManager;
use crate::git::repository::RepoOpenResult;

#[tauri::command]
pub fn open_repo(path: String, repo_manager: State<RepoManager>) -> Result<RepoOpenResult, String> {
    repo_manager.open(&path)
}
