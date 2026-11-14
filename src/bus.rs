use std::path::PathBuf;

use crate::store::{Proxy, Site};

#[derive(Debug)]
pub enum UiCmd {
    Connect { site: Site, proxy: Option<Proxy> },
    Disconnect,
    LocalList { path: PathBuf },
    LocalMkdir { path: PathBuf },
    LocalDelete { paths: Vec<PathBuf> },
    LocalRename { from: PathBuf, to: PathBuf },
    RemoteList { path: String },
    RemoteMkdir { path: String },
    RemoteDelete { paths: Vec<String> },
    RemoteRename { from: String, to: String },
    Enqueue { task: TransferTask },
    RelayEnqueue { task: RelayTask },
}

#[derive(Debug)]
pub enum UiEvent {
    Connected,
    Disconnected,
    LocalList { path: PathBuf, entries: Vec<Entry> },
    RemoteList { path: String, entries: Vec<Entry> },
    Notify { level: Level, text: String },
    TransferStarted { id: u64, size: u64 },
    TransferProgress { id: u64, transferred: u64 },
    TransferFinished { id: u64, ok: bool, error: Option<String> },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum Level {
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone)]
pub struct Entry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub mtime: Option<i64>,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Download,
    Upload,
    Relay,
}

#[derive(Debug, Clone)]
pub struct TransferTask {
    pub id: u64,
    pub direction: Direction,
    pub remote_path: String,
    pub local_path: PathBuf,
    pub is_dir: bool,
}

/// 站点互传任务：源站点 → 目标站点（本地内存中转流水线，不落盘）
#[derive(Debug)]
pub struct RelayTask {
    pub id: u64,
    pub src_site: Site,
    pub src_proxy: Option<Proxy>,
    pub src_path: String,
    pub dst_site: Site,
    pub dst_proxy: Option<Proxy>,
    pub dst_path: String,
}

/// 流水线消息：源端生产 → 目标端消费
pub enum PipeMsg {
    Data(Vec<u8>),
    End,
}

/// 远程路径拼接（统一用 '/'，与本地平台分隔符无关）
pub fn remote_join(base: &str, name: &str) -> String {
    let b = base.trim_end_matches('/');
    if b.is_empty() {
        format!("/{name}")
    } else {
        format!("{b}/{name}")
    }
}

pub fn remote_parent(p: &str) -> Option<String> {
    let t = p.trim_end_matches('/');
    if t.is_empty() {
        return None;
    }
    match t.rfind('/') {
        Some(0) => Some("/".into()),
        Some(i) => Some(t[..i].to_string()),
        None => None,
    }
}
