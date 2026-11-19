use reqwest::{Client, Response};
use semver::Version;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{error::Error, path::Path, time::Duration};
use tauri::AppHandle;
use tokio::{io::AsyncWriteExt, sync::Mutex};

const REPOSITORY: &str = "smildlzj/rust-flashfxp";
const CHECKSUMS: &str = "SHA256SUMS.txt";
const INSTALLER_PREFIX: &str = "Rust-Flash-Ftp-v";
const INSTALLER_SUFFIXES: [&str; 3] = ["-darwin-arm64.dmg", "-darwin-x64.dmg", "-windows-x64.exe"];
const MAX_INSTALLER_BYTES: u64 = 512 * 1024 * 1024;
static INSTALL: Mutex<()> = Mutex::const_new(());

type UpdateResult<T> = Result<T, Box<dyn Error + Send + Sync>>;

struct Release {
    version: Version,
    manifest: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateCheck {
    current_version: String,
    latest_version: Option<String>,
    installer_available: bool,
    release_published: bool,
}

fn client(timeout: Duration) -> UpdateResult<Client> {
    Ok(Client::builder()
        .https_only(true)
        .user_agent(concat!("Rust-Flash-Ftp/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(timeout)
        .build()?)
}

async fn read_limited(mut response: Response, limit: usize) -> UpdateResult<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        if bytes.len() + chunk.len() > limit {
            return Err("Response exceeds size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn latest_release(client: &Client) -> UpdateResult<Option<Release>> {
    let root = format!("https://github.com/{REPOSITORY}/releases");
    let response = client
        .get(format!("{root}/latest/download/{CHECKSUMS}"))
        .send()
        .await?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        // Distinguish an unpublished repository from a release missing its manifest.
        let page = client.get(format!("{root}/latest")).send().await?;
        if page.status() != reqwest::StatusCode::NOT_FOUND {
            let page = page.error_for_status()?;
            let tag_prefix = format!("/{REPOSITORY}/releases/tag/");
            if page.url().host_str() == Some("github.com")
                && page.url().path().starts_with(&tag_prefix)
            {
                return Err(flashfxp_lib::localized!(
                    "最新版本缺少 SHA256SUMS.txt",
                    "The latest release is missing SHA256SUMS.txt"
                )
                .into());
            }
        }
        return Ok(None);
    }
    let body = read_limited(response.error_for_status()?, 64 * 1024).await?;
    Ok(Some(Release::from_manifest(String::from_utf8(body)?)?))
}

impl Release {
    fn from_manifest(manifest: String) -> UpdateResult<Self> {
        let mut version = None;
        let mut installers = std::collections::HashSet::new();
        for line in manifest.lines() {
            let Some((digest, name)) = line.split_once("  ") else {
                continue;
            };
            let Some(name_body) = name.strip_prefix(INSTALLER_PREFIX) else {
                continue;
            };
            let Some(version_text) = INSTALLER_SUFFIXES
                .iter()
                .find_map(|suffix| name_body.strip_suffix(suffix))
            else {
                continue;
            };
            let candidate = Version::parse(version_text)?;
            if !valid_digest(digest)
                || candidate.to_string() != version_text
                || version
                    .as_ref()
                    .is_some_and(|expected| expected != &candidate)
                || !installers.insert(name)
            {
                return Err(flashfxp_lib::localized!(
                    "发布校验清单包含无效、重复或不同版本的安装包",
                    "The release checksum manifest contains invalid, duplicate, or mixed-version installers"
                ).into());
            }
            version = Some(candidate);
        }
        let version = version.ok_or_else(|| {
            flashfxp_lib::localized!(
                "发布校验清单中没有可识别的安装包",
                "No recognized installer in the release checksum manifest"
            )
        })?;
        Ok(Self { version, manifest })
    }

    fn installer_name(&self) -> Option<String> {
        self.installer_for(std::env::consts::OS, std::env::consts::ARCH)
    }

    fn installer_for(&self, os: &str, arch: &str) -> Option<String> {
        let (platform, extension) = match (os, arch) {
            ("macos", "aarch64") => ("darwin-arm64", "dmg"),
            ("macos", "x86_64") => ("darwin-x64", "dmg"),
            ("windows", "x86_64") => ("windows-x64", "exe"),
            _ => return None,
        };
        let name = format!("{INSTALLER_PREFIX}{}-{platform}.{extension}", self.version);
        checksum_for(&self.manifest, &name).map(|_| name)
    }

    async fn download(&self, client: &Client, asset: &str) -> UpdateResult<Response> {
        Ok(client
            .get(format!(
                "https://github.com/{REPOSITORY}/releases/download/v{}/{asset}",
                self.version
            ))
            .send()
            .await?
            .error_for_status()?)
    }
}

async fn check(app: &AppHandle) -> UpdateResult<UpdateCheck> {
    let current_version = app.package_info().version.to_string();
    let mut result = UpdateCheck {
        current_version,
        latest_version: None,
        installer_available: false,
        release_published: false,
    };
    if let Some(release) = latest_release(&client(Duration::from_secs(15))?).await? {
        let version = &release.version;
        result.release_published = true;
        if version.cmp_precedence(&app.package_info().version).is_gt() {
            result.latest_version = Some(version.to_string());
            result.installer_available = release.installer_name().is_some();
        }
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn check_update(app: AppHandle) -> Result<UpdateCheck, String> {
    check(&app).await.map_err(|error| error.to_string())
}

fn valid_digest(digest: &str) -> bool {
    digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn checksum_for<'a>(manifest: &'a str, name: &str) -> Option<&'a str> {
    manifest.lines().find_map(|line| {
        let (digest, filename) = line.split_once("  ")?;
        (filename == name && valid_digest(digest)).then_some(digest)
    })
}

async fn save_installer(mut response: Response, path: &Path, checksum: &str) -> UpdateResult<()> {
    let mut file = tokio::fs::File::create(path).await?;
    let mut size = 0;
    let mut hash = Sha256::new();
    while let Some(chunk) = response.chunk().await? {
        size += chunk.len() as u64;
        if size > MAX_INSTALLER_BYTES {
            return Err("Installer exceeds size limit".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk).await?;
    }
    file.flush().await?;
    if !format!("{:x}", hash.finalize()).eq_ignore_ascii_case(checksum) {
        return Err("Installer checksum mismatch".into());
    }
    Ok(())
}

async fn open_installer(path: &Path) -> UpdateResult<()> {
    #[cfg(target_os = "macos")]
    {
        if !tokio::process::Command::new("/usr/bin/open")
            .arg(path)
            .status()
            .await?
            .success()
        {
            return Err("Could not open the disk image".into());
        }
    }
    #[cfg(target_os = "windows")]
    {
        let directory = path.parent().ok_or("Installer directory missing")?;
        tokio::process::Command::new(path)
            .current_dir(directory)
            .spawn()?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        return Err("Unsupported installer platform".into());
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    Ok(())
}

async fn install(app: &AppHandle, expected_version: &str) -> UpdateResult<()> {
    let _install = INSTALL
        .try_lock()
        .map_err(|_| "An update is already downloading")?;
    let client = client(Duration::from_secs(300))?;
    let release = latest_release(&client)
        .await?
        .ok_or("No published release")?;
    let version = &release.version;
    if version.to_string() != expected_version
        || !version.cmp_precedence(&app.package_info().version).is_gt()
    {
        return Err("Release changed; check for updates again".into());
    }
    let name = release
        .installer_name()
        .ok_or("No installer for this platform")?;
    let checksum = checksum_for(&release.manifest, &name).ok_or("Installer checksum missing")?;
    let folder = tempfile::Builder::new()
        .prefix("rust-flash-ftp-update-")
        .tempdir()?;
    let path = folder.path().join(&name);
    save_installer(release.download(&client, &name).await?, &path, checksum).await?;
    open_installer(&path).await?;
    // The OS installer may still be reading this file after the launcher returns.
    let _ = folder.keep();
    Ok(())
}

#[tauri::command]
pub(crate) async fn install_update(app: AppHandle, version: String) -> Result<(), String> {
    install(&app, &version)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_installer_to_platform_and_requires_checksums() {
        let arm = "Rust-Flash-Ftp-v0.1.10-darwin-arm64.dmg";
        let intel = "Rust-Flash-Ftp-v0.1.10-darwin-x64.dmg";
        let windows = "Rust-Flash-Ftp-v0.1.10-windows-x64.exe";
        let digest = "a".repeat(64);
        let release = Release::from_manifest(format!(
            "{digest}  {arm}\n{digest}  {intel}\n{digest}  {windows}\n"
        ))
        .unwrap();
        assert!(release.version > Version::new(0, 1, 2));
        assert_eq!(
            release.installer_for("macos", "aarch64").as_deref(),
            Some(arm)
        );
        assert_eq!(
            release.installer_for("macos", "x86_64").as_deref(),
            Some(intel)
        );
        assert_eq!(
            release.installer_for("windows", "x86_64").as_deref(),
            Some(windows)
        );
        assert_eq!(release.installer_for("linux", "x86_64"), None);
        let mac_only = Release::from_manifest(format!("{digest}  {arm}\n")).unwrap();
        assert_eq!(mac_only.installer_for("windows", "x86_64"), None);
    }

    #[test]
    fn rejects_ambiguous_or_invalid_manifests() {
        let digest = "f".repeat(64);
        let asset = "Rust-Flash-Ftp-v0.1.3-darwin-arm64.dmg";
        assert!(Release::from_manifest(format!("{digest}  {asset}\n{digest}  {asset}")).is_err());
        assert!(Release::from_manifest(format!(
            "{digest}  {asset}\n{digest}  Rust-Flash-Ftp-v0.1.4-windows-x64.exe"
        ))
        .is_err());
        assert!(Release::from_manifest(format!("bad  {asset}")).is_err());
        assert!(Release::from_manifest(format!("{digest}  other.txt")).is_err());
    }

    #[tokio::test]
    async fn downloaded_installer_must_match_its_checksum() {
        use tokio::io::AsyncReadExt;

        let payload = b"test installer";
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for _ in 0..2 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    request.push(socket.read_u8().await.unwrap());
                }
                let header = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    payload.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                socket.write_all(payload).await.unwrap();
            }
        });
        let client = Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let url = format!("http://{address}");
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("test-installer");
        let checksum = format!("{:x}", Sha256::digest(payload));

        let response = client.get(&url).send().await.unwrap();
        save_installer(response, &path, &checksum).await.unwrap();
        assert_eq!(tokio::fs::read(&path).await.unwrap(), payload);

        let response = client.get(&url).send().await.unwrap();
        let error = save_installer(response, &path, &"0".repeat(64))
            .await
            .unwrap_err();
        assert_eq!(error.to_string(), "Installer checksum mismatch");
        server.await.unwrap();
    }

    #[test]
    fn reads_only_the_valid_checksum_for_the_exact_installer() {
        let digest = "f".repeat(64);
        let manifest =
            format!("{digest}  Other.exe\ninvalid  Installer.exe\n{digest}  Installer.exe\n");
        assert_eq!(
            checksum_for(&manifest, "Installer.exe"),
            Some(digest.as_str())
        );
        assert_eq!(checksum_for(&manifest, "Missing.exe"), None);
    }
}
