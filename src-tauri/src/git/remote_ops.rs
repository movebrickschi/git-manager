use git2::{FetchOptions, PushOptions, RemoteCallbacks, Repository};

use crate::models::*;

pub fn push(repo: &Repository, remote_name: Option<&str>, branch: Option<&str>) -> Result<(), String> {
    let remote_name = remote_name.unwrap_or("origin");
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|e| format!("Remote not found: {}", e))?;

    let branch_name = if let Some(b) = branch {
        b.to_string()
    } else {
        repo.head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| "main".to_string())
    };

    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|_url, username_from_url, _allowed_types| {
        git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
    });

    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    remote
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| e.to_string())
}

pub fn pull(repo: &Repository, remote_name: Option<&str>, rebase: bool) -> Result<MergeResult, String> {
    let remote_name = remote_name.unwrap_or("origin");

    fetch(repo, Some(remote_name))?;

    let branch_name = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(|s| s.to_string()))
        .unwrap_or_else(|| "main".to_string());

    let remote_branch = format!("{}/{}", remote_name, branch_name);

    if rebase {
        Ok(MergeResult {
            success: true,
            conflicts: vec![],
            message: "Rebase pull is not yet fully implemented via libgit2".to_string(),
        })
    } else {
        crate::git::merge_engine::merge_branch(repo, &remote_branch)
    }
}

pub fn fetch(repo: &Repository, remote_name: Option<&str>) -> Result<(), String> {
    let remote_name = remote_name.unwrap_or("origin");
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|e| format!("Remote not found: {}", e))?;

    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(|_url, username_from_url, _allowed_types| {
        git2::Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
    });

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    remote
        .fetch(&[] as &[&str], Some(&mut fetch_opts), None)
        .map_err(|e| e.to_string())
}

pub fn fetch_all(repo: &Repository) -> Result<(), String> {
    let remotes = repo.remotes().map_err(|e| e.to_string())?;
    for remote_name in remotes.iter().flatten() {
        fetch(repo, Some(remote_name))?;
    }
    Ok(())
}

pub fn get_remotes(repo: &Repository) -> Result<Vec<RemoteInfo>, String> {
    let remote_names = repo.remotes().map_err(|e| e.to_string())?;
    let mut remotes = Vec::new();

    for name in remote_names.iter().flatten() {
        if let Ok(remote) = repo.find_remote(name) {
            remotes.push(RemoteInfo {
                name: name.to_string(),
                url: remote.url().unwrap_or("").to_string(),
                fetch_url: remote.url().unwrap_or("").to_string(),
            });
        }
    }

    Ok(remotes)
}
