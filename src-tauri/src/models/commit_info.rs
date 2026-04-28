use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub summary: String,
    pub author: String,
    pub author_email: String,
    pub author_time: i64,
    pub committer: String,
    pub committer_email: String,
    pub commit_time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<RefInfo>,
    pub is_merge: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefInfo {
    pub name: String,
    pub ref_type: RefType,
    pub is_head: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RefType {
    Local,
    Remote,
    Tag,
    Head,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphRow {
    pub commit_id: String,
    pub column: usize,
    pub color: usize,
    pub edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub from_col: usize,
    pub to_col: usize,
    pub color: usize,
    pub edge_type: EdgeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EdgeType {
    Straight,
    Merge,
    Fork,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogResult {
    pub commits: Vec<CommitInfo>,
    pub graph_rows: Vec<GraphRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFilter {
    pub skip: usize,
    pub limit: usize,
    pub branch: Option<String>,
    pub author: Option<String>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub path: Option<String>,
    pub search_text: String,
    pub use_regex: bool,
    pub match_case: bool,
}
