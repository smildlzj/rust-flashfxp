use std::path::{Path, PathBuf};
use std::sync::mpsc::Sender;

use async_std::io::{ReadExt, WriteExt};
use suppaftp::{AsyncFtpStream, Mode, Status};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};

use crate::bus::{remote_join, Entry, TransferTask, UiCmd, UiEvent};
use crate::session::list_parse::parse_dir_listing;
use crate::session::make_decoder;
use crate::session::proxy::dial_via_proxy;
use crate::session::tls::make_connector;
use crate::session::RemoteSession;
use crate::store::{Proxy, Site};

/// 明文 / TLS 控制连接统一封装（两种变体的流类型不同，用枚举 + 宏在每个变体内实例化逻辑）
pub enum FtpConn {
    Plain(AsyncFtpStream),
    Tls(suppaftp::AsyncRustlsFtpStream),
}

macro_rules! arm2 {
    ($self:ident, $f:ident => $body:block) => {
        match &mut *$self {
            Self::Plain($f) => $body,
            Self::Tls($f) => $body,
        }
    };
}

macro_rules! fwd {
    ($self:ident . $m:ident($($a:expr),*)) => {
        arm2!($self, f => { f.$m($($a),*).await })
    };
}

/// 会话：连接 + 解码器 + MLSD 支持缓存
pub struct FtpSession {
    conn: FtpConn,
    decoder: Box<dyn Fn(&[u8]) -> String + Send + Sync>,
    mlsd_supported: Option<bool>,
    control_host: String,
}

impl FtpConn {
    pub async fn open(site: &Site, proxy: Option<&Proxy>) -> Result<Self, String> {
        let host = site.host.as_str();
        let mut conn = match site.protocol.as_str() {
            "sftp" => return Err("SFTP 由独立后端处理".into()),
            "ftps_implicit" => {
                if proxy.is_some() {
                    return Err("隐式 FTPS 暂不支持经代理连接".into());
                }
                let connector = make_connector(site);
                let ftp: suppaftp::AsyncRustlsFtpStream =
                    suppaftp::ImplAsyncFtpStream::connect_secure_implicit(
                        (host, site.port),
                        connector,
                        &tls_domain(site),
                    )
                    .await
                    .map_err(|e| format!("连接失败: {e}"))?;
                Self::Tls(ftp)
            }
            "ftps_explicit" => {
                // 显式 TLS：先以目标 TLS 类型建立明文连接，再 AUTH TLS 升级
                let plain = dial_typed(site, proxy).await?;
                let connector = make_connector(site);
                let ftp = plain
                    .into_secure(connector, &tls_domain(site))
                    .await
                    .map_err(|e| format!("TLS 协商失败: {e}"))?;
                Self::Tls(ftp)
            }
            _ => Self::Plain(dial_plain(site, proxy).await?),
        };
        conn.login_and_setup(site).await?;
        Ok(conn)
    }

    async fn login_and_setup(&mut self, site: &Site) -> Result<(), String> {
        arm2!(self, f => {
            f.login(
                site.username.as_deref().unwrap_or("anonymous"),
                site.password.as_deref().unwrap_or(""),
            )
            .await
            .map_err(|e| format!("登录失败: {e}"))?;
            f.transfer_type(suppaftp::types::FileType::Binary)
                .await
                .map_err(|e| format!("设置二进制模式失败: {e}"))?;
            if !site.passive_mode {
                f.set_mode(Mode::Active);
            }
            Ok(())
        })
    }

    async fn cwd(&mut self, path: &str) -> Result<(), String> {
        fwd!(self.cwd(path)).map_err(|e| format!("切换目录失败: {e}"))
    }

    async fn pwd(&mut self) -> Result<String, String> {
        fwd!(self.pwd()).map_err(|e| format!("获取当前目录失败: {e}"))
    }

    async fn mkdir(&mut self, path: &str) -> Result<(), String> {
        fwd!(self.mkdir(path)).map_err(|e| format!("创建目录失败: {e}"))
    }

    async fn delete(&mut self, path: &str) -> Result<(), String> {
        match fwd!(self.rm(path)) {
            Ok(_) => Ok(()),
            Err(_) => fwd!(self.rmdir(path)).map_err(|e| format!("删除失败: {e}")),
        }
    }

    async fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        fwd!(self.rename(from, to)).map_err(|e| format!("重命名失败: {e}"))
    }

    async fn size(&mut self, path: &str) -> Option<u64> {
        fwd!(self.size(path)).ok().map(|s: usize| s as u64)
    }

    async fn feat_mlst(&mut self) -> bool {
        arm2!(self, f => {
            match f.feat().await {
                Ok(features) => features.contains_key("MLST"),
                Err(_) => false,
            }
        })
    }

    /// TLS 会话走 suppaftp 的行接口（内部已 UTF-8 lossy；旧式 GBK+FTPS 组合罕见，暂不处理）
    async fn string_lines(&mut self, path: Option<&str>, mlsd: bool) -> Result<Vec<String>, String> {
        let p = path.map(|s| s.to_string());
        arm2!(self, f => {
            if mlsd {
                f.mlsd(p.as_deref()).await.map_err(|e| format!("列出目录失败: {e}"))
            } else {
                match f.list(p.as_deref()).await {
                    Ok(lines) => Ok(lines),
                    Err(e) => f
                        .nlst(p.as_deref())
                        .await
                        .map_err(|_| format!("列出目录失败: {e}")),
                }
            }
        })
    }

    /// 原始字节目录列表（明文连接）：PASV → 自建数据连接 → LIST/MLSD → 读原始字节。
    /// 保证 GBK 等非 UTF-8 文件名不丢失字节。
    async fn raw_lines(&mut self, control_host: &str, path: Option<&str>, mlsd: bool) -> Result<Vec<u8>, String> {
        let resp = arm2!(self, f => {
            f.custom_command("PASV", &[Status::PassiveMode])
                .await
                .map_err(|e| format!("进入被动模式失败: {e}"))
        })?;
        let body = String::from_utf8_lossy(&resp.body).to_string();
        let (ip, port) = parse_pasv(&body).ok_or_else(|| format!("解析被动模式地址失败: {body}"))?;
        let connect_ip = pick_data_ip(&ip, control_host);
        let mut data = async_std::net::TcpStream::connect((connect_ip.as_str(), port))
            .await
            .map_err(|e| format!("建立数据连接失败: {e}"))?;
        let cmd = match (mlsd, path) {
            (true, Some(p)) => format!("MLSD {p}"),
            (true, None) => "MLSD".to_string(),
            (false, Some(p)) => format!("LIST {p}"),
            (false, None) => "LIST".to_string(),
        };
        arm2!(self, f => {
            f.custom_command(cmd.as_str(), &[Status::AboutToSend, Status::AlreadyOpen])
                .await
                .map_err(|e| format!("发送列表命令失败: {e}"))
        })?;
        let mut buf = Vec::new();
        data.read_to_end(&mut buf)
            .await
            .map_err(|e| format!("读取目录数据失败: {e}"))?;
        drop(data);
        arm2!(self, f => {
            f.read_response_in(&[
                Status::ClosingDataConnection,
                Status::RequestedFileActionOk,
                Status::Closing,
            ])
            .await
            .map_err(|e| format!("列表命令收尾失败: {e}"))
        })?;
        Ok(buf)
    }

    /// 下载单个文件到本地（断点续传 REST）。宏内实例化避免跨 TLS/明文流类型擦除。
    async fn download_file(
        &mut self,
        remote: &str,
        local: &Path,
        id: u64,
        total: u64,
        base: u64,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        arm2!(self, f => {
            let offset = std::fs::metadata(local).map(|m| m.len()).unwrap_or(0);
            if total > 0 && offset >= total {
                return Ok(());
            }
            if offset > 0 {
                f.resume_transfer(offset as usize)
                    .await
                    .map_err(|e| format!("续传失败: {e}"))?;
            }
            let mut stream = f
                .retr_as_stream(remote)
                .await
                .map_err(|e| format!("下载失败: {e}"))?;
            let mut file = tokio::fs::OpenOptions::new()
                .create(true)
                .write(offset == 0)
                .append(offset > 0)
                .open(local)
                .await
                .map_err(|e| format!("打开本地文件失败: {e}"))?;
            let mut buf = vec![0u8; 256 * 1024];
            let mut transferred = base + offset;
            loop {
                let n = stream
                    .read(&mut buf)
                    .await
                    .map_err(|e| format!("读取数据失败: {e}"))?;
                if n == 0 {
                    break;
                }
                file.write_all(&buf[..n])
                    .await
                    .map_err(|e| format!("写入本地文件失败: {e}"))?;
                transferred += n as u64;
                let _ = event_tx.send(UiEvent::TransferProgress { id, transferred });
            }
            file.flush().await.map_err(|e| format!("写入失败: {e}"))?;
            drop(file);
            f.finalize_retr_stream(stream)
                .await
                .map_err(|e| format!("下载数据流收尾失败: {e}"))?;
            Ok(())
        })
    }

    /// 上传单个文件（远端已存在部分时 APPE 续传）
    async fn upload_file(
        &mut self,
        local: &Path,
        remote: &str,
        id: u64,
        base: u64,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        arm2!(self, f => {
            let size = std::fs::metadata(local).map(|m| m.len()).unwrap_or(0);
            let remote_size = f.size(remote).await.unwrap_or(0) as u64;
            let offset = if remote_size > 0 && remote_size < size { remote_size } else { 0 };
            let mut stream = if offset > 0 {
                f.append_with_stream(remote)
                    .await
                    .map_err(|e| format!("续传打开远程文件失败: {e}"))?
            } else {
                f.put_with_stream(remote)
                    .await
                    .map_err(|e| format!("上传失败: {e}"))?
            };
            let mut file = tokio::fs::File::open(local)
                .await
                .map_err(|e| format!("打开本地文件失败: {e}"))?;
            if offset > 0 {
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| format!("本地文件定位失败: {e}"))?;
            }
            let mut buf = vec![0u8; 256 * 1024];
            let mut transferred = base + offset;
            loop {
                let n = file.read(&mut buf).await.map_err(|e| format!("读取本地文件失败: {e}"))?;
                if n == 0 {
                    break;
                }
                stream.write_all(&buf[..n])
                    .await
                    .map_err(|e| format!("发送数据失败: {e}"))?;
                transferred += n as u64;
                let _ = event_tx.send(UiEvent::TransferProgress { id, transferred });
            }
            f.finalize_put_stream(stream)
                .await
                .map_err(|e| format!("上传数据流收尾失败: {e}"))?;
            Ok(())
        })
    }
}

/// suppaftp 的 rustls 连接器只接受 DNS 名；IP 直连站点用占位名（配合"忽略证书错误"）
fn tls_domain(site: &Site) -> String {
    let host = site.host.as_str();
    if parse_ipv4(host).is_some() {
        "localhost".to_string()
    } else {
        host.to_string()
    }
}

async fn dial_plain(site: &Site, proxy: Option<&Proxy>) -> Result<AsyncFtpStream, String> {
    match proxy {
        Some(p) => {
            let stream = dial_via_proxy(p, &site.host, site.port).await?;
            AsyncFtpStream::connect_with_stream(stream)
                .await
                .map_err(|e| format!("经代理连接失败: {e}"))
        }
        None => AsyncFtpStream::connect((site.host.as_str(), site.port))
            .await
            .map_err(|e| format!("连接失败: {e}")),
    }
}

/// 以 TLS 目标类型建明文连接（供 AUTH TLS 升级）
async fn dial_typed(
    site: &Site,
    proxy: Option<&Proxy>,
) -> Result<suppaftp::AsyncRustlsFtpStream, String> {
    match proxy {
        Some(p) => {
            let stream = dial_via_proxy(p, &site.host, site.port).await?;
            suppaftp::ImplAsyncFtpStream::connect_with_stream(stream)
                .await
                .map_err(|e| format!("经代理连接失败: {e}"))
        }
        None => suppaftp::ImplAsyncFtpStream::connect((site.host.as_str(), site.port))
            .await
            .map_err(|e| format!("连接失败: {e}")),
    }
}

impl FtpConn {
    /// 流水线读取：从远程文件读数据块发送到通道（站点互传用；成功时发送 End）
    async fn read_chunks(
        &mut self,
        remote: &str,
        id: u64,
        base: u64,
        data_tx: tokio::sync::mpsc::Sender<crate::bus::PipeMsg>,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        arm2!(self, f => {
            let mut stream = f
                .retr_as_stream(remote)
                .await
                .map_err(|e| format!("打开远程源文件失败: {e}"))?;
            let mut buf = vec![0u8; 256 * 1024];
            let mut transferred = base;
            loop {
                let n = stream
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
                    break; // 目标端已放弃
                }
                transferred += n as u64;
                let _ = event_tx.send(UiEvent::TransferProgress { id, transferred });
            }
            f.finalize_retr_stream(stream)
                .await
                .map_err(|e| format!("源数据流收尾失败: {e}"))?;
            let _ = data_tx.send(crate::bus::PipeMsg::End).await;
            Ok(())
        })
    }

    /// 流水线写入：消费数据块写入远程文件（收到 End 表示成功）
    async fn write_chunks(
        &mut self,
        remote: &str,
        mut data_rx: tokio::sync::mpsc::Receiver<crate::bus::PipeMsg>,
    ) -> Result<(), String> {
        arm2!(self, f => {
            let mut stream = f
                .put_with_stream(remote)
                .await
                .map_err(|e| format!("打开远程目标文件失败: {e}"))?;
            let mut complete = false;
            while let Some(msg) = data_rx.recv().await {
                match msg {
                    crate::bus::PipeMsg::Data(b) => {
                        stream
                            .write_all(&b)
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
            f.finalize_put_stream(stream)
                .await
                .map_err(|e| format!("目标数据流收尾失败: {e}"))?;
            Ok(())
        })
    }
}

impl FtpSession {
    pub async fn connect(site: &Site, proxy: Option<&Proxy>) -> Result<Self, String> {
        let conn = FtpConn::open(site, proxy).await?;
        Ok(Self {
            conn,
            decoder: make_decoder(&site.encoding),
            mlsd_supported: None,
            control_host: site.host.clone(),
        })
    }

    pub async fn pwd(&mut self) -> Result<String, String> {
        self.conn.pwd().await
    }

    pub async fn mkdir(&mut self, path: &str) -> Result<(), String> {
        self.conn.mkdir(path).await
    }

    pub async fn delete(&mut self, path: &str) -> Result<(), String> {
        self.conn.delete(path).await
    }

    pub async fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        self.conn.rename(from, to).await
    }

    pub async fn size(&mut self, path: &str) -> Option<u64> {
        self.conn.size(path).await
    }

    pub async fn list(&mut self, path: &str) -> Result<Vec<Entry>, String> {
        let mlsd = match self.mlsd_supported {
            Some(b) => b,
            None => {
                let b = self.conn.feat_mlst().await;
                self.mlsd_supported = Some(b);
                b
            }
        };
        // 明文：先切目录再列当前目录（避免路径中的空格解析差异），原始字节通道保 GBK 文件名
        let raw: Vec<u8> = match &self.conn {
            FtpConn::Plain(_) => {
                self.conn.cwd(path).await?;
                self.conn.raw_lines(&self.control_host.clone(), None, mlsd).await?
            }
            FtpConn::Tls(_) => {
                let lines = self.conn.string_lines(Some(path), mlsd).await?;
                lines.join("\n").into_bytes()
            }
        };
        Ok(parse_dir_listing(&raw, self.decoder.as_ref()))
    }

    pub async fn download_file(&mut self, remote: &str, local: &Path, id: u64, total: u64, base: u64, event_tx: &Sender<UiEvent>) -> Result<(), String> {
        self.conn.download_file(remote, local, id, total, base, event_tx).await
    }

    pub async fn upload_file(&mut self, local: &Path, remote: &str, id: u64, base: u64, event_tx: &Sender<UiEvent>) -> Result<(), String> {
        self.conn.upload_file(local, remote, id, base, event_tx).await
    }

    pub async fn read_chunks(
        &mut self,
        remote: &str,
        id: u64,
        base: u64,
        data_tx: tokio::sync::mpsc::Sender<crate::bus::PipeMsg>,
        event_tx: &Sender<UiEvent>,
    ) -> Result<(), String> {
        self.conn.read_chunks(remote, id, base, data_tx, event_tx).await
    }

    pub async fn write_chunks(
        &mut self,
        remote: &str,
        data_rx: tokio::sync::mpsc::Receiver<crate::bus::PipeMsg>,
    ) -> Result<(), String> {
        self.conn.write_chunks(remote, data_rx).await
    }
}

fn parse_pasv(body: &str) -> Option<(String, u16)> {
    let start = body.find('(')?;
    let end = body[start..].find(')')? + start;
    let nums: Vec<u16> = body[start + 1..end]
        .split(',')
        .map(|n| n.trim().parse().ok())
        .collect::<Option<Vec<_>>>()?;
    if nums.len() != 6 {
        return None;
    }
    let ip = format!("{}.{}.{}.{}", nums[0], nums[1], nums[2], nums[3]);
    let port = nums[4] as u16 * 256 + nums[5] as u16;
    Some((ip, port))
}

fn pick_data_ip(pasv_ip: &str, control_host: &str) -> String {
    // 0.0.0.0 或（私有地址且控制主机是不同的 IP 字面量）→ 用控制主机（NAT 场景）
    if pasv_ip == "0.0.0.0" {
        return control_host.to_string();
    }
    if is_private_ip(pasv_ip) && parse_ipv4(control_host).is_some() && pasv_ip != control_host {
        return control_host.to_string();
    }
    pasv_ip.to_string()
}

fn parse_ipv4(s: &str) -> Option<[u8; 4]> {
    let parts: Vec<u8> = s
        .split('.')
        .map(|p| p.parse().ok())
        .collect::<Option<Vec<_>>>()?;
    if parts.len() != 4 {
        return None;
    }
    Some([parts[0], parts[1], parts[2], parts[3]])
}

fn is_private_ip(ip: &str) -> bool {
    let Some(b) = parse_ipv4(ip) else { return false };
    b[0] == 10 || (b[0] == 172 && (16..=31).contains(&b[1])) || (b[0] == 192 && b[1] == 168) || b[0] == 127
}

// ---------------------------------------------------------------------------
// 后台调度与队列
// ---------------------------------------------------------------------------

pub async fn run_backend(mut cmd_rx: UnboundedReceiver<UiCmd>, event_tx: Sender<UiEvent>) {
    let mut session_tx: Option<UnboundedSender<SessionCmd>> = None;
    let mut transfer_tx: Option<UnboundedSender<TransferTask>> = None;

    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            UiCmd::Connect { site, proxy } => {
                let (stx, srx) = unbounded_channel();
                tokio::spawn(run_session(srx, event_tx.clone(), site.clone(), proxy.clone()));
                let (ttx, trx) = unbounded_channel();
                tokio::spawn(run_transfers(trx, event_tx.clone(), site, proxy));
                session_tx = Some(stx);
                transfer_tx = Some(ttx);
            }
            UiCmd::Disconnect => {
                session_tx = None;
                transfer_tx = None;
                let _ = event_tx.send(UiEvent::Disconnected);
            }
            UiCmd::LocalList { path } => {
                let tx = event_tx.clone();
                tokio::task::spawn_blocking(move || {
                    let entries = list_local(&path);
                    let _ = tx.send(UiEvent::LocalList { path, entries });
                });
            }
            UiCmd::LocalMkdir { path } => {
                let tx = event_tx.clone();
                tokio::task::spawn_blocking(move || {
                    if let Err(e) = std::fs::create_dir_all(&path) {
                        let _ = tx.send(UiEvent::Notify {
                            level: crate::bus::Level::Error,
                            text: format!("创建目录失败: {e}"),
                        });
                    }
                });
            }
            UiCmd::LocalDelete { paths } => {
                let tx = event_tx.clone();
                tokio::task::spawn_blocking(move || {
                    for p in paths {
                        let r = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
                        if let Err(e) = r {
                            let _ = tx.send(UiEvent::Notify {
                                level: crate::bus::Level::Error,
                                text: format!("删除失败: {e}"),
                            });
                        }
                    }
                });
            }
            UiCmd::LocalRename { from, to } => {
                let tx = event_tx.clone();
                tokio::task::spawn_blocking(move || {
                    if let Err(e) = std::fs::rename(&from, &to) {
                        let _ = tx.send(UiEvent::Notify {
                            level: crate::bus::Level::Error,
                            text: format!("重命名失败: {e}"),
                        });
                    }
                });
            }
            UiCmd::RemoteList { path } => {
                if let Some(stx) = &session_tx {
                    let _ = stx.send(SessionCmd::List { path });
                }
            }
            UiCmd::RemoteMkdir { path } => {
                if let Some(stx) = &session_tx {
                    let _ = stx.send(SessionCmd::Mkdir { path });
                }
            }
            UiCmd::RemoteDelete { paths } => {
                if let Some(stx) = &session_tx {
                    let _ = stx.send(SessionCmd::Delete { paths });
                }
            }
            UiCmd::RemoteRename { from, to } => {
                if let Some(stx) = &session_tx {
                    let _ = stx.send(SessionCmd::Rename { from, to });
                }
            }
            UiCmd::Enqueue { task } => {
                if let Some(ttx) = &transfer_tx {
                    let _ = ttx.send(task);
                } else {
                    let _ = event_tx.send(UiEvent::Notify {
                        level: crate::bus::Level::Warn,
                        text: "未连接站点，无法传输".into(),
                    });
                }
            }
            UiCmd::RelayEnqueue { task } => {
                let tx = event_tx.clone();
                tokio::spawn(crate::session::relay::run_relay(task, tx));
            }
        }
    }
}

#[derive(Debug)]
enum SessionCmd {
    List { path: String },
    Mkdir { path: String },
    Delete { paths: Vec<String> },
    Rename { from: String, to: String },
}

async fn run_session(
    mut cmd_rx: UnboundedReceiver<SessionCmd>,
    event_tx: Sender<UiEvent>,
    site: Site,
    proxy: Option<Proxy>,
) {
    let mut session = match RemoteSession::open(&site, proxy.as_ref()).await {
        Ok(s) => s,
        Err(e) => {
            let _ = event_tx.send(UiEvent::Notify {
                level: crate::bus::Level::Error,
                text: e,
            });
            return;
        }
    };
    let _ = event_tx.send(UiEvent::Connected);

    if let Ok(cwd) = session.pwd().await {
        if let Ok(entries) = session.list(&cwd).await {
            let _ = event_tx.send(UiEvent::RemoteList { path: cwd, entries });
        }
    }

    while let Some(cmd) = cmd_rx.recv().await {
        match cmd {
            SessionCmd::List { path } => match session.list(&path).await {
                Ok(entries) => {
                    let _ = event_tx.send(UiEvent::RemoteList { path, entries });
                }
                Err(e) => notify(&event_tx, e),
            },
            SessionCmd::Mkdir { path } => {
                if let Err(e) = session.mkdir(&path).await {
                    notify(&event_tx, e);
                }
            }
            SessionCmd::Delete { paths } => {
                for p in paths {
                    if let Err(e) = session.delete(&p).await {
                        notify(&event_tx, e);
                    }
                }
            }
            SessionCmd::Rename { from, to } => {
                if let Err(e) = session.rename(&from, &to).await {
                    notify(&event_tx, e);
                }
            }
        }
    }
}

fn notify(event_tx: &Sender<UiEvent>, text: String) {
    let _ = event_tx.send(UiEvent::Notify {
        level: crate::bus::Level::Error,
        text,
    });
}

/// 传输 worker：独立连接，顺序执行队列任务；目录任务递归展开
async fn run_transfers(
    mut task_rx: UnboundedReceiver<TransferTask>,
    event_tx: Sender<UiEvent>,
    site: Site,
    proxy: Option<Proxy>,
) {
    let mut session: Option<RemoteSession> = None;
    while let Some(task) = task_rx.recv().await {
        if session.is_none() {
            match RemoteSession::open(&site, proxy.as_ref()).await {
                Ok(s) => session = Some(s),
                Err(e) => {
                    notify(&event_tx, e);
                    let _ = event_tx.send(UiEvent::TransferFinished {
                        id: task.id,
                        ok: false,
                        error: Some("无法建立传输连接".into()),
                    });
                    continue;
                }
            }
        }
        let s = session.as_mut().unwrap();
        let result = exec_task(s, &task, &event_tx).await;
        if result.is_err() {
            session = None; // 连接可能已坏，下个任务重连
        }
        let _ = event_tx.send(UiEvent::TransferFinished {
            id: task.id,
            ok: result.is_ok(),
            error: result.err(),
        });
    }
}

/// 执行单个传输任务（文件或目录递归）
async fn exec_task(session: &mut RemoteSession, task: &TransferTask, event_tx: &Sender<UiEvent>) -> Result<(), String> {
    if !task.is_dir {
        let size = match task.direction {
            crate::bus::Direction::Download => session.size(&task.remote_path).await.unwrap_or(0),
            crate::bus::Direction::Upload => std::fs::metadata(&task.local_path).map(|m| m.len()).unwrap_or(0),
            crate::bus::Direction::Relay => 0,
        };
        let _ = event_tx.send(UiEvent::TransferStarted { id: task.id, size });
        match task.direction {
            crate::bus::Direction::Download => session
                .download_file(&task.remote_path, &task.local_path, task.id, size, 0, event_tx)
                .await,
            crate::bus::Direction::Upload => session
                .upload_file(&task.local_path, &task.remote_path, task.id, 0, event_tx)
                .await,
            crate::bus::Direction::Relay => Ok(()),
        }
    } else {
        match task.direction {
            crate::bus::Direction::Download => exec_download_dir(session, task, event_tx).await,
            crate::bus::Direction::Upload => exec_upload_dir(session, task, event_tx).await,
            crate::bus::Direction::Relay => Ok(()),
        }
    }
}

async fn exec_download_dir(session: &mut RemoteSession, task: &TransferTask, event_tx: &Sender<UiEvent>) -> Result<(), String> {
    let mut dirs: Vec<(String, PathBuf)> = Vec::new();
    let mut files: Vec<(String, PathBuf, u64)> = Vec::new();
    let mut queue: Vec<(String, PathBuf)> = vec![(task.remote_path.clone(), task.local_path.clone())];
    while let Some((rdir, ldir)) = queue.pop() {
        let entries = session.list(&rdir).await?;
        for e in &entries {
            let rpath = remote_join(&rdir, &e.name);
            let lpath = ldir.join(&e.name);
            if e.is_dir {
                dirs.push((rpath.clone(), lpath.clone()));
                queue.push((rpath, lpath));
            } else if e.is_symlink {
                continue; // 跳过远程符号链接，避免死循环
            } else {
                files.push((rpath, lpath, e.size));
            }
        }
    }
    let total: u64 = files.iter().map(|(_, _, s)| *s).sum();
    let _ = event_tx.send(UiEvent::TransferStarted { id: task.id, size: total });
    std::fs::create_dir_all(&task.local_path)
        .map_err(|e| format!("创建本地目录失败: {e}"))?;
    for (_, ldir) in &dirs {
        std::fs::create_dir_all(ldir).map_err(|e| format!("创建本地目录失败: {e}"))?;
    }
    let mut base: u64 = 0;
    for (rpath, lpath, size) in &files {
        session
            .download_file(rpath, lpath, task.id, *size, base, event_tx)
            .await?;
        base += size;
    }
    Ok(())
}

async fn exec_upload_dir(session: &mut RemoteSession, task: &TransferTask, event_tx: &Sender<UiEvent>) -> Result<(), String> {
    let mut dirs: Vec<(PathBuf, String)> = Vec::new();
    let mut files: Vec<(PathBuf, String, u64)> = Vec::new();
    walk_local(&task.local_path, &task.remote_path, &mut dirs, &mut files)?;
    let total: u64 = files.iter().map(|(_, _, s)| *s).sum();
    let _ = event_tx.send(UiEvent::TransferStarted { id: task.id, size: total });
    let _ = session.mkdir(&task.remote_path).await; // 已存在时忽略错误
    for (_, rdir) in &dirs {
        let _ = session.mkdir(rdir).await; // 已存在时忽略错误
    }
    let mut base: u64 = 0;
    for (lpath, rpath, size) in &files {
        session
            .upload_file(lpath, rpath, task.id, base, event_tx)
            .await?;
        base += size;
    }
    Ok(())
}

fn walk_local(
    ldir: &Path,
    rdir: &str,
    dirs: &mut Vec<(PathBuf, String)>,
    files: &mut Vec<(PathBuf, String, u64)>,
) -> Result<(), String> {
    let rd = std::fs::read_dir(ldir).map_err(|e| format!("读取本地目录失败: {e}"))?;
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let md = entry.metadata().ok();
        let is_dir = md.as_ref().map(|m| m.is_dir()).unwrap_or(false);
        let size = md.as_ref().map(|m| m.len()).unwrap_or(0);
        let lpath = ldir.join(&name);
        let rpath = remote_join(rdir, &name);
        if is_dir {
            dirs.push((lpath.clone(), rpath.clone()));
            walk_local(&lpath, &rpath, dirs, files)?;
        } else {
            files.push((lpath, rpath, size));
        }
    }
    Ok(())
}

pub fn list_local(path: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(path) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let md = entry.metadata().ok();
            let is_dir = md.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = md.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = md
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64);
            out.push(Entry {
                name,
                is_dir,
                size,
                mtime,
                is_symlink: false,
                perms: None,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bus::{Direction, TransferTask};
    use std::sync::mpsc;

    fn test_site() -> Site {
        Site {
            id: 0,
            group_id: None,
            name: "本地测试".into(),
            host: "127.0.0.1".into(),
            port: 2121,
            protocol: "ftp".into(),
            username: Some("test".into()),
            password: Some("test".into()),
            encoding: "auto".into(),
            passive_mode: true,
            login_cmds: None,
            proxy_id: None,
            tls_accept_invalid: false,
        }
    }

    async fn connect_test() -> FtpSession {
        FtpSession::connect(&test_site(), None).await.expect("连接失败")
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn connect_list_pwd() {
        let mut s = connect_test().await;
        let cwd = s.pwd().await.unwrap();
        assert_eq!(cwd, "/");
        let entries = s.list(&cwd).await.unwrap();
        assert!(entries.iter().any(|e| e.name == "hello.txt" && e.size == 6));
        assert!(entries.iter().any(|e| e.name == "中文名字.txt" && !e.is_dir));
        assert!(entries.iter().any(|e| e.name == "sub" && e.is_dir));
        assert!(entries.iter().any(|e| e.name == "big.bin" && e.size == 512 * 1024));
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn mkdir_rename_delete_remote() {
        let mut s = connect_test().await;
        s.mkdir("/测试新建").await.unwrap();
        s.rename("/测试新建", "/测试改名").await.unwrap();
        let entries = s.list("/").await.unwrap();
        assert!(entries.iter().any(|e| e.name == "测试改名" && e.is_dir));
        s.delete("/测试改名").await.unwrap();
        let entries = s.list("/").await.unwrap();
        assert!(entries.iter().all(|e| e.name != "测试改名"));
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn download_upload_roundtrip() {
        let (event_tx, event_rx) = mpsc::channel::<UiEvent>();
        let mut s = connect_test().await;
        // 下载
        let local = std::env::temp_dir().join("fxp_dl_test.txt");
        let _ = std::fs::remove_file(&local);
        let task = TransferTask {
            id: 1,
            direction: Direction::Download,
            remote_path: "/hello.txt".into(),
            local_path: local.clone(),
            is_dir: false,
        };
        let size = s.size(&task.remote_path).await.unwrap();
        s.download_file(&task.remote_path, &task.local_path, 1, size, 0, &event_tx)
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&local).unwrap(), "hello\n");
        // 上传
        let src = std::env::temp_dir().join("fxp_ul_test.txt");
        std::fs::write(&src, "上传内容 ABC").unwrap();
        let task = TransferTask {
            id: 2,
            direction: Direction::Upload,
            remote_path: "/uploaded.txt".into(),
            local_path: src.clone(),
            is_dir: false,
        };
        s.upload_file(&task.local_path, &task.remote_path, 2, 0, &event_tx)
            .await
            .unwrap();
        // 下载回来比对
        let back = std::env::temp_dir().join("fxp_back_test.txt");
        let _ = std::fs::remove_file(&back);
        s.download_file("/uploaded.txt", &back, 3, 0, 0, &event_tx).await.unwrap();
        assert_eq!(std::fs::read_to_string(&back).unwrap(), "上传内容 ABC");
        let _ = s.delete("/uploaded.txt").await;
        drop(event_rx);
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn download_resume() {
        let (event_tx, _rx) = mpsc::channel::<UiEvent>();
        let mut s = connect_test().await;
        let local = std::env::temp_dir().join("fxp_resume_test.bin");
        let _ = std::fs::remove_file(&local);
        // 先完整下载
        let size = s.size("/big.bin").await.unwrap();
        s.download_file("/big.bin", &local, 9, size, 0, &event_tx).await.unwrap();
        assert_eq!(std::fs::metadata(&local).unwrap().len(), 512 * 1024);
        // 截断到 100KB 再"续传"
        let buf = std::fs::read(&local).unwrap();
        std::fs::write(&local, &buf[..100 * 1024]).unwrap();
        s.download_file("/big.bin", &local, 9, size, 0, &event_tx).await.unwrap();
        assert_eq!(std::fs::metadata(&local).unwrap().len(), 512 * 1024);
        let full = std::fs::read(&local).unwrap();
        assert_eq!(&full[..100 * 1024], &buf[..100 * 1024]);
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn recursive_dir_download() {
        let (event_tx, _rx) = mpsc::channel::<UiEvent>();
        let mut s = connect_test().await;
        let local_root = std::env::temp_dir().join("fxp_dir_test");
        let _ = std::fs::remove_dir_all(&local_root);
        let task = TransferTask {
            id: 20,
            direction: Direction::Download,
            remote_path: "/sub".into(),
            local_path: local_root.clone(),
            is_dir: true,
        };
        let mut rs = RemoteSession::Ftp(s);
        exec_task(&mut rs, &task, &event_tx).await.unwrap();
        let s = match &mut rs { RemoteSession::Ftp(s) => s, _ => unreachable!() };
        let _ = s;
        assert_eq!(
            std::fs::read_to_string(local_root.join("nested.txt")).unwrap(),
            "nested\n"
        );
        let _ = std::fs::remove_dir_all(&local_root);
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn recursive_dir_upload() {
        let (event_tx, _rx) = mpsc::channel::<UiEvent>();
        let mut s = connect_test().await;
        let src_root = std::env::temp_dir().join("fxp_up_dir");
        let _ = std::fs::remove_dir_all(&src_root);
        std::fs::create_dir_all(src_root.join("内层")).unwrap();
        std::fs::write(src_root.join("a.txt"), "A").unwrap();
        std::fs::write(src_root.join("内层").join("b.txt"), "B中文").unwrap();
        let task = TransferTask {
            id: 21,
            direction: Direction::Upload,
            remote_path: "/updir".into(),
            local_path: src_root.clone(),
            is_dir: true,
        };
        let mut rs = RemoteSession::Ftp(s);
        exec_task(&mut rs, &task, &event_tx).await.unwrap();
        let s = match &mut rs { RemoteSession::Ftp(s) => s, _ => unreachable!() };
        // 验证远端结构
        let entries = s.list("/updir").await.unwrap();
        assert!(entries.iter().any(|e| e.name == "a.txt"));
        assert!(entries.iter().any(|e| e.name == "内层" && e.is_dir));
        let inner = s.list("/updir/内层").await.unwrap();
        assert!(inner.iter().any(|e| e.name == "b.txt"));
        // 清理
        let _ = s.delete("/updir/内层/b.txt").await;
        let _ = s.delete("/updir/内层").await;
        let _ = s.delete("/updir/a.txt").await;
        let _ = s.delete("/updir").await;
        let _ = std::fs::remove_dir_all(&src_root);
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib TLS 服务器 (端口 2122)"]
    async fn ftps_explicit_connect_list() {
        let mut site = test_site();
        site.host = "127.0.0.1".into();
        site.port = 2122;
        site.protocol = "ftps_explicit".into();
        site.tls_accept_invalid = true; // 自签名证书
        let mut s = FtpSession::connect(&site, None).await.expect("FTPS 连接失败");
        let cwd = s.pwd().await.unwrap();
        assert_eq!(cwd, "/");
        let entries = s.list(&cwd).await.expect("FTPS 列目录失败");
        assert!(entries.iter().any(|e| e.name == "hello.txt" && e.size == 6));
        // FTPS 传输：下载一个文件
        let (event_tx, _rx) = mpsc::channel::<UiEvent>();
        let local = std::env::temp_dir().join("fxp_ftps_test.txt");
        let _ = std::fs::remove_file(&local);
        let size = s.size("/hello.txt").await.unwrap();
        s.download_file("/hello.txt", &local, 99, size, 0, &event_tx)
            .await
            .expect("FTPS 下载失败");
        assert_eq!(std::fs::read_to_string(&local).unwrap(), "hello\n");
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器 + mini_proxy SOCKS5 (1080)"]
    async fn proxy_socks5_connect() {
        let proxy = crate::store::Proxy {
            id: 0,
            name: "测试SOCKS5".into(),
            kind: "socks5".into(),
            host: "127.0.0.1".into(),
            port: 1080,
            username: None,
            password: None,
        };
        let mut s = FtpSession::connect(&test_site(), Some(&proxy))
            .await
            .expect("经 SOCKS5 代理连接失败");
        let entries = s.list("/").await.expect("代理列表失败");
        assert!(entries.iter().any(|e| e.name == "hello.txt"));
    }

    #[tokio::test]
    #[ignore = "需要本地 pyftpdlib 服务器 + mini_proxy HTTP CONNECT (8080)"]
    async fn proxy_http_connect() {
        let proxy = crate::store::Proxy {
            id: 0,
            name: "测试HTTP".into(),
            kind: "http".into(),
            host: "127.0.0.1".into(),
            port: 8080,
            username: None,
            password: None,
        };
        let mut s = FtpSession::connect(&test_site(), Some(&proxy))
            .await
            .expect("经 HTTP 代理连接失败");
        let entries = s.list("/").await.expect("代理列表失败");
        assert!(entries.iter().any(|e| e.name == "hello.txt"));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    #[ignore = "需要本地 pyftpdlib 服务器"]
    async fn backend_full_pipeline() {
        use std::time::Duration;

        let (cmd_tx, cmd_rx) = unbounded_channel::<UiCmd>();
        let (event_tx, event_rx) = mpsc::channel::<UiEvent>();
        tokio::spawn(run_backend(cmd_rx, event_tx));
        cmd_tx
            .send(UiCmd::Connect { site: test_site(), proxy: None })
            .unwrap();

        let mut saw_connected = false;
        let mut saw_list = false;
        for _ in 0..20 {
            match event_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(UiEvent::Connected) => saw_connected = true,
                Ok(UiEvent::RemoteList { path, entries }) => {
                    assert_eq!(path, "/");
                    assert!(entries.iter().any(|e| e.name == "hello.txt"));
                    saw_list = true;
                    break;
                }
                Ok(UiEvent::Notify { text, .. }) => panic!("通知: {text}"),
                Ok(_) => {}
                Err(_) => panic!("等待连接事件超时"),
            }
        }
        assert!(saw_connected && saw_list);

        let local = std::env::temp_dir().join("fxp_pipeline_test.txt");
        let _ = std::fs::remove_file(&local);
        cmd_tx
            .send(UiCmd::Enqueue {
                task: TransferTask {
                    id: 100,
                    direction: Direction::Download,
                    remote_path: "/hello.txt".into(),
                    local_path: local.clone(),
                    is_dir: false,
                },
            })
            .unwrap();
        let mut finished_ok = false;
        for _ in 0..40 {
            match event_rx.recv_timeout(Duration::from_millis(500)) {
                Ok(UiEvent::TransferFinished { id, ok, .. }) => {
                    assert_eq!(id, 100);
                    finished_ok = ok;
                    break;
                }
                Ok(_) => {}
                Err(_) => panic!("等待传输完成超时"),
            }
        }
        assert!(finished_ok);
        assert_eq!(std::fs::read_to_string(&local).unwrap(), "hello\n");
        drop(cmd_tx);
    }
}
