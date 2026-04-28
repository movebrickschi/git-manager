use tauri::State;

use crate::git::RepoManager;
use crate::git::remote_ops;
use crate::models::*;

#[tauri::command]
pub fn push_remote(
    repo_path: String,
    remote: Option<String>,
    branch: Option<String>,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    remote_ops::push(&repo, remote.as_deref(), branch.as_deref())
}

#[tauri::command]
pub fn pull_remote(
    repo_path: String,
    remote: Option<String>,
    rebase: Option<bool>,
    repo_manager: State<RepoManager>,
) -> Result<MergeResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    remote_ops::pull(&repo, remote.as_deref(), rebase.unwrap_or(false))
}

#[tauri::command]
pub fn fetch_remote(
    repo_path: String,
    remote: Option<String>,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    remote_ops::fetch(&repo, remote.as_deref())
}

#[tauri::command]
pub fn fetch_all(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    remote_ops::fetch_all(&repo)
}

#[tauri::command]
pub fn get_remotes(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<Vec<RemoteInfo>, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    remote_ops::get_remotes(&repo)
}
