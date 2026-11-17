//! State owned by one native window; shared configuration stays in the repository.
use flashfxp_lib::{
    bus::{UiCmd, UiEvent},
    store::{Proxy, Site},
};
use std::collections::{HashMap, HashSet};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, LazyLock, Mutex,
};

pub struct Session {
    pub lease: crate::instance::Instance,
    pub cmd_tx: tokio::sync::mpsc::UnboundedSender<UiCmd>,
    pub connected: std::sync::atomic::AtomicBool,
    pub current_site: Mutex<Option<(Site, Option<Proxy>)>>,
    pub tasks: Mutex<HashMap<u64, i64>>,
    pub restored: Mutex<HashSet<u64>>,
    pub cancelled: Mutex<HashSet<u64>>,
    pub ids: Mutex<TaskIds>,
}

pub type Sessions = Mutex<HashMap<String, Arc<Session>>>;
pub static SESSIONS: LazyLock<Sessions> = LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn get(label: &str) -> Result<Arc<Session>, String> {
    SESSIONS
        .lock()
        .map_err(|e| e.to_string())?
        .get(label)
        .cloned()
        .ok_or_else(|| format!("Window session is not available: {label}"))
}

pub fn insert(label: String, session: Arc<Session>) -> Result<(), String> {
    use std::collections::hash_map::Entry;
    match SESSIONS.lock().map_err(|e| e.to_string())?.entry(label) {
        Entry::Vacant(entry) => {
            entry.insert(session);
            Ok(())
        }
        Entry::Occupied(entry) => Err(format!("Window session already exists: {}", entry.key())),
    }
}

static NEXT_WORKER_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
pub struct TaskIds {
    local_to_worker: HashMap<u64, u64>,
    worker_to_local: HashMap<u64, u64>,
}

impl TaskIds {
    pub fn worker_id(&mut self, local: u64) -> u64 {
        *self.local_to_worker.entry(local).or_insert_with(|| {
            let worker = NEXT_WORKER_ID
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |id| id.checked_add(1))
                .expect("worker task ID space exhausted");
            self.worker_to_local.insert(worker, local);
            worker
        })
    }

    pub fn local_id(&self, worker: u64) -> Option<u64> {
        self.worker_to_local.get(&worker).copied()
    }

    pub fn remove(&mut self, local: u64) {
        if let Some(worker) = self.local_to_worker.remove(&local) {
            self.worker_to_local.remove(&worker);
        }
    }
}

/// Drop transfer events belonging to another window or an already retired task.
pub fn local_event(event: UiEvent, ids: &TaskIds) -> Option<UiEvent> {
    Some(match event {
        UiEvent::TransferStarted { id, size } => UiEvent::TransferStarted {
            id: ids.local_id(id)?,
            size,
        },
        UiEvent::TransferProgress { id, transferred } => UiEvent::TransferProgress {
            id: ids.local_id(id)?,
            transferred,
        },
        UiEvent::TransferFinished { id, ok, error } => UiEvent::TransferFinished {
            id: ids.local_id(id)?,
            ok,
            error,
        },
        other => other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_local_id_has_distinct_worker_ids_and_no_cross_window_events() {
        let mut first = TaskIds::default();
        let mut second = TaskIds::default();
        let worker = first.worker_id(7);
        let other = second.worker_id(7);
        assert_ne!(worker, other);
        assert_eq!(first.worker_id(7), worker);
        assert_eq!(first.local_id(worker), Some(7));
        assert_eq!(second.local_id(worker), None);
        for event in [
            UiEvent::TransferStarted {
                id: worker,
                size: 42,
            },
            UiEvent::TransferProgress {
                id: worker,
                transferred: 12,
            },
            UiEvent::TransferFinished {
                id: worker,
                ok: false,
                error: Some("cancelled".into()),
            },
        ] {
            assert!(local_event(event.clone(), &second).is_none());
            match local_event(event, &first).unwrap() {
                UiEvent::TransferStarted { id, size } => {
                    assert_eq!(id, 7);
                    assert_eq!(size, 42);
                }
                UiEvent::TransferProgress { id, transferred } => {
                    assert_eq!(id, 7);
                    assert_eq!(transferred, 12);
                }
                UiEvent::TransferFinished { id, ok, error } => {
                    assert_eq!(id, 7);
                    assert!(!ok);
                    assert_eq!(error.as_deref(), Some("cancelled"));
                }
                _ => panic!("unexpected event"),
            }
        }
        first.remove(7);
        assert_eq!(first.local_id(worker), None);
        assert!(local_event(
            UiEvent::TransferFinished {
                id: worker,
                ok: true,
                error: None
            },
            &first
        )
        .is_none());
        assert_ne!(first.worker_id(7), worker);
        assert_eq!(second.local_id(other), Some(7));
        assert!(matches!(
            local_event(UiEvent::Connected, &first),
            Some(UiEvent::Connected)
        ));
    }

    #[test]
    fn unknown_window_never_falls_back_to_main() {
        let directory = std::env::temp_dir().join(format!(
            "flashfxp-window-state-test-{}-{}",
            std::process::id(),
            NEXT_WORKER_ID.fetch_add(1, Ordering::Relaxed)
        ));
        let make_session = || {
            let (cmd_tx, _cmd_rx) = tokio::sync::mpsc::unbounded_channel();
            Arc::new(Session {
                lease: crate::instance::Instance::create(directory.clone()).unwrap(),
                cmd_tx,
                current_site: Mutex::new(None),
                connected: std::sync::atomic::AtomicBool::new(false),
                tasks: Mutex::new(HashMap::new()),
                restored: Mutex::new(HashSet::new()),
                cancelled: Mutex::new(HashSet::new()),
                ids: Mutex::new(TaskIds::default()),
            })
        };
        let main = make_session();
        let other = make_session();
        insert("main".into(), main.clone()).unwrap();
        insert("session-state-test-other".into(), other.clone()).unwrap();
        assert!(get("nonexistent-session-state-test-window").is_err());
        assert!(insert("main".into(), other.clone()).is_err());
        assert!(Arc::ptr_eq(&get("main").unwrap(), &main));
        assert!(!Arc::ptr_eq(
            &get("session-state-test-other").unwrap(),
            &main
        ));
        main.tasks.lock().unwrap().insert(7, 123);
        main.cancelled.lock().unwrap().insert(7);
        main.restored.lock().unwrap().insert(7);
        assert!(other.tasks.lock().unwrap().is_empty());
        assert!(other.cancelled.lock().unwrap().is_empty());
        assert!(other.restored.lock().unwrap().is_empty());
        {
            let mut sessions = SESSIONS.lock().unwrap();
            sessions.remove("main");
            sessions.remove("session-state-test-other");
        }
        drop(main);
        drop(other);
        std::fs::remove_dir_all(directory).unwrap();
    }
}
