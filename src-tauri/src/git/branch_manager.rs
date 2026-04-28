use git2::{BranchType, Repository};

use crate::models::*;

pub fn get_branches(repo: &Repository) -> Result<BranchesResult, String> {
    let mut local = Vec::new();
    let mut remote = Vec::new();

    let head_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()));

    if let Ok(branches) = repo.branches(Some(BranchType::Local)) {
        for branch_result in branches {
            if let Ok((branch, _)) = branch_result {
                let name = branch.name().ok().flatten().unwrap_or("").to_string();
                let is_head = head_name.as_deref() == Some(&name);

                let upstream = branch
                    .upstream()
                    .ok()
                    .and_then(|u| u.name().ok().flatten().map(|s| s.to_string()));

                let ahead_behind = if let (Ok(local_oid), Ok(upstream_branch)) =
                    (branch.get().target().ok_or(()), branch.upstream())
                {
                    if let Some(remote_oid) = upstream_branch.get().target() {
                        repo.graph_ahead_behind(local_oid, remote_oid).ok()
                    } else {
                        None
                    }
                } else {
                    None
                };

                let (last_commit_id, last_commit_summary, last_commit_time) =
                    if let Some(oid) = branch.get().target() {
                        if let Ok(commit) = repo.find_commit(oid) {
                            (
                                format!("{}", oid),
                                commit.summary().unwrap_or("").to_string(),
                                commit.time().seconds(),
                            )
                        } else {
                            (format!("{}", oid), String::new(), 0)
                        }
                    } else {
                        (String::new(), String::new(), 0)
                    };

                local.push(BranchInfo {
                    name,
                    is_head,
                    upstream,
                    ahead_behind,
                    last_commit_id,
                    last_commit_summary,
                    last_commit_time,
                });
            }
        }
    }

    if let Ok(branches) = repo.branches(Some(BranchType::Remote)) {
        for branch_result in branches {
            if let Ok((branch, _)) = branch_result {
                let name = branch.name().ok().flatten().unwrap_or("").to_string();

                let (last_commit_id, last_commit_summary, last_commit_time) =
                    if let Some(oid) = branch.get().target() {
                        if let Ok(commit) = repo.find_commit(oid) {
                            (
                                format!("{}", oid),
                                commit.summary().unwrap_or("").to_string(),
                                commit.time().seconds(),
                            )
                        } else {
                            (format!("{}", oid), String::new(), 0)
                        }
                    } else {
                        (String::new(), String::new(), 0)
                    };

                remote.push(BranchInfo {
                    name,
                    is_head: false,
                    upstream: None,
                    ahead_behind: None,
                    last_commit_id,
                    last_commit_summary,
                    last_commit_time,
                });
            }
        }
    }

    let tags = repo
        .tag_names(None)
        .map(|t| t.iter().flatten().map(|s| s.to_string()).collect())
        .unwrap_or_default();

    Ok(BranchesResult {
        local,
        remote,
        tags,
    })
}

pub fn create_branch(repo: &Repository, name: &str, start_point: Option<&str>) -> Result<(), String> {
    let commit = if let Some(sp) = start_point {
        let obj = repo.revparse_single(sp).map_err(|e| e.to_string())?;
        obj.peel_to_commit().map_err(|e| e.to_string())?
    } else {
        repo.head()
            .map_err(|e| e.to_string())?
            .peel_to_commit()
            .map_err(|e| e.to_string())?
    };

    repo.branch(name, &commit, false).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn checkout_branch(repo: &Repository, name: &str) -> Result<(), String> {
    let obj = repo
        .revparse_single(&format!("refs/heads/{}", name))
        .or_else(|_| repo.revparse_single(&format!("refs/remotes/{}", name)))
        .map_err(|e| format!("Branch not found: {}", e))?;

    repo.checkout_tree(&obj, None).map_err(|e| e.to_string())?;

    if repo.find_reference(&format!("refs/heads/{}", name)).is_ok() {
        repo.set_head(&format!("refs/heads/{}", name))
            .map_err(|e| e.to_string())?;
    } else {
        let commit = obj.peel_to_commit().map_err(|e| e.to_string())?;
        repo.branch(name, &commit, false).map_err(|e| e.to_string())?;
        repo.set_head(&format!("refs/heads/{}", name))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn delete_branch(repo: &Repository, name: &str, force: bool) -> Result<(), String> {
    let mut branch = repo
        .find_branch(name, BranchType::Local)
        .map_err(|e| format!("Branch not found: {}", e))?;

    if !force && branch.is_head() {
        return Err("Cannot delete the currently checked out branch".to_string());
    }

    branch.delete().map_err(|e| e.to_string())
}

pub fn rename_branch(repo: &Repository, old_name: &str, new_name: &str) -> Result<(), String> {
    let mut branch = repo
        .find_branch(old_name, BranchType::Local)
        .map_err(|e| format!("Branch not found: {}", e))?;

    branch.rename(new_name, false).map_err(|e| e.to_string())?;
    Ok(())
}
