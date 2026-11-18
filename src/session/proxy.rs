use async_std::io::{ReadExt, WriteExt};
use base64::Engine as _;
use std::io::{self, ErrorKind};

use crate::store::Proxy;

/// 经代理建立到目标的 TCP 连接（返回 async_std TcpStream，供 connect_with_stream 使用）
pub async fn dial_via_proxy(
    proxy: &Proxy,
    target_host: &str,
    target_port: u16,
) -> Result<async_std::net::TcpStream, String> {
    let stream = async_std::net::TcpStream::connect((proxy.host.as_str(), proxy.port))
        .await
        .map_err(|e| crate::localized!("连接代理 {}:{} 失败: {e}", "Failed to connect to proxy {}:{}: {e}", proxy.host, proxy.port))?;
    match proxy.kind.as_str() {
        "socks5" => socks5_handshake(stream, proxy, target_host, target_port).await,
        "http" => http_connect(stream, proxy, target_host, target_port).await,
        other => Err(crate::localized!("不支持的代理类型: {other}", "Unsupported proxy type: {other}")),
    }
}

fn socks5_reply_error(error: io::Error, stage: &str) -> String {
    match error.kind() {
        ErrorKind::UnexpectedEof | ErrorKind::ConnectionReset | ErrorKind::ConnectionAborted => {
            crate::localized!(
                "SOCKS5 代理提前关闭了连接（{stage}）",
                "The SOCKS5 proxy closed the connection before completing {stage}"
            )
        }
        _ => crate::localized!(
            "读取 SOCKS5 代理响应失败（{stage}）：{error}",
            "Failed to read the SOCKS5 proxy response during {stage}: {error}"
        ),
    }
}

async fn socks5_handshake(
    mut stream: async_std::net::TcpStream,
    proxy: &Proxy,
    target_host: &str,
    target_port: u16,
) -> Result<async_std::net::TcpStream, String> {
    let has_auth = proxy.username.as_deref().is_some_and(|u| !u.is_empty());
    stream
        .write_all(if has_auth { &[0x05, 0x02, 0x00, 0x02] } else { &[0x05, 0x01, 0x00] })
        .await
        .map_err(|e| crate::localized!("代理握手失败: {e}", "Proxy handshake failed: {e}"))?;
    let mut b = [0u8; 2];
    stream
        .read_exact(&mut b)
        .await
        .map_err(|e| socks5_reply_error(e, &crate::localized!("协商认证方式", "authentication method negotiation")))?;
    if b[0] != 0x05 {
        return Err(crate::localized!("代理协议版本不符", "Proxy protocol version mismatch"));
    }
    match b[1] {
        0x00 => {}
        0x02 => {
            let user = proxy.username.as_deref().unwrap_or("");
            let pass = proxy.password.as_deref().unwrap_or("");
            let mut auth = vec![0x01, user.len() as u8];
            auth.extend_from_slice(user.as_bytes());
            auth.push(pass.len() as u8);
            auth.extend_from_slice(pass.as_bytes());
            stream
                .write_all(&auth)
                .await
                .map_err(|e| crate::localized!("代理认证失败: {e}", "Proxy authentication failed: {e}"))?;
            let mut r = [0u8; 2];
            stream
                .read_exact(&mut r)
                .await
                .map_err(|e| socks5_reply_error(e, &crate::localized!("代理认证", "proxy authentication")))?;
            if r[1] != 0x00 {
                return Err(crate::localized!("代理认证被拒绝", "Proxy authentication rejected"));
            }
        }
        other => return Err(crate::localized!("代理要求不支持的认证方式: {other}", "Proxy requires an unsupported authentication method: {other}")),
    }
    // CONNECT 请求（域名形式，远端 DNS）
    let host_bytes = target_host.as_bytes();
    if host_bytes.is_empty() || host_bytes.len() > 255 {
        return Err(crate::localized!("目标主机名非法", "Invalid destination hostname"));
    }
    let mut req = vec![0x05, 0x01, 0x00, 0x03, host_bytes.len() as u8];
    req.extend_from_slice(host_bytes);
    req.extend_from_slice(&target_port.to_be_bytes());
    stream
        .write_all(&req)
        .await
        .map_err(|e| crate::localized!("发送代理请求失败: {e}", "Failed to send proxy request: {e}"))?;
    let connect_reply = crate::localized!("等待目标连接结果", "the destination connection reply");
    let mut head = [0u8; 4];
    stream
        .read_exact(&mut head)
        .await
        .map_err(|e| socks5_reply_error(e, &connect_reply))?;
    if head[1] != 0x00 {
        return Err(crate::localized!("代理连接被拒绝: 状态码 {}", "Proxy connection rejected: status code {}", head[1]));
    }
    let skip = match head[3] {
        0x01 => 6,
        0x03 => {
            let mut l = [0u8; 1];
            stream
                .read_exact(&mut l)
                .await
                .map_err(|e| socks5_reply_error(e, &connect_reply))?;
            l[0] as usize + 2
        }
        0x04 => 18,
        other => return Err(crate::localized!("代理地址类型非法: {other}", "Invalid proxy address type: {other}")),
    };
    let mut sink = vec![0u8; skip];
    stream
        .read_exact(&mut sink)
        .await
        .map_err(|e| socks5_reply_error(e, &connect_reply))?;
    Ok(stream)
}

async fn http_connect(
    mut stream: async_std::net::TcpStream,
    proxy: &Proxy,
    target_host: &str,
    target_port: u16,
) -> Result<async_std::net::TcpStream, String> {
    let mut req = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n"
    );
    if let Some(user) = proxy.username.as_deref().filter(|u| !u.is_empty()) {
        let creds = base64::engine::general_purpose::STANDARD.encode(format!(
            "{user}:{}",
            proxy.password.as_deref().unwrap_or("")
        ));
        req.push_str(&format!("Proxy-Authorization: Basic {creds}\r\n"));
    }
    req.push_str("\r\n");
    stream
        .write_all(req.as_bytes())
        .await
        .map_err(|e| crate::localized!("发送 CONNECT 失败: {e}", "Failed to send CONNECT: {e}"))?;
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1];
    loop {
        let n = stream
            .read(&mut chunk)
            .await
            .map_err(|e| crate::localized!("读取代理响应失败: {e}", "Failed to read proxy response: {e}"))?;
        if n == 0 {
            return Err(crate::localized!("代理提前断开", "Proxy disconnected prematurely"));
        }
        buf.push(chunk[0]);
        if buf.ends_with(b"\r\n\r\n") {
            break;
        }
        if buf.len() > 8192 {
            return Err(crate::localized!("代理响应过长", "Proxy response is too long"));
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let first = head.lines().next().unwrap_or_default();
    if !first.contains(" 200 ") && !first.ends_with(" 200") {
        return Err(crate::localized!("代理 CONNECT 失败: {first}", "Proxy CONNECT failed: {first}"));
    }
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn socks5_reports_disconnect_before_connect_reply_is_complete() {
        let listener = async_std::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = async_std::task::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut greeting = [0; 3];
            stream.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [5, 1, 0]);
            stream.write_all(&[5, 0]).await.unwrap();
            let mut request = [0; 7 + "example.test".len()];
            stream.read_exact(&mut request).await.unwrap();
            stream.write_all(&[5, 0]).await.unwrap();
        });
        let proxy = Proxy {
            id: 0,
            name: "Test SOCKS5".into(),
            kind: "socks5".into(),
            host: address.ip().to_string(),
            port: address.port(),
            username: None,
            password: None,
        };

        let error = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            dial_via_proxy(&proxy, "example.test", 21),
        )
        .await
        .unwrap()
        .unwrap_err();
        server.await;
        assert_eq!(
            error,
            crate::localized!(
                "SOCKS5 代理提前关闭了连接（等待目标连接结果）",
                "The SOCKS5 proxy closed the connection before completing the destination connection reply"
            )
        );
    }
}
