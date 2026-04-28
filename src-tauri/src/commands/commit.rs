use git2::Repository;
use std::path::Path;
use tauri::State;

use crate::git::RepoManager;
use crate::models::*;

#[tauri::command]
pub fn get_status(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<StatusResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();

    let statuses = repo
        .statuses(Some(
            git2::StatusOptions::new()
                .include_untracked(true)
                .recurse_untracked_dirs(true)
                .include_ignored(false),
        ))
        .map_err(|e| e.to_string())?;

    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("").to_string();
        let status = entry.status();

        if status.is_index_new() {
            staged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Added,
                staged: true,
            });
        }
        if status.is_index_modified() {
            staged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Modified,
                staged: true,
            });
        }
        if status.is_index_deleted() {
            staged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Deleted,
                staged: true,
            });
        }
        if status.is_index_renamed() {
            staged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Renamed,
                staged: true,
            });
        }

        if status.is_wt_modified() {
            unstaged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Modified,
                staged: false,
            });
        }
        if status.is_wt_deleted() {
            unstaged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Deleted,
                staged: false,
            });
        }
        if status.is_wt_renamed() {
            unstaged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Renamed,
                staged: false,
            });
        }

        if status.is_wt_new() {
            untracked.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Untracked,
                staged: false,
            });
        }

        if status.is_conflicted() {
            unstaged.push(FileStatus {
                path: path.clone(),
                old_path: None,
                status: FileStatusType::Conflicted,
                staged: false,
            });
        }
    }

    Ok(StatusResult {
        staged,
        unstaged,
        untracked,
    })
}

#[tauri::command]
pub fn stage_file(
    repo_path: String,
    file_path: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_path(Path::new(&file_path))
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_file(
    repo_path: String,
    file_path: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();

    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    repo.reset_default(head.as_ref().map(|t| t.as_object()), &[&file_path])
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_all(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_all(
    repo_path: String,
    repo_manager: State<RepoManager>,
) -> Result<(), String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();

    let head = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    if let Some(tree) = head {
        repo.reset(tree.as_object(), git2::ResetType::Mixed, None)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn commit(
    repo_path: String,
    message: String,
    amend: bool,
    repo_manager: State<RepoManager>,
) -> Result<String, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();

    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut index = repo.index().map_err(|e| e.to_string())?;
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    if amend {
        let head = repo.head().map_err(|e| e.to_string())?;
        let head_commit = head.peel_to_commit().map_err(|e| e.to_string())?;
        let oid = head_commit
            .amend(Some("HEAD"), Some(&sig), Some(&sig), None, Some(&message), Some(&tree))
            .map_err(|e| e.to_string())?;
        Ok(format!("{}", oid))
    } else {
        let parent = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok());

        let parents: Vec<&git2::Commit> = parent.iter().collect();

        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
            .map_err(|e| e.to_string())?;
        Ok(format!("{}", oid))
    }
}
