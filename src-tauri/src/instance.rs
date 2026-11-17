//! 独立进程的队列所有权。文件锁随进程退出自动释放，不能只用 PID 判断存活。
use fs2::FileExt;
use std::{fs::{File, OpenOptions}, path::{Path, PathBuf}};
use flashfxp_lib::store::Site;

pub struct Instance {
    pub id: String,
    directory: PathBuf,
    _lease: File,
}

impl Instance {
    pub fn create(directory: PathBuf) -> std::io::Result<Self> {
        std::fs::create_dir_all(&directory)?;
        let id = format!("{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
        let lease = OpenOptions::new().read(true).write(true).create_new(true).open(directory.join(format!("{id}.lock")))?;
        lease.try_lock_exclusive()?;
        Ok(Self { id, directory, _lease: lease })
    }

    pub fn lock_inactive(&self, id: &str) -> std::io::Result<Option<File>> {
        if id == self.id || id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit() || c == b'-') {
            return Ok(None);
        }
        let file = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(self.directory.join(format!("{id}.lock")))?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(file)),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(e) => Err(e),
        }
    }
}

/// 不包含密码；同一站点编辑地址/用户后不能把旧任务发送到新端点。
pub fn site_key(site: &Site) -> String {
    serde_json::to_string(&(site.id, site.protocol.to_ascii_lowercase(), site.host.to_ascii_lowercase(), site.port, &site.username, &site.account)).expect("site identity")
}

pub fn atomic_write(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&temporary, contents)?;
    std::fs::rename(temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_connection_keeps_local_bookmarks_in_local_scope() {
        let site: Site = serde_json::from_value(serde_json::json!({
            "id":5,"name":"saved","host":"offline.example","port":21,"protocol":"ftp",
            "username":"alice","encoding":"utf-8","passiveMode":true,"tlsAcceptInvalid":false
        })).unwrap();
        assert_eq!(super::bookmark_scope_for(Some(&site), false), "local");
        assert_eq!(super::bookmark_scope_for(Some(&site), true), "site:5");
        assert_eq!(super::bookmark_scope_for(None, true), "local");
    }

    #[test]
    fn queue_identity_tracks_endpoint_but_never_password() {
        let mut site: Site = serde_json::from_value(serde_json::json!({
            "id":1,"name":"test","host":"EXAMPLE.COM","port":21,"protocol":"ftp",
            "username":"alice","password":"first-secret","encoding":"utf-8",
            "passiveMode":true,"tlsAcceptInvalid":false
        })).unwrap();
        let key = site_key(&site);
        assert!(!key.contains("first-secret"));
        site.password = Some("second-secret".into());
        assert_eq!(key, site_key(&site));
        site.username = Some("bob".into());
        assert_ne!(key, site_key(&site));
        site.username = Some("alice".into());
        site.host = "other.example.com".into();
        assert_ne!(key, site_key(&site));
    }

    #[test]
    fn live_instance_cannot_be_claimed_but_exited_instance_can() {
        let dir = std::env::temp_dir().join(format!("rustftp-lease-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let a = Instance::create(dir.clone()).unwrap();
        let b = Instance::create(dir.clone()).unwrap();
        assert!(b.lock_inactive(&a.id).unwrap().is_none());
        assert!(b.lock_inactive("../outside").unwrap().is_none());
        let a_id = a.id.clone();
        drop(a);
        let claim = b.lock_inactive(&a_id).unwrap().unwrap();
        assert!(b.lock_inactive(&a_id).unwrap().is_none());
        drop(claim);
        assert!(b.lock_inactive(&a_id).unwrap().is_some());
        drop(b);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
mod cancellation_tests {
    #[test]
    fn cancelling_unsubmitted_restored_task_finishes_it_and_removes_tracking() {
        let mut restored = std::collections::HashSet::from([42]);
        let mut tracked = std::collections::HashMap::from([(42, 99)]);
        let event = super::restored_cancellation(42, &mut restored, &mut tracked).unwrap();
        assert_eq!(event["TransferFinished"]["cancelled"], true);
        assert_eq!(event["TransferFinished"]["ok"], false);
        assert!(!restored.contains(&42));
        assert!(!tracked.contains_key(&42));
        assert!(super::restored_cancellation(42, &mut restored, &mut tracked).is_none());
        tracked.insert(43, 100);
        assert!(super::restored_cancellation(43, &mut restored, &mut tracked).is_none());
        assert_eq!(tracked[&43], 100); // Submitted tasks complete through their worker.
    }
}

/// 未提交的恢复任务没有 worker，取消时直接完成 UI 状态并移除运行时映射。
pub fn restored_cancellation(
    id: u64,
    restored: &mut std::collections::HashSet<u64>,
    tracked: &mut std::collections::HashMap<u64, i64>,
) -> Option<serde_json::Value> {
    if !restored.remove(&id) { return None; }
    tracked.remove(&id);
    Some(serde_json::json!({"TransferFinished": {
        "id": id, "ok": false, "cancelled": true,
        "error": flashfxp_lib::localized!("已取消", "Cancelled")
    }}))
}

/// 保存的站点配置并不代表连接成功；离线时必须使用本地书签。
pub fn bookmark_scope_for(site: Option<&Site>, connected: bool) -> String {
    match site.filter(|_| connected) {
        Some(site) if site.id > 0 => format!("site:{}", site.id),
        Some(site) => format!("quick:{}", site_key(site)),
        None => "local".into(),
    }
}
