use git2::Repository;
use std::path::Path;

use crate::models::*;

pub fn get_blame(
    repo: &Repository,
    file_path: &str,
    commit_id: Option<&str>,
) -> Result<BlameInfo, String> {
    let mut opts = git2::BlameOptions::new();
    opts.track_copies_same_file(true);

    if let Some(id) = commit_id {
        let oid = git2::Oid::from_str(id).map_err(|e| e.to_string())?;
        opts.newest_commit(oid);
    }

    let blame = repo
        .blame_file(Path::new(file_path), Some(&mut opts))
        .map_err(|e| e.to_string())?;

    let file_content = if let Some(id) = commit_id {
        let oid = git2::Oid::from_str(id).map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        let tree = commit.tree().map_err(|e| e.to_string())?;
        let entry = tree
            .get_path(Path::new(file_path))
            .map_err(|e| e.to_string())?;
        let blob = repo.find_blob(entry.id()).map_err(|e| e.to_string())?;
        String::from_utf8_lossy(blob.content()).to_string()
    } else {
        let workdir = repo.workdir().ok_or("No working directory")?;
        std::fs::read_to_string(workdir.join(file_path)).map_err(|e| e.to_string())?
    };

    let content_lines: Vec<&str> = file_content.lines().collect();
    let mut lines = Vec::new();

    for (i, line_content) in content_lines.iter().enumerate() {
        let line_no = (i + 1) as u32;
        if let Some(hunk) = blame.get_line(line_no as usize) {
            let commit_id = format!("{}", hunk.final_commit_id());
            let short_id = format!("{:.7}", hunk.final_commit_id());

            let (author, author_email, time, summary) =
                if let Ok(commit) = repo.find_commit(hunk.final_commit_id()) {
                    let sig = commit.author();
                    (
                        sig.name().unwrap_or("").to_string(),
                        sig.email().unwrap_or("").to_string(),
                        sig.when().seconds(),
                        commit.summary().unwrap_or("").to_string(),
                    )
                } else {
                    (String::new(), String::new(), 0, String::new())
                };

            lines.push(BlameLine {
                line_no,
                content: line_content.to_string(),
                commit_id,
                short_id,
                author,
                author_email,
                time,
                summary,
            });
        }
    }

    Ok(BlameInfo { lines })
}
