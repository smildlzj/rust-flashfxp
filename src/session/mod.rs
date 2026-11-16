pub mod ftp;
pub mod list_parse;
pub mod proxy;
pub mod relay;
pub mod sftp;
pub mod tls;

use crate::store::{Proxy, Site};

pub use ftp::run_backend;
use ftp::FtpSession;
use sftp::SftpBackend;

/// 协议统一的远程会话（FTP / FTPS / SFTP）
pub enum RemoteSession {
    Ftp(FtpSession),
    Sftp(SftpBackend),
}

impl RemoteSession {
    pub async fn open(site: &Site, proxy: Option<&Proxy>) -> Result<Self, String> {
        match site.protocol.as_str() {
            "sftp" => {
                if proxy.is_some() {
                    return Err("SFTP 暂不支持经代理连接".into());
                }
                Ok(Self::Sftp(SftpBackend::connect(site).await?))
            }
            _ => Ok(Self::Ftp(FtpSession::connect(site, proxy).await?)),
        }
    }

    pub async fn pwd(&mut self) -> Result<String, String> {
        match self {
            Self::Ftp(s) => s.pwd().await,
            Self::Sftp(s) => s.pwd().await,
        }
    }

    pub async fn list(&mut self, path: &str) -> Result<Vec<crate::bus::Entry>, String> {
        match self {
            Self::Ftp(s) => s.list(path).await,
            Self::Sftp(s) => s.list(path).await,
        }
    }

    /// A listing and its server-resolved absolute path must be published together.
    pub async fn list_with_path(&mut self, path: &str) -> Result<(String, Vec<crate::bus::Entry>), String> {
        match self {
            Self::Ftp(s) => s.list_with_path(path).await,
            Self::Sftp(s) => s.list_with_path(path).await,
        }
    }

    pub async fn mkdir(&mut self, path: &str) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.mkdir(path).await,
            Self::Sftp(s) => s.mkdir(path).await,
        }
    }

    pub async fn delete(&mut self, path: &str) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.delete(path).await,
            Self::Sftp(s) => s.delete(path).await,
        }
    }

    pub async fn rename(&mut self, from: &str, to: &str) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.rename(from, to).await,
            Self::Sftp(s) => s.rename(from, to).await,
        }
    }

    pub async fn size(&mut self, path: &str) -> Option<u64> {
        match self {
            Self::Ftp(s) => s.size(path).await,
            Self::Sftp(s) => s.size(path).await,
        }
    }

    pub async fn download_file(
        &mut self,
        remote: &str,
        local: &std::path::Path,
        id: u64,
        total: u64,
        base: u64,
        event_tx: &std::sync::mpsc::Sender<crate::bus::UiEvent>,
    ) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.download_file(remote, local, id, total, base, event_tx).await,
            Self::Sftp(s) => s.download_file(remote, local, id, total, base, event_tx).await,
        }
    }

    pub async fn upload_file(
        &mut self,
        local: &std::path::Path,
        remote: &str,
        id: u64,
        base: u64,
        event_tx: &std::sync::mpsc::Sender<crate::bus::UiEvent>,
    ) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.upload_file(local, remote, id, base, event_tx).await,
            Self::Sftp(s) => s.upload_file(local, remote, id, base, event_tx).await,
        }
    }

    pub async fn read_chunks(
        &mut self,
        remote: &str,
        id: u64,
        base: u64,
        data_tx: tokio::sync::mpsc::Sender<crate::bus::PipeMsg>,
        event_tx: &std::sync::mpsc::Sender<crate::bus::UiEvent>,
    ) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.read_chunks(remote, id, base, data_tx, event_tx).await,
            Self::Sftp(s) => s.read_chunks(remote, id, base, data_tx, event_tx).await,
        }
    }

    pub async fn write_chunks(
        &mut self,
        remote: &str,
        data_rx: tokio::sync::mpsc::Receiver<crate::bus::PipeMsg>,
    ) -> Result<(), String> {
        match self {
            Self::Ftp(s) => s.write_chunks(remote, data_rx).await,
            Self::Sftp(s) => s.write_chunks(remote, data_rx).await,
        }
    }
}

/// 目录列表字节流的编码解码策略：auto 时先试 UTF-8 严格解码，失败回退 GBK（中文站点最常见）。
pub fn make_decoder(encoding: &str) -> Box<dyn Fn(&[u8]) -> String + Send + Sync> {
    match encoding {
        "utf-8" => Box::new(|b: &[u8]| String::from_utf8_lossy(b).into_owned()),
        "gbk" => Box::new(|b: &[u8]| {
            encoding_rs::GBK.decode(b).0.into_owned()
        }),
        "big5" => Box::new(|b: &[u8]| {
            encoding_rs::BIG5.decode(b).0.into_owned()
        }),
        "shift-jis" => Box::new(|b: &[u8]| {
            encoding_rs::SHIFT_JIS.decode(b).0.into_owned()
        }),
        _ => Box::new(|b: &[u8]| {
            match std::str::from_utf8(b) {
                Ok(s) => s.to_string(),
                Err(_) => encoding_rs::GBK.decode(b).0.into_owned(),
            }
        }),
    }
}
