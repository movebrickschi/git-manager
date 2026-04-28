use git2::Repository;

use crate::models::*;

pub fn get_stash_list(repo: &mut Repository) -> Result<Vec<StashEntry>, String> {
    let mut entries = Vec::new();

    repo.stash_foreach(|index, message, oid| {
        let time = repo
            .find_commit(*oid)
            .ok()
            .map(|c| c.time().seconds())
            .unwrap_or(0);

        entries.push(StashEntry {
            index,
            message: message.to_string(),
            commit_id: format!("{}", oid),
            time,
        });
        true
    })
    .map_err(|e| e.to_string())?;

    Ok(entries)
}

pub fn stash_save(
    repo: &mut Repository,
    message: &str,
    include_untracked: bool,
) -> Result<(), String> {
    let sig = repo.signature().map_err(|e| e.to_string())?;
    let mut flags = git2::StashFlags::DEFAULT;
    if include_untracked {
        flags |= git2::StashFlags::INCLUDE_UNTRACKED;
    }

    let msg = if message.is_empty() {
        None
    } else {
        Some(message)
    };

    repo.stash_save(&sig, msg.unwrap_or("WIP"), Some(flags))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn stash_apply(repo: &mut Repository, index: usize) -> Result<(), String> {
    repo.stash_apply(index, None)
        .map_err(|e| e.to_string())
}

pub fn stash_pop(repo: &mut Repository, index: usize) -> Result<(), String> {
    repo.stash_pop(index, None)
        .map_err(|e| e.to_string())
}

pub fn stash_drop(repo: &mut Repository, index: usize) -> Result<(), String> {
    repo.stash_drop(index)
        .map_err(|e| e.to_string())
}
