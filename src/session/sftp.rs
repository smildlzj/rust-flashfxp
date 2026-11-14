use std::path::Path;
use std::sync::Arc;
use std::sync::mpsc::Sender;

use async_trait::async_trait;
use russh::client::{self};
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::OpenFlags;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

use crate::bus::{Entry, UiEvent};
use crate::store::Site;

struct ClientHandler;

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // 注意：当前接受任意主机密钥（未做 known_hosts 校验）
        Ok(true)
    }
}

/// SFTP 会话（russh + russh-sftp），与 FtpSession 保持相同方法面
pub struct SftpBackend {
    sftp: SftpSession,
    cwd: String,
}

impl SftpBackend {
    pub async fn connect(site: &Site) -> Result<Self, String> {
        let config = client::Config::default();
        let mut handle =
            client::connect(Arc::new(config), (site.host.as_str(), site.port), ClientHandler)
                .await
                .map_err(|e| format!("连接失败: {e}"))?;
        let user = site.username.as_deref().unwrap_or("anonymous");
        let pass = site.password.as_deref().unwrap_or("");
        let authed = handle
            .authenticate_password(user, pass)
            .await
            .map_err(|e| format!("SFTP 认证失败: {e}"))?;
        if !authed {
            return Err("SFTP 认证失败: 用户名或密码错误".into());
        }
        let channel = handle
            .channel_open_session()
            .await
            .map_err(|e| format!("打开通道失败: {e}"))?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("请求 SFTP 子系统失败: {e}"))?;
        let sftp = SftpSession::new(channel.into_stream())
            .await
            .map_err(|e| format!("初始化 SFTP 失败: {e}"))?;
        let cwd = sftp
            .canonicalize(".")
            .await
            .unwrap_or_else(|_| "/".into());
        Ok(Self { sftp, cwd })
    }

    pub async fn pwd(&mut self) -> Result<String, String> {
        Ok(self.cwd.clone())
    }

    pub async fn list(&mut self, path: &str) -> Result<Vec<Entry>, String> {
        let rd = self
            .sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("列出目录失败: {e}"))?;
        let mut out = Vec::new();
        for entry in rd {
            let name = entry.file_name();
            if name == "." || name == ".." {
                continue;
            }
            let md = entry.metadata();
            let file_type = md.file_type();
            out.push(Entry {
                name,
                is_dir: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
                size: md.size.unwrap_or(0),
                mtime: md.mtime.map(|t| t as i64),
            });
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        // 解析规范路径并缓存（相对路径导航后仍取绝对路径）
        if let Ok(c) = self.sftp.canonicalize(path).await {
            self.cwd = c;
        }
        Ok(out)
    }

    pub async fn mkdir(&mut self, path: &str) -> Result<(), String> {
        self.sftp
            .create_dir(path)
            .await
            .map_err(|e| format!("创建目录失败: {e}"))
    }

    pub async fn delete(&mut self, path: &str) -> Result<(), String> {
        let md = self.sftp.metadata(path).await;
        let r = match md {
            Ok(m) if m.file_type().is_dir() => self.sftp.remove_dir(path).await,
            _ => self.sftp.remove_file(path).await,
        };
        r.map_err(|e| format!("删除失败: {e}"))
    }

    pub async fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        self.sftp
            .rename(from, to)
            .await
            .map_err(|e| format!("重命名失败: {e}"))
    }

    pub async fn size(&mut self, path: &str) -> Option<u64> {
        self.sftp.metadata(path).await.ok().and_then(|m| m.size)
    }

    pub async fn download_file(
        &mut self,
        remote: &str,
        local: &Path,
        id: u64,
        total: u64,
        base: u64,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        let remote_size = self
            .sftp
            .metadata(remote)
            .await
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0);
        let offset = std::fs::metadata(local).map(|m| m.len()).unwrap_or(0);
        if total > 0 && offset >= total {
            return Ok(());
        }
        if total == 0 && remote_size > 0 && offset >= remote_size {
            return Ok(());
        }
        let mut remote_file = self
            .sftp
            .open(remote)
            .await
            .map_err(|e| format!("打开远程文件失败: {e}"))?;
        if offset > 0 {
            remote_file
                .seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| format!("远程文件定位失败: {e}"))?;
        }
        let mut local_file = tokio::fs::OpenOptions::new()
            .create(true)
            .write(offset == 0)
            .append(offset > 0)
            .open(local)
            .await
            .map_err(|e| format!("打开本地文件失败: {e}"))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut transferred = base + offset;
        loop {
            let n = remote_file
                .read(&mut buf)
                .await
                .map_err(|e| format!("读取数据失败: {e}"))?;
            if n == 0 {
                break;
            }
            local_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| format!("写入本地文件失败: {e}"))?;
            transferred += n as u64;
            let _ = event_tx.send(UiEvent::TransferProgress { id, transferred });
        }
        local_file.flush().await.map_err(|e| format!("写入失败: {e}"))?;
        Ok(())
    }

    pub async fn upload_file(
        &mut self,
        local: &Path,
        remote: &str,
        id: u64,
        base: u64,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        let local_size = std::fs::metadata(local).map(|m| m.len()).unwrap_or(0);
        let remote_size = self
            .sftp
            .metadata(remote)
            .await
            .ok()
            .and_then(|m| m.size)
            .unwrap_or(0);
        let offset = if remote_size > 0 && remote_size < local_size {
            remote_size
        } else {
            0
        };
        let flags = if offset > 0 {
            OpenFlags::WRITE | OpenFlags::APPEND | OpenFlags::CREATE
        } else {
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE
        };
        let mut remote_file = self
            .sftp
            .open_with_flags(remote, flags)
            .await
            .map_err(|e| format!("打开远程文件失败: {e}"))?;
        let mut local_file = tokio::fs::File::open(local)
            .await
            .map_err(|e| format!("打开本地文件失败: {e}"))?;
        if offset > 0 {
            local_file
                .seek(std::io::SeekFrom::Start(offset))
                .await
                .map_err(|e| format!("本地文件定位失败: {e}"))?;
        }
        let mut buf = vec![0u8; 256 * 1024];
        let mut transferred = base + offset;
        loop {
            let n = local_file
                .read(&mut buf)
                .await
                .map_err(|e| format!("读取本地文件失败: {e}"))?;
            if n == 0 {
                break;
            }
            remote_file
                .write_all(&buf[..n])
                .await
                .map_err(|e| format!("发送数据失败: {e}"))?;
            transferred += n as u64;
            let _ = event_tx.send(UiEvent::TransferProgress { id, transferred });
        }
        remote_file
            .flush()
            .await
            .map_err(|e| format!("上传收尾失败: {e}"))?;
        Ok(())
    }

    pub async fn read_chunks(
        &mut self,
        remote: &str,
        id: u64,
        base: u64,
        data_tx: tokio::sync::mpsc::Sender<crate::bus::PipeMsg>,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        let mut file = self
            .sftp
            .open(remote)
            .await
            .map_err(|e| format!("打开远程源文件失败: {e}"))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut transferred = base;
        loop {
            let n = file
                .read(&mut buf)
                .await
                .map_err(|e| format!("读取源数据失败: {e}"))?;
            if n == 0 {
                break;
            }
            if data_tx
                .send(crate::bus::PipeMsg::Data(buf[..n].to_vec()))
                .await
                .is_err()
            {
                break;
            }
            transferred += n as u64;
            let _ = event_tx.send(UiEvent::TransferProgress { id, transferred });
        }
        let _ = data_tx.send(crate::bus::PipeMsg::End).await;
        Ok(())
    }

    pub async fn write_chunks(
        &mut self,
        remote: &str,
        mut data_rx: tokio::sync::mpsc::Receiver<crate::bus::PipeMsg>,
    ) -> Result<(), String> {
        let mut file = self
            .sftp
            .open_with_flags(remote, OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE)
            .await
            .map_err(|e| format!("打开远程目标文件失败: {e}"))?;
        let mut complete = false;
        while let Some(msg) = data_rx.recv().await {
            match msg {
                crate::bus::PipeMsg::Data(b) => {
                    file.write_all(&b)
                        .await
                        .map_err(|e| format!("写入目标数据失败: {e}"))?;
                }
                crate::bus::PipeMsg::End => {
                    complete = true;
                    break;
                }
            }
        }
        if !complete {
            return Err("源端读取中断".into());
        }
        file.flush().await.map_err(|e| format!("目标写入收尾失败: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::{Direction, TransferTask};
    use std::sync::mpsc;

    fn sftp_site() -> Site {
        Site {
            id: 0,
            group_id: None,
            name: "本地SFTP".into(),
            host: "127.0.0.1".into(),
            port: 2222,
            protocol: "sftp".into(),
            username: Some("test".into()),
            password: Some("test".into()),
            encoding: "auto".into(),
            passive_mode: true,
            login_cmds: None,
            proxy_id: None,
            tls_accept_invalid: false,
        }
    }

    #[tokio::test]
    #[ignore = "需要本地 paramiko SFTP 服务器 (端口 2222)"]
    async fn sftp_connect_list_pwd() {
        let mut s = SftpBackend::connect(&sftp_site()).await.expect("SFTP 连接失败");
        let cwd = s.pwd().await.unwrap();
        assert!(!cwd.is_empty());
        let entries = s.list(".").await.expect("SFTP 列目录失败");
        assert!(entries.iter().any(|e| e.name == "hello.txt" && e.size == 6));
        assert!(entries.iter().any(|e| e.name == "中文名字.txt"));
        assert!(entries.iter().any(|e| e.name == "sub" && e.is_dir));
    }

    #[tokio::test]
    #[ignore = "需要本地 paramiko SFTP 服务器 (端口 2222)"]
    async fn sftp_transfer_roundtrip() {
        let (event_tx, _rx) = mpsc::channel::<UiEvent>();
        let mut s = SftpBackend::connect(&sftp_site()).await.expect("SFTP 连接失败");
        // 下载
        let local = std::env::temp_dir().join("fxp_sftp_dl.txt");
        let _ = std::fs::remove_file(&local);
        let size = s.size("/hello.txt").await.unwrap();
        s.download_file("/hello.txt", &local, 1, size, 0, &event_tx)
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&local).unwrap(), "hello\n");
        // 上传（中文文件名）
        let src = std::env::temp_dir().join("fxp_sftp_ul.txt");
        std::fs::write(&src, "SFTP 上传内容").unwrap();
        s.upload_file(&src, "/上传测试.txt", 2, 0, &event_tx)
            .await
            .unwrap();
        let back = std::env::temp_dir().join("fxp_sftp_back.txt");
        let _ = std::fs::remove_file(&back);
        let size = s.size("/上传测试.txt").await.unwrap();
        s.download_file("/上传测试.txt", &back, 3, size, 0, &event_tx)
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&back).unwrap(), "SFTP 上传内容");
        let _ = s.delete("/上传测试.txt").await;
    }

    #[tokio::test]
    #[ignore = "需要本地 paramiko SFTP 服务器 (端口 2222)"]
    async fn sftp_mkdir_rename_delete() {
        let mut s = SftpBackend::connect(&sftp_site()).await.expect("SFTP 连接失败");
        s.mkdir("/新建目录").await.unwrap();
        s.rename("/新建目录", "/改名目录").await.unwrap();
        let entries = s.list("/").await.unwrap();
        assert!(entries.iter().any(|e| e.name == "改名目录" && e.is_dir));
        s.delete("/改名目录").await.unwrap();
        let entries = s.list("/").await.unwrap();
        assert!(entries.iter().all(|e| e.name != "改名目录"));
    }
}

#[cfg(test)]
mod remote_tmp_tests {
    use super::*;
    use crate::bus::{remote_join, Direction};
    use crate::session::RemoteSession;
    use std::sync::mpsc;

    /// 读取用户配置的站点（真实 DB），对远端 /tmp 做只限于测试目录的操作
    fn user_site() -> crate::store::Site {
        let repo = crate::store::SiteRepo::open().expect("打开数据库");
        let sites = repo.list_sites().expect("读取站点");
        sites
            .into_iter()
            .find(|s| s.id > 0 && s.host == "172.22.20.65")
            .expect("未找到配置的站点")
    }

    async fn connect() -> RemoteSession {
        RemoteSession::open(&user_site(), None)
            .await
            .expect("连接失败")
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "对用户配置的真实站点执行 /tmp 测试"]
    async fn remote_tmp_full_test() {
        let mut s = connect().await;
        let base = format!("/tmp/rust-fx-test-{}", chrono::Utc::now().timestamp());
        println!("测试目录: {base}");
        let (tx, _rx) = mpsc::channel::<UiEvent>();

        // 1. 建目录（含中文）
        s.mkdir(&base).await.unwrap();
        s.mkdir(&remote_join(&base, "子目录")).await.unwrap();

        // 2. 列目录
        let entries = s.list(&base).await.unwrap();
        assert!(entries.iter().any(|e| e.name == "子目录" && e.is_dir));

        // 3. 上传（含中文名+中文内容）
        let src = std::env::temp_dir().join("fxp_remote_test.txt");
        std::fs::write(&src, "远端测试内容 abc123").unwrap();
        s.upload_file(&src, &remote_join(&base, "中文文件.txt"), 1, 0, &tx)
            .await
            .unwrap();

        // 4. 下载回来比对
        let back = std::env::temp_dir().join("fxp_remote_test_back.txt");
        let _ = std::fs::remove_file(&back);
        let size = s.size(&remote_join(&base, "中文文件.txt")).await.unwrap();
        s.download_file(&remote_join(&base, "中文文件.txt"), &back, 2, size, 0, &tx)
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&back).unwrap(), "远端测试内容 abc123");

        // 5. 重命名
        s.rename(&remote_join(&base, "中文文件.txt"), &remote_join(&base, "改名.txt"))
            .await
            .unwrap();
        let entries = s.list(&base).await.unwrap();
        assert!(entries.iter().any(|e| e.name == "改名.txt"));
        assert!(!entries.iter().any(|e| e.name == "中文文件.txt"));

        // 6. 递归下载目录
        let dl_dir = std::env::temp_dir().join("fxp_remote_test_dir");
        let _ = std::fs::remove_dir_all(&dl_dir);
        let task = crate::bus::TransferTask {
            id: 3,
            direction: Direction::Download,
            remote_path: base.clone(),
            local_path: dl_dir.clone(),
            is_dir: true,
        };
        // 直接调用会话级枚举（走 exec_task 需要模块路径）——此处手工走一遍
        let entries = s.list(&base).await.unwrap();
        std::fs::create_dir_all(&dl_dir).unwrap();
        for e in &entries {
            if e.is_dir {
                std::fs::create_dir_all(dl_dir.join(&e.name)).unwrap();
            } else {
                let back2 = dl_dir.join(&e.name);
                let size = s.size(&remote_join(&base, &e.name)).await.unwrap_or(0);
                s.download_file(&remote_join(&base, &e.name), &back2, 4, size, 0, &tx)
                    .await
                    .unwrap();
            }
        }
        assert_eq!(
            std::fs::read_to_string(dl_dir.join("改名.txt")).unwrap(),
            "远端测试内容 abc123"
        );

        // 7. 清理远端测试目录
        for e in &entries {
            let p = remote_join(&base, &e.name);
            if e.is_dir {
                let inner = s.list(&p).await.unwrap();
                for ie in &inner {
                    let _ = s.delete(&remote_join(&p, &ie.name)).await;
                }
                let _ = s.delete(&p).await;
            } else {
                s.delete(&p).await.unwrap();
            }
        }
        s.delete(&base).await.unwrap();
        let after = s.list("/tmp").await.unwrap();
        assert!(after.iter().all(|e| e.name != base.trim_start_matches("/")));
        let _ = std::fs::remove_dir_all(&dl_dir);
        let _ = std::fs::remove_file(&src);
        let _ = std::fs::remove_file(&back);
        println!("远端 /tmp 测试全部通过，测试目录已清理");
    }
}
