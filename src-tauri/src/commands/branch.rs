use tauri::State;

use crate::git::RepoManager;
use crate::git::branch_manager;
use crate::models::*;

#[tauri::command]
pub fn get_branches(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<BranchesResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    branch_manager::get_branches(&repo)
}

#[tauri::command]
pub fn create_branch(
    repo_path: String,
    name: String,
    start_point: Option<String>,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    branch_manager::create_branch(&repo, &name, start_point.as_deref())
}

#[tauri::command]
pub fn checkout_branch(
    repo_path: String,
    name: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    branch_manager::checkout_branch(&repo, &name)
}

#[tauri::command]
pub fn delete_branch(
    repo_path: String,
    name: String,
    force: bool,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    branch_manager::delete_branch(&repo, &name, force)
}

#[tauri::command]
pub fn rename_branch(
    repo_path: String,
    old_name: String,
    new_name: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    branch_manager::rename_branch(&repo, &old_name, &new_name)
}
