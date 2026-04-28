use git2::{DiffOptions, Repository};

use crate::models::*;

pub fn get_commit_diff(
    repo: &Repository,
    commit_id: &str,
    file_path: &str,
) -> Result<DiffResult, String> {
    let oid = git2::Oid::from_str(commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let parent_tree = if commit.parent_count() > 0 {
        commit.parent(0).ok().and_then(|p| p.tree().ok())
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| e.to_string())?;

    diff_to_result(&diff, repo, parent_tree.as_ref(), Some(&tree), file_path)
}

pub fn get_commit_files(repo: &Repository, commit_id: &str) -> Result<Vec<FileStatus>, String> {
    let oid = git2::Oid::from_str(commit_id).map_err(|e| e.to_string())?;
    let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
    let tree = commit.tree().map_err(|e| e.to_string())?;

    let parent_tree = if commit.parent_count() > 0 {
        commit.parent(0).ok().and_then(|p| p.tree().ok())
    } else {
        None
    };

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    diff.foreach(
        &mut |delta, _| {
            let status = match delta.status() {
                git2::Delta::Added => FileStatusType::Added,
                git2::Delta::Deleted => FileStatusType::Deleted,
                git2::Delta::Modified => FileStatusType::Modified,
                git2::Delta::Renamed => FileStatusType::Renamed,
                git2::Delta::Copied => FileStatusType::Copied,
                _ => FileStatusType::Modified,
            };

            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());

            files.push(FileStatus {
                path: new_path.clone().or(old_path.clone()).unwrap_or_default(),
                old_path: if status == FileStatusType::Renamed { old_path } else { None },
                status,
                staged: true,
            });

            true
        },
        None,
        None,
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(files)
}

pub fn get_file_diff(
    repo: &Repository,
    file_path: &str,
    staged: bool,
) -> Result<DiffResult, String> {
    let mut opts = DiffOptions::new();
    opts.pathspec(file_path);

    let diff = if staged {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
            .map_err(|e| e.to_string())?
    } else {
        repo.diff_index_to_workdir(None, Some(&mut opts))
            .map_err(|e| e.to_string())?
    };

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
    diff_to_result(&diff, repo, head_tree.as_ref(), None, file_path)
}

pub fn compare_commits(
    repo: &Repository,
    from_id: &str,
    to_id: &str,
) -> Result<Vec<FileStatus>, String> {
    let from_oid = git2::Oid::from_str(from_id).map_err(|e| e.to_string())?;
    let to_oid = git2::Oid::from_str(to_id).map_err(|e| e.to_string())?;

    let from_commit = repo.find_commit(from_oid).map_err(|e| e.to_string())?;
    let to_commit = repo.find_commit(to_oid).map_err(|e| e.to_string())?;

    let from_tree = from_commit.tree().map_err(|e| e.to_string())?;
    let to_tree = to_commit.tree().map_err(|e| e.to_string())?;

    let diff = repo
        .diff_tree_to_tree(Some(&from_tree), Some(&to_tree), None)
        .map_err(|e| e.to_string())?;

    let mut files = Vec::new();
    diff.foreach(
        &mut |delta, _| {
            let status = match delta.status() {
                git2::Delta::Added => FileStatusType::Added,
                git2::Delta::Deleted => FileStatusType::Deleted,
                git2::Delta::Modified => FileStatusType::Modified,
                git2::Delta::Renamed => FileStatusType::Renamed,
                git2::Delta::Copied => FileStatusType::Copied,
                _ => FileStatusType::Modified,
            };

            let new_path = delta
                .new_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());
            let old_path = delta
                .old_file()
                .path()
                .map(|p| p.to_string_lossy().to_string());

            files.push(FileStatus {
                path: new_path.or(old_path).unwrap_or_default(),
                old_path: None,
                status,
                staged: false,
            });

            true
        },
        None,
        None,
        None,
    )
    .map_err(|e| e.to_string())?;

    Ok(files)
}

fn diff_to_result(
    diff: &git2::Diff,
    repo: &Repository,
    old_tree: Option<&git2::Tree>,
    new_tree: Option<&git2::Tree>,
    file_path: &str,
) -> Result<DiffResult, String> {
    let mut hunks = Vec::new();
    let mut current_hunk: Option<DiffHunk> = None;
    let mut is_binary = false;
    let mut old_path: Option<String> = None;
    let mut new_path: Option<String> = None;

    diff.foreach(
        &mut |delta, _| {
            is_binary = delta.flags().is_binary();
            old_path = delta.old_file().path().map(|p| p.to_string_lossy().to_string());
            new_path = delta.new_file().path().map(|p| p.to_string_lossy().to_string());
            true
        },
        Some(&mut |_, _| true),
        Some(&mut |_, hunk| {
            if let Some(h) = current_hunk.take() {
                hunks.push(h);
            }
            current_hunk = Some(DiffHunk {
                old_start: hunk.old_start(),
                old_lines: hunk.old_lines(),
                new_start: hunk.new_start(),
                new_lines: hunk.new_lines(),
                header: String::from_utf8_lossy(hunk.header()).to_string(),
                lines: Vec::new(),
            });
            true
        }),
        Some(&mut |_, _hunk, line| {
            if let Some(ref mut h) = current_hunk {
                let line_type = match line.origin() {
                    '+' => DiffLineType::Addition,
                    '-' => DiffLineType::Deletion,
                    _ => DiffLineType::Context,
                };
                h.lines.push(DiffLine {
                    line_type,
                    content: String::from_utf8_lossy(line.content()).to_string(),
                    old_line_no: line.old_lineno(),
                    new_line_no: line.new_lineno(),
                });
            }
            true
        }),
    )
    .map_err(|e| e.to_string())?;

    if let Some(h) = current_hunk.take() {
        hunks.push(h);
    }

    let old_content = get_file_from_tree(repo, old_tree, file_path);
    let new_content = get_file_from_tree(repo, new_tree, file_path)
        .or_else(|| read_workdir_file(repo, file_path));

    Ok(DiffResult {
        old_path,
        new_path,
        hunks,
        binary: is_binary,
        old_content,
        new_content,
    })
}

fn get_file_from_tree(repo: &Repository, tree: Option<&git2::Tree>, path: &str) -> Option<String> {
    let tree = tree?;
    let entry = tree.get_path(std::path::Path::new(path)).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    if blob.is_binary() {
        return None;
    }
    Some(String::from_utf8_lossy(blob.content()).to_string())
}

fn read_workdir_file(repo: &Repository, path: &str) -> Option<String> {
    let workdir = repo.workdir()?;
    let full_path = workdir.join(path);
    std::fs::read_to_string(full_path).ok()
}

impl PartialEq for FileStatusType {
    fn eq(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}
