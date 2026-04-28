use git2::{Oid, Repository, Revwalk, Sort};
use std::collections::HashMap;

use crate::models::*;

pub fn get_log(repo: &Repository, filter: &LogFilter) -> Result<LogResult, String> {
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk.set_sorting(Sort::TIME | Sort::TOPOLOGICAL).map_err(|e| e.to_string())?;

    if let Some(ref branch) = filter.branch {
        let reference = if branch.contains('/') {
            format!("refs/remotes/{}", branch)
        } else {
            format!("refs/heads/{}", branch)
        };
        if let Ok(r) = repo.find_reference(&reference) {
            if let Some(oid) = r.target() {
                revwalk.push(oid).map_err(|e| e.to_string())?;
            }
        } else {
            revwalk.push_head().map_err(|e| e.to_string())?;
        }
    } else {
        revwalk.push_head().map_err(|e| e.to_string())?;
        push_all_branches(&repo, &mut revwalk);
    }

    let ref_map = build_ref_map(repo);
    let search_regex = build_search_regex(filter);

    let mut commits = Vec::new();
    let mut count = 0;

    for oid_result in revwalk {
        let oid = match oid_result {
            Ok(oid) => oid,
            Err(_) => continue,
        };

        let commit = match repo.find_commit(oid) {
            Ok(c) => c,
            Err(_) => continue,
        };

        if !matches_filter(repo, &commit, filter, &search_regex) {
            continue;
        }

        count += 1;
        if count <= filter.skip {
            continue;
        }
        if commits.len() >= filter.limit {
            break;
        }

        let info = commit_to_info(&commit, &ref_map);
        commits.push(info);
    }

    let graph_rows = build_graph(&commits);

    Ok(LogResult {
        commits,
        graph_rows,
    })
}

fn push_all_branches(repo: &Repository, revwalk: &mut Revwalk) {
    if let Ok(branches) = repo.branches(None) {
        for branch_result in branches {
            if let Ok((branch, _)) = branch_result {
                if let Some(oid) = branch.get().target() {
                    let _ = revwalk.push(oid);
                }
            }
        }
    }
}

fn build_ref_map(repo: &Repository) -> HashMap<Oid, Vec<RefInfo>> {
    let mut map: HashMap<Oid, Vec<RefInfo>> = HashMap::new();

    let head_oid = repo.head().ok().and_then(|h| h.target());

    if let Ok(branches) = repo.branches(Some(git2::BranchType::Local)) {
        for branch_result in branches {
            if let Ok((branch, _)) = branch_result {
                if let (Some(name), Some(oid)) = (branch.name().ok().flatten(), branch.get().target()) {
                    let is_head = head_oid == Some(oid) && repo.head().ok().and_then(|h| h.shorthand().map(|s| s.to_string())) == Some(name.to_string());
                    map.entry(oid).or_default().push(RefInfo {
                        name: name.to_string(),
                        ref_type: if is_head { RefType::Head } else { RefType::Local },
                        is_head,
                    });
                }
            }
        }
    }

    if let Ok(branches) = repo.branches(Some(git2::BranchType::Remote)) {
        for branch_result in branches {
            if let Ok((branch, _)) = branch_result {
                if let (Some(name), Some(oid)) = (branch.name().ok().flatten(), branch.get().target()) {
                    map.entry(oid).or_default().push(RefInfo {
                        name: name.to_string(),
                        ref_type: RefType::Remote,
                        is_head: false,
                    });
                }
            }
        }
    }

    if let Ok(tags) = repo.tag_names(None) {
        for tag_name in tags.iter().flatten() {
            if let Ok(reference) = repo.find_reference(&format!("refs/tags/{}", tag_name)) {
                if let Some(oid) = reference.target() {
                    let resolved_oid = repo
                        .find_tag(oid)
                        .ok()
                        .and_then(|t| t.target().ok())
                        .map(|o| o.id())
                        .unwrap_or(oid);
                    map.entry(resolved_oid).or_default().push(RefInfo {
                        name: tag_name.to_string(),
                        ref_type: RefType::Tag,
                        is_head: false,
                    });
                }
            }
        }
    }

    map
}

fn build_search_regex(filter: &LogFilter) -> Option<regex::Regex> {
    if filter.search_text.is_empty() {
        return None;
    }
    if filter.use_regex {
        let mut builder = regex::RegexBuilder::new(&filter.search_text);
        builder.case_insensitive(!filter.match_case);
        builder.build().ok()
    } else {
        let escaped = regex::escape(&filter.search_text);
        let mut builder = regex::RegexBuilder::new(&escaped);
        builder.case_insensitive(!filter.match_case);
        builder.build().ok()
    }
}

fn matches_filter(
    _repo: &Repository,
    commit: &git2::Commit,
    filter: &LogFilter,
    search_regex: &Option<regex::Regex>,
) -> bool {
    if let Some(ref author_filter) = filter.author {
        let author = commit.author();
        let name = author.name().unwrap_or("");
        let email = author.email().unwrap_or("");
        if !name.contains(author_filter.as_str()) && !email.contains(author_filter.as_str()) {
            return false;
        }
    }

    if let Some(ref date_from) = filter.date_from {
        if let Ok(ts) = chrono::NaiveDate::parse_from_str(date_from, "%Y-%m-%d") {
            let commit_date = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .map(|dt| dt.date_naive());
            if let Some(cd) = commit_date {
                if cd < ts {
                    return false;
                }
            }
        }
    }

    if let Some(ref date_to) = filter.date_to {
        if let Ok(ts) = chrono::NaiveDate::parse_from_str(date_to, "%Y-%m-%d") {
            let commit_date = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .map(|dt| dt.date_naive());
            if let Some(cd) = commit_date {
                if cd > ts {
                    return false;
                }
            }
        }
    }

    if let Some(ref regex) = search_regex {
        let message = commit.message().unwrap_or("");
        let id_str = format!("{}", commit.id());
        if !regex.is_match(message) && !regex.is_match(&id_str) {
            return false;
        }
    }

    true
}

fn commit_to_info(commit: &git2::Commit, ref_map: &HashMap<Oid, Vec<RefInfo>>) -> CommitInfo {
    let id = commit.id();
    let author = commit.author();
    let committer = commit.committer();
    let message = commit.message().unwrap_or("").to_string();
    let summary = commit.summary().unwrap_or("").to_string();

    let parents: Vec<String> = (0..commit.parent_count())
        .filter_map(|i| commit.parent_id(i).ok())
        .map(|oid| format!("{}", oid))
        .collect();

    let refs = ref_map.get(&id).cloned().unwrap_or_default();

    CommitInfo {
        id: format!("{}", id),
        short_id: format!("{:.7}", id),
        message,
        summary,
        author: author.name().unwrap_or("").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        author_time: author.when().seconds(),
        committer: committer.name().unwrap_or("").to_string(),
        committer_email: committer.email().unwrap_or("").to_string(),
        commit_time: committer.when().seconds(),
        parents,
        refs,
        is_merge: commit.parent_count() > 1,
    }
}

pub fn build_graph(commits: &[CommitInfo]) -> Vec<GraphRow> {
    let mut rows = Vec::with_capacity(commits.len());
    let mut active_lanes: Vec<Option<String>> = Vec::new();
    let mut color_counter: usize = 0;
    let mut commit_colors: HashMap<String, usize> = HashMap::new();

    for commit in commits {
        let commit_col = active_lanes
            .iter()
            .position(|lane| lane.as_deref() == Some(&commit.id));

        let col = if let Some(c) = commit_col {
            c
        } else {
            let free = active_lanes.iter().position(|l| l.is_none());
            if let Some(f) = free {
                active_lanes[f] = Some(commit.id.clone());
                f
            } else {
                active_lanes.push(Some(commit.id.clone()));
                active_lanes.len() - 1
            }
        };

        let color = *commit_colors.entry(commit.id.clone()).or_insert_with(|| {
            let c = color_counter % 8;
            color_counter += 1;
            c
        });

        let mut edges = Vec::new();

        active_lanes[col] = None;

        for (pi, parent_id) in commit.parents.iter().enumerate() {
            let parent_col = active_lanes
                .iter()
                .position(|lane| lane.as_deref() == Some(parent_id));

            let target_col = if let Some(pc) = parent_col {
                pc
            } else if pi == 0 {
                active_lanes[col] = Some(parent_id.clone());
                col
            } else {
                let free = active_lanes.iter().position(|l| l.is_none());
                if let Some(f) = free {
                    active_lanes[f] = Some(parent_id.clone());
                    f
                } else {
                    active_lanes.push(Some(parent_id.clone()));
                    active_lanes.len() - 1
                }
            };

            let parent_color = *commit_colors.entry(parent_id.clone()).or_insert_with(|| {
                let c = color_counter % 8;
                color_counter += 1;
                c
            });

            let edge_type = if pi == 0 {
                EdgeType::Straight
            } else if col == target_col {
                EdgeType::Merge
            } else {
                EdgeType::Fork
            };

            edges.push(GraphEdge {
                from_col: col,
                to_col: target_col,
                color: parent_color,
                edge_type,
            });
        }

        while active_lanes.last() == Some(&None) {
            active_lanes.pop();
        }

        rows.push(GraphRow {
            commit_id: commit.id.clone(),
            column: col,
            color,
            edges,
        });
    }

    rows
}
