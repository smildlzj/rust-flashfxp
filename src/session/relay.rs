use std::sync::mpsc::Sender;

use tokio::sync::mpsc;

use crate::bus::{remote_join, PipeMsg, RelayTask, UiEvent};
use crate::session::RemoteSession;

/// 站点互传：源站点与目标站点各持独立连接，数据经内存流水线直转（不落盘）。
/// 有界通道（8×256KB）做背压：目标端写不动时源端自动暂停读取。
pub async fn run_relay(task: RelayTask, event_tx: Sender<UiEvent>) {
    let result = exec_relay(&task, &event_tx).await;
    let _ = event_tx.send(UiEvent::TransferFinished {
        id: task.id,
        ok: result.is_ok(),
        error: result.err(),
    });
}

async fn exec_relay(task: &RelayTask, event_tx: &Sender<UiEvent>) -> Result<(), String> {
    let mut src = RemoteSession::open(&task.src_site, task.src_proxy.as_ref()).await?;
    let mut dst = RemoteSession::open(&task.dst_site, task.dst_proxy.as_ref()).await?;

    // 判断源是文件还是目录：查父目录列表（SIZE 对部分服务器的目录也会返回值，不可靠）
    let name = task
        .src_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("")
        .to_string();
    let is_root = task.src_path.trim_end_matches('/') == "";
    let mut is_dir = is_root;
    if !is_root {
        let parent = crate::bus::remote_parent(&task.src_path)
            .unwrap_or_else(|| "/".to_string());
        match src.list(&parent).await {
            Ok(entries) => match entries.iter().find(|e| e.name == name) {
                Some(e) => is_dir = e.is_dir,
                None => return Err(crate::localized!("源路径不存在: {}", "Source path does not exist: {}", task.src_path)),
            },
            Err(e) => return Err(e),
        }
    }

    if !is_dir {
        let size = src.size(&task.src_path).await.unwrap_or(0);
        let dst_file = remote_join(&task.dst_path, &name);
        let _ = event_tx.send(UiEvent::TransferStarted { id: task.id, size });
        relay_file(&mut src, &mut dst, &task.src_path, &dst_file, task.id, 0, event_tx).await
    } else {
        // 递归枚举源树
        let mut dirs: Vec<String> = Vec::new();
        let mut files: Vec<(String, String, u64)> = Vec::new();
        let mut queue = vec![(task.src_path.clone(), task.dst_path.clone())];
        while let Some((sdir, ddir)) = queue.pop() {
            let entries = src.list(&sdir).await?;
            for e in &entries {
                let spath = remote_join(&sdir, &e.name);
                let dpath = remote_join(&ddir, &e.name);
                if e.is_dir {
                    dirs.push(dpath.clone());
                    queue.push((spath, dpath));
                } else if e.is_symlink {
                    continue;
                } else {
                    files.push((spath, dpath, e.size));
                }
            }
        }
        let total: u64 = files.iter().map(|(_, _, s)| *s).sum();
        let _ = event_tx.send(UiEvent::TransferStarted { id: task.id, size: total });
        let _ = dst.mkdir(&task.dst_path).await; // 根目录（已存在时忽略）
        for ddir in &dirs {
            let _ = dst.mkdir(ddir).await; // 已存在时忽略
        }
        let mut base: u64 = 0;
        for (spath, dpath, size) in &files {
            relay_file(&mut src, &mut dst, spath, dpath, task.id, base, event_tx).await?;
            base += size;
        }
        Ok(())
    }
}

async fn relay_file(
    src: &mut RemoteSession,
    dst: &mut RemoteSession,
    src_path: &str,
    dst_path: &str,
    id: u64,
    base: u64,
    event_tx: &Sender<UiEvent>,
) -> Result<(), String> {
    let (tx, rx) = mpsc::channel::<PipeMsg>(8);
    // 生产者与消费者并发：源端读取与目标端写入同时进行（src/dst 是不同连接）
    let (p, c) = tokio::join!(
        src.read_chunks(src_path, id, base, tx, event_tx),
        dst.write_chunks(dst_path, rx),
    );
    p?;
    c
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::RelayTask;
    use crate::store::{Proxy, Site};
    use std::sync::mpsc;

    fn site(port: u16) -> Site {
        Site {
            id: 0,
            group_id: None,
            name: "中转测试".into(),
            host: "127.0.0.1".into(),
            port,
            protocol: "ftp".into(),
            username: Some("test".into()),
            password: Some("test".into()),
            encoding: "auto".into(),
            passive_mode: true,
            login_cmds: None,
            proxy_id: None,
            tls_accept_invalid: false,
            local_path: None,
            remote_path: None,
            account: None,
            notes: String::new(),
            login_type: "normal".into(),
            timezone_offset_minutes: None,
        }
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 双服务器 (2121/2123)"]
    async fn relay_between_servers() {
        let (event_tx, event_rx) = mpsc::channel::<UiEvent>();
        let task = RelayTask {
            id: 50,
            src_site: site(2121),
            src_proxy: None,
            src_path: "/sub".into(),
            dst_site: site(2123),
            dst_proxy: None,
            dst_path: "/from-relay".into(),
        };
        run_relay(task, event_tx).await;

        let mut finished_ok = false;
        while let Ok(ev) = event_rx.try_recv() {
            println!("relay event: {ev:?}");
            if let UiEvent::TransferFinished { ok, .. } = ev {
                finished_ok = ok;
            }
        }
        assert!(finished_ok, "互传未成功完成");
        // 验证目标内容
        let mut dst = crate::session::RemoteSession::open(&site(2123), None).await.unwrap();
        let entries = dst.list("/from-relay").await.unwrap();
        assert!(entries.iter().any(|e| e.name == "nested.txt"));
    }
}
