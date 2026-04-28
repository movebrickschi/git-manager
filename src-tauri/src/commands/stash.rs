use tauri::State;

use crate::git::RepoManager;
use crate::git::stash_manager;
use crate::models::*;

#[tauri::command]
pub fn get_stash_list(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<Vec<StashEntry>, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let mut repo = repo_arc.lock();
    stash_manager::get_stash_list(&mut repo)
}

#[tauri::command]
pub fn stash_save(
    repo_path: String,
    message: String,
    include_untracked: bool,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let mut repo = repo_arc.lock();
    stash_manager::stash_save(&mut repo, &message, include_untracked)
}

#[tauri::command]
pub fn stash_apply(
    repo_path: String,
    index: usize,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let mut repo = repo_arc.lock();
    stash_manager::stash_apply(&mut repo, index)
}

#[tauri::command]
pub fn stash_pop(
    repo_path: String,
    index: usize,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let mut repo = repo_arc.lock();
    stash_manager::stash_pop(&mut repo, index)
}

#[tauri::command]
pub fn stash_drop(
    repo_path: String,
    index: usize,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let mut repo = repo_arc.lock();
    stash_manager::stash_drop(&mut repo, index)
}
