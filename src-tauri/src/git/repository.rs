use git2::Repository;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::models::*;

pub struct RepoManager {
    repos: Mutex<HashMap<PathBuf, Arc<Mutex<Repository>>>>,
}

impl RepoManager {
    pub fn new() -> Self {
        Self {
            repos: Mutex::new(HashMap::new()),
        }
    }

    pub fn open(&self, path: &str) -> Result<RepoOpenResult, String> {
        let path = Path::new(path);
        let repo = Repository::open(path).map_err(|e| format!("Failed to open repository: {}", e))?;

        let current_branch = get_current_branch(&repo);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());
        let abs_path = repo
            .workdir()
            .unwrap_or(path)
            .to_path_buf();

        self.repos
            .lock()
            .insert(abs_path.clone(), Arc::new(Mutex::new(repo)));

        Ok(RepoOpenResult {
            path: abs_path.to_string_lossy().to_string(),
            name,
            current_branch,
        })
    }

    pub fn get_repo(&self, path: &str) -> Result<Arc<Mutex<Repository>>, String> {
        let path = PathBuf::from(path);
        self.repos
            .lock()
            .get(&path)
            .cloned()
            .ok_or_else(|| format!("Repository not opened: {}", path.display()))
    }

    pub fn close(&self, path: &str) {
        let path = PathBuf::from(path);
        self.repos.lock().remove(&path);
    }
}

fn get_current_branch(repo: &Repository) -> String {
    repo.head()
        .ok()
        .and_then(|head| {
            if head.is_branch() {
                head.shorthand().map(|s| s.to_string())
            } else {
                head.target().map(|oid| format!("{:.7}", oid))
            }
        })
        .unwrap_or_else(|| "HEAD".to_string())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoOpenResult {
    pub path: String,
    pub name: String,
    pub current_branch: String,
}
