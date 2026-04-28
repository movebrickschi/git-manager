use tauri::State;

use crate::git::RepoManager;
use crate::git::merge_engine;
use crate::models::*;

#[tauri::command]
pub fn merge_branch(
    repo_path: String,
    name: String,
    repo_manager: State<RepoManager>,
) -> Result<MergeResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    merge_engine::merge_branch(&repo, &name)
}

#[tauri::command]
pub fn rebase_branch(
    repo_path: String,
    upstream: String,
    repo_manager: State<RepoManager>,
) -> Result<MergeResult, String> {
    Ok(MergeResult {
        success: false,
        conflicts: vec![],
        message: "Interactive rebase is not fully supported via libgit2. Use git CLI for rebase operations.".to_string(),
    })
}

#[tauri::command]
pub fn cherry_pick(
    repo_path: String,
    commit_id: String,
    repo_manager: State<RepoManager>,
) -> Result<MergeResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    merge_engine::cherry_pick(&repo, &commit_id)
}

#[tauri::command]
pub fn get_conflict_files(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<Vec<String>, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    merge_engine::get_conflict_files(&repo)
}

#[tauri::command]
pub fn get_conflict_content(
    repo_path: String,
    file_path: String,
    repo_manager: State<RepoManager>,
) -> Result<ConflictFile, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    merge_engine::get_conflict_content(&repo, &file_path)
}

#[tauri::command]
pub fn resolve_conflict(
    repo_path: String,
    file_path: String,
    content: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    merge_engine::resolve_conflict(&repo, &file_path, &content)
}

#[tauri::command]
pub fn clone_repo(url: String, path: String) -> Result<(), String> {
    git2::Repository::clone(&url, &path).map_err(|e| e.to_string())?;
    Ok(())
}
