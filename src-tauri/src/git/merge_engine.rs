use git2::Repository;
use std::path::Path;

use crate::models::*;

pub fn merge_branch(repo: &Repository, branch_name: &str) -> Result<MergeResult, String> {
    let reference = repo
        .find_reference(&format!("refs/heads/{}", branch_name))
        .or_else(|_| repo.find_reference(&format!("refs/remotes/{}", branch_name)))
        .map_err(|e| format!("Branch not found: {}", e))?;

    let annotated = repo
        .reference_to_annotated_commit(&reference)
        .map_err(|e| e.to_string())?;

    let (analysis, _) = repo.merge_analysis(&[&annotated]).map_err(|e| e.to_string())?;

    if analysis.is_up_to_date() {
        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: "Already up to date".to_string(),
        });
    }

    if analysis.is_fast_forward() {
        let target_oid = annotated.id();
        let mut reference = repo.head().map_err(|e| e.to_string())?;
        reference
            .set_target(target_oid, "Fast-forward merge")
            .map_err(|e| e.to_string())?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::new().force()))
            .map_err(|e| e.to_string())?;

        return Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: "Fast-forward merge completed".to_string(),
        });
    }

    repo.merge(&[&annotated], None, None)
        .map_err(|e| e.to_string())?;

    let index = repo.index().map_err(|e| e.to_string())?;
    if index.has_conflicts() {
        let conflicts: Vec<String> = index
            .conflicts()
            .map_err(|e| e.to_string())?
            .filter_map(|c| c.ok())
            .filter_map(|c| {
                c.our
                    .as_ref()
                    .and_then(|e| String::from_utf8(e.path.clone()).ok())
            })
            .collect();

        return Ok(MergeResult {
            success: false,
            conflicts,
            message: "Merge conflicts detected".to_string(),
        });
    }

    Ok(MergeResult {
        success: true,
        conflicts: vec![],
        message: format!("Merged {} successfully", branch_name),
    })
}

pub fn cherry_pick(repo: &Repository, commit_id: &str) -> Result<MergeResult, String> {
    let oid = git2::Oid::from_str(commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;

    repo.cherrypick(&commit, None).map_err(|e| e.to_string())?;

    let index = repo.index().map_err(|e| e.to_string())?;
    if index.has_conflicts() {
        let conflicts: Vec<String> = index
            .conflicts()
            .map_err(|e| e.to_string())?
            .filter_map(|c| c.ok())
            .filter_map(|c| {
                c.our
                    .as_ref()
                    .and_then(|e| String::from_utf8(e.path.clone()).ok())
            })
            .collect();

        return Ok(MergeResult {
            success: false,
            conflicts,
            message: "Cherry-pick conflicts detected".to_string(),
        });
    }

    Ok(MergeResult {
        success: true,
        conflicts: vec![],
        message: format!("Cherry-picked {} successfully", &commit_id[..7]),
    })
}

pub fn get_conflict_files(repo: &Repository) -> Result<Vec<String>, String> {
    let index = repo.index().map_err(|e| e.to_string())?;
    let conflicts: Vec<String> = index
        .conflicts()
        .map_err(|e| e.to_string())?
        .filter_map(|c| c.ok())
        .filter_map(|c| {
            c.our
                .as_ref()
                .and_then(|e| String::from_utf8(e.path.clone()).ok())
        })
        .collect();
    Ok(conflicts)
}

pub fn get_conflict_content(repo: &Repository, file_path: &str) -> Result<ConflictFile, String> {
    let index = repo.index().map_err(|e| e.to_string())?;

    let mut base_content = String::new();
    let mut ours_content = String::new();
    let mut theirs_content = String::new();

    for conflict in index.conflicts().map_err(|e| e.to_string())? {
        let conflict = conflict.map_err(|e| e.to_string())?;
        let path = conflict
            .our
            .as_ref()
            .or(conflict.their.as_ref())
            .and_then(|e| String::from_utf8(e.path.clone()).ok())
            .unwrap_or_default();

        if path == file_path {
            if let Some(ref ancestor) = conflict.ancestor {
                if let Ok(blob) = repo.find_blob(ancestor.id) {
                    base_content = String::from_utf8_lossy(blob.content()).to_string();
                }
            }
            if let Some(ref our) = conflict.our {
                if let Ok(blob) = repo.find_blob(our.id) {
                    ours_content = String::from_utf8_lossy(blob.content()).to_string();
                }
            }
            if let Some(ref their) = conflict.their {
                if let Ok(blob) = repo.find_blob(their.id) {
                    theirs_content = String::from_utf8_lossy(blob.content()).to_string();
                }
            }
            break;
        }
    }

    Ok(ConflictFile {
        path: file_path.to_string(),
        ours_content,
        theirs_content,
        base_content,
    })
}

pub fn resolve_conflict(repo: &Repository, file_path: &str, content: &str) -> Result<(), String> {
    let workdir = repo
        .workdir()
        .ok_or("No working directory")?;
    let full_path = workdir.join(file_path);

    std::fs::write(&full_path, content).map_err(|e| e.to_string())?;

    let mut index = repo.index().map_err(|e| e.to_string())?;
    index
        .add_path(Path::new(file_path))
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    Ok(())
}
