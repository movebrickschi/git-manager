use tauri::State;

use crate::git::RepoManager;
use crate::git::log_walker;
use crate::models::*;

#[tauri::command]
pub fn get_log(
    repo_path: String,
    filter: LogFilter,
    repo_manager: State<RepoManager>,
) -> Result<LogResult, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();
    log_walker::get_log(&repo, &filter)
}

#[tauri::command]
pub fn get_commit_detail(
    repo_path: String,
    commit_id: String,
    repo_manager: State<RepoManager>,
) -> Result<CommitInfo, String> {
    let repo_arc = repo_manager.get_repo(&repo_path)?;
    let repo = repo_arc.lock();

    let oid = git2::Oid::from_str(&commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

    let ref_map = std::collections::HashMap::new();
    let author = commit.author();
    let committer = commit.committer();

    let parents: Vec<String> = (0..commit.parent_count())
        .filter_map(|i| commit.parent_id(i).ok())
        .map(|oid| format!("{}", oid))
        .collect();

    Ok(CommitInfo {
        id: format!("{}", commit.id()),
        short_id: format!("{:.7}", commit.id()),
        message: commit.message().unwrap_or("").to_string(),
        summary: commit.summary().unwrap_or("").to_string(),
        author: author.name().unwrap_or("").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer: committer.name().unwrap_or("").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        commit_time: committer.when().seconds(),
        parents,
        refs: vec![],
        is_merge: commit.parent_count() > 1,
    })
}
