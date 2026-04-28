use tauri::State;

use crate::git::RepoManager;
use crate::git::blame_engine;
use crate::models::*;

#[tauri::command]
pub fn get_blame(
    repo_path: String,
    file_path: String,
    commit_id: Option<String>,
    repo_manager: State<RepoManager>,
) -> Result<BlameInfo, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    blame_engine::get_blame(&repo, &file_path, commit_id.as_deref())
}
