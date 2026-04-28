use tauri::State;

use crate::git::RepoManager;
use crate::git::diff_engine;
use crate::models::*;

#[tauri::command]
pub fn get_commit_files(
    repo_path: String,
    commit_id: String,
    repo_manager: State<RepoManager>,
) -> Result<Vec<FileStatus>, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    diff_engine::get_commit_files(&repo, &commit_id)
}

#[tauri::command]
pub fn get_commit_diff(
    repo_path: String,
    commit_id: String,
    file_path: String,
    repo_manager: State<RepoManager>,
) -> Result<DiffResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    diff_engine::get_commit_diff(&repo, &commit_id, &file_path)
}

#[tauri::command]
pub fn get_file_diff(
    repo_path: String,
    file_path: String,
    staged: bool,
    repo_manager: State<RepoManager>,
) -> Result<DiffResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    diff_engine::get_file_diff(&repo, &file_path, staged)
}

#[tauri::command]
pub fn compare_commits(
    repo_path: String,
    from_id: String,
    to_id: String,
    repo_manager: State<RepoManager>,
) -> Result<Vec<FileStatus>, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    diff_engine::compare_commits(&repo, &from_id, &to_id)
}

#[tauri::command]
pub fn get_file_content(
    repo_path: String,
    commit_id: String,
    file_path: String,
    repo_manager: State<RepoManager>,
) -> Result<String, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();

    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;
    let entry = tree
        .get_path(std::path::Path::new(&file_path))
        .map_err(|e| e.to_string())?;
    let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(blob.content()).to_string())
}
