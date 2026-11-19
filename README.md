# Rust Flash Ftp

**English** | [简体中文](README.zh-CN.md)

<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" alt="Rust Flash Ftp icon" width="112" />
</p>

<p align="center"><strong>Familiar dual-pane browsing for managing servers and file transfers.</strong></p>

<p align="center">
  English / 简体中文 · FTP / FTPS / SFTP · Site management · Transfer resume · macOS / Windows
</p>

<p align="center">
  <a href="#core-features">Features</a> ·
  <a href="#flashfxp-feature-comparison">Feature comparison</a> ·
  <a href="https://github.com/smildlzj/rust-flashfxp/issues">Report an issue</a>
</p>

## Overview

Rust Flash Ftp is a desktop file transfer client with English and Simplified Chinese interfaces. Inspired by the classic FlashFXP workflow, it brings local files, remote files, transfer queues, and connection logs into one workspace.

Connect temporarily with Quick Connect or save frequently used servers in Site Manager. Each site can have its own local and remote starting directories, credentials, encoding, time zone, and proxy settings.

The protocol, transfer, and storage layers are written in Rust. The desktop application uses Tauri 2 and React. Packaging configurations cover macOS Apple Silicon, macOS Intel, and Windows x64. Change the interface language through **Options → Language**.

## Use cases

| Task | Workflow |
| --- | --- |
| Maintain website files | Save a server as a site, navigate to its directory, and upload pages or assets |
| Transfer development and test files | Organize sites by project or environment and set matching local and remote paths |
| Manage server files | Browse folders, download logs, create directories, rename entries, and delete files |
| Upload or download entire folders | Add a directory to the queue for recursive transfer |
| Move data between servers | Stream from a source site through local memory into the connected destination |
| Connect through a proxy | Assign a SOCKS5 or HTTP CONNECT proxy to a site |

## Core features

### Dual-pane browsing

Browse local and remote files side by side. Use the directory tree, typed paths, or path history to navigate, and sort entries by name, size, or modification time.

Create directories, rename or delete entries, and start transfers from the file list. Drag files between panes or into the application from the system. The lower area shows the queue and logs, separately or side by side, with adjustable dividers.

### FTP, FTPS, and SFTP

Connect using the protocol your server provides. FTPS supports explicit TLS (AUTH TLS) and implicit TLS. SFTP runs over SSH and currently supports password authentication.

Quick Connect handles temporary connections; Site Manager stores recurring ones. Connection, authentication, and transfer information appears in the log.

### Site management

Save server addresses, ports, protocols, and credentials, organize sites into groups, and configure initial local and remote directories.

- **Login modes:** saved credentials, password prompts, and anonymous login where supported.
- **Temporary credentials:** prompted passwords are used for the connection and are not saved to the site record.
- **Paths:** choose starting folders for each project.
- **Compatibility:** set filename encoding and server time zone per site.
- **Notes:** record a site's purpose for future reference.

### Persistent transfer queues

Files and directories share a sequential upload/download queue with progress, status, cancellation, recursive transfers, and resume support.

Unfinished tasks are persisted. After restarting and connecting to the matching site, review recovered tasks and choose **Resume Pending Transfers**. Recovery is manual: the application does not automatically replay old transfers at startup.

Resuming depends on protocol and server support and on retaining the partially transferred file. Check both sides before resuming a file whose content has changed.

### Synchronized browsing and folder comparison

Synchronized browsing links navigation between matching local and remote directory structures.

Folder comparison matches entries by name and marks entries found on only one side or with different sizes. It does not hash file contents: equal names and sizes do not guarantee identical content. Neither feature automatically synchronizes or deletes files.

### Streaming site-to-site transfers

Connect to the destination site and open its target directory, then choose a source site and path in the site transfer dialog.

Data is read from the source and written to the destination through a bounded memory pipeline, including recursive directory transfers. Intermediate files are not written to local disk. Traffic still passes through your computer, so throughput depends on its network connection and both servers.

This is a client-mediated stream, not direct server-to-server FXP.

### Proxies and desktop integration

Manage SOCKS5 and HTTP CONNECT proxies and assign them to individual sites. There is no separate global proxy switch.

Open independent session windows with **Session → New Session (F12)** or **⌘N** on macOS. All windows belong to one application and share one Dock icon, while connections, queues, and logs remain independent. Site configuration and language settings are shared.

Closing a window hides it and preserves its session. Use the tray or Dock to restore a window. Window geometry and layout preferences are saved. Native window titles identify the connected site in the Dock and Window menu.

## FlashFXP feature comparison

This checklist follows the categories in the [official FlashFXP feature list](https://www.flashfxp.com/features) and online help, rather than enumerating every protocol command or advanced setting. Checked items have an implementation in the current desktop application. Unchecked items are missing or do not yet provide the full capability. Partial support is described explicitly; a check does not imply validation on every platform or server. Removed placeholder controls do not count as implemented features.

### Connections, authentication, and proxies

- [x] FTP connections and Quick Connect.
- [x] Explicit and implicit FTPS.
- [x] SFTP connections, currently with password authentication only.
- [x] Active/passive FTP modes; active-mode compatibility through proxies is not fully validated.
- [x] Independent site profiles and initial local/remote directories.
- [x] Normal, anonymous, and prompted-password login; FTP ACCT authentication.
- [x] SOCKS5 and HTTP CONNECT proxies with proxy management.
- [ ] SOCKS4, FTP-specific proxies, global proxy settings, and comprehensive firewall configuration.
- [ ] SFTP private-key authentication, key management, and Pageant integration.
- [ ] FTPS client X.509 certificate management and Windows certificate store integration.
- [ ] SFTP host-key trust management (known_hosts).
- [ ] OTP / S/Key authentication.
- [ ] Application master-password protection and site unlocking.
- [ ] SSL CCC and SSCN secure direct site transfers.
- [ ] PRET support for distributed servers and an internal Ident service.
- [ ] Multiple addresses, local IP binding, configurable connection retries, and keep-alive policies.

### Transfers and queues

- [x] Uploads, downloads, and recursive directory transfers.
- [x] Interrupted-transfer resume, subject to protocol, server, and file state.
- [x] Transfer queue, progress, status, cancellation, and clearing completed tasks.
- [x] Queue persistence and recovery after restart, with manual resumption.
- [x] Drag transfers between panes and file drops from the system.
- [x] Streaming site-to-site transfers through local memory, without intermediate files; recursive directories supported.
- [ ] Direct FXP transfers between servers without client data traffic.
- [ ] MODE Z compression.
- [ ] Upload/download and per-site speed limits; buffer tuning.
- [ ] Automatic ASCII/Binary selection; FTP currently uses binary mode.
- [ ] Comprehensive overwrite rules, selective transfers, and skip lists.
- [ ] Queue pause/resume, priorities, reordering, and queue file import/export.
- [ ] Resume rollback verification and SFV / CRC integrity checks.
- [ ] Scheduled transfers, background scheduled tasks, and email notifications.
- [ ] Automatic exit, shutdown, and other post-transfer actions.

### Browsing and file management

- [x] Dual panes, directory trees, typed paths, history, and name/size/time sorting.
- [x] Directory creation, file/directory renaming and deletion, and path copying.
- [x] Synchronized browsing through linked navigation, without automatic file synchronization.
- [x] Current-directory comparison by name and size, marking missing entries and size differences.
- [x] FTP FEAT detection and MLSD listings, with traditional LIST compatibility.
- [x] UTF-8, GBK, Big5, Shift-JIS, and other filename encodings.
- [x] Manual server time-zone offsets; UTC timestamps for MLSD / SFTP.
- [ ] Automatic server time-offset detection for traditional LIST.
- [ ] Full comparison rules: dates, partial names, excluded extensions, hiding or selecting matches.
- [ ] Automatic directory synchronization and mirroring.
- [ ] Remote search and recursive directory space calculation.
- [ ] Unix permission changes, recursive chmod, and file attribute editing.
- [ ] Same-side file copying/moving, batch multi-selection, and transfer-as-name operations.
- [x] Remote viewing and editing, manual or automatic upload on save, multiple open files, and file associations. The built-in editor supports UTF-8 text, and managed files are limited to 2 MiB.
- [x] Folder bookmarks with local/remote paths and synchronized-browsing settings; ordered filename-mask color rules.
- [ ] Marked lists and file filtering.
- [ ] Remote directory caching and STAT fast listings.
- [ ] Downloads by explicit path and clipboard URL monitoring with automatic transfers.

### Site management and advanced tools

- [x] Site creation, editing, deletion, groups, and notes.
- [x] Prompted credentials are limited to the session and are not stored in site password fields.
- [ ] Site import/export; FlashFXP supports XML `.ftp` files.
- [ ] Full configuration backup/restore.
- [ ] Site copying, disabling, nested groups, statistics, and URL mapping.
- [ ] Custom SITE commands, a command editor, scripting, and remote shell commands.
- [ ] Automation command-line options.

### Interface and desktop integration

- [x] Queue/log tabs and side-by-side display, adjustable dividers, and saved dimensions.
- [x] Saved window geometry and tray show/hide/quit; native titles identify connected sites in Dock/Window menus.
- [x] Common shortcuts, layout visibility preferences, and deletion confirmation.
- [x] Independent session windows through F12 or macOS ⌘N, sharing one application, site configuration, language, and Dock icon.
- [ ] Tabbed sessions within one window or multiple remote sites displayed together.
- [ ] Transfer-rate graphs, compact transfer view, and Windows Jump Lists.
- [x] Simplified Chinese / English switching for the interface, application messages, and tray; existing logs and user data retain their original text.
- [ ] Custom themes, fonts, colors, toolbars, and additional languages.
- [ ] Sound events and online updates.

Additional reference: FlashFXP's [Sites menu](https://www.flashfxp.com/webhelp/Topics/sites-menu.htm), [site context menu](https://www.flashfxp.com/webhelp/Topics/site_manager_right_click.htm), [Tools menu](https://www.flashfxp.com/webhelp/Topics/tools-menu.htm), [transfer settings](https://www.flashfxp.com/webhelp/Topics/site-manager-ftp-transfer-tab.htm), [custom commands](https://www.flashfxp.com/webhelp/Topics/custom-command-list.htm), and [preferences](https://s.flashfxp.com/webhelp/Topics/preferences.htm).

## Common operations

| Operation | Entry point |
| --- | --- |
| New session window | F12 / macOS ⌘N, or Session → New Session |
| Change interface language | Options → Language → 简体中文 / English |
| Open Site Manager | F4 or the Sites menu |
| Refresh both file lists | F5 or the refresh button |
| Enter a temporary connection | Connect menu → Quick Connect, or F8 |
| Navigate directories | Directory tree or address bar |
| Folder bookmarks | Star beside an address bar / Ctrl+B; Site Manager → Bookmarks |
| Filename pattern colors | Options → Filters → Highlights |
| Upload, download, rename, delete | File list actions and context menus |
| View transfer progress | Queue panel |
| Investigate connection/transfer issues | Log panel |
| Continue recovered tasks | Resume Pending Transfers |
| Compare directories | Compare Folders and Synchronized Browsing |

## Scope and limitations

- The interface supports Simplified Chinese and English through Options → Language.
- SFTP currently uses password authentication; private-key management, Pageant, and client certificate management are not available.
- Comparison and synchronized browsing assist manual work; they do not provide automatic synchronization or scheduling.
- Installer builds are configured for macOS and Windows. Linux is not included in the current release workflow.
- Feature coverage is not identical to FlashFXP; the checklist above describes this project's implementation.

## FAQ

### Which protocol should I choose?

Use the protocol your server provides. SFTP uses SSH; FTPS adds TLS to FTP, and the two are not interchangeable. Prefer an encrypted option when available. Plain FTP does not encrypt credentials or file contents.

### Why are Chinese filenames displayed incorrectly?

Change the filename encoding in the site's advanced settings to match the server. Available choices include automatic detection, UTF-8, GBK, Big5, and Shift-JIS. Save, reconnect, and refresh the directory.

### Why does the queue not start automatically after a restart?

Recovery is manual. Confirm the current site and paths, then choose Resume Pending Transfers to enqueue recovered tasks again.

### Do site-to-site transfers use my computer's network?

Yes. Your computer receives data from the source and sends it to the destination through memory. This avoids manual downloads/uploads and temporary files, but still uses the local network connection.

### How do I report an issue?

Open an [issue](https://github.com/smildlzj/rust-flashfxp/issues) with your OS and architecture, application version, protocol, reproduction steps, and expected/actual results. Include relevant log excerpts or screenshots where useful. Remove passwords, tokens, private keys, and other sensitive information. Do not attach a database containing real site credentials.

## Build from source

Requirements: stable Rust, Node.js 22, npm, and the platform's desktop build tools. macOS requires Xcode Command Line Tools; Windows requires Visual Studio C++ Build Tools and WebView2 Runtime.

```bash
git clone https://github.com/smildlzj/rust-flashfxp.git
cd rust-flashfxp
npm --prefix ui ci
cd src-tauri
```

Build a macOS DMG:

```bash
npx --no-install --prefix ../ui tauri build --ci --bundles dmg -- --locked
```

Build a Windows x64 installer:

```bash
npx --no-install --prefix ../ui tauri build --ci --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

Bundles are written to `src-tauri/target/release/bundle/`, or `src-tauri/target/<target>/release/bundle/` when using `--target`. To build only the frontend, run `npm --prefix ui run build` from the repository root. Full functionality requires the native Tauri backend.

## Tests

Run from the repository root:

```bash
cargo test --lib
cargo check --manifest-path src-tauri/Cargo.toml --locked
npm --prefix ui run test
```

Tests requiring external servers are skipped by default. See the [testing guide](docs/testing.md) for setup and execution details.

## Project layout

```text
src/                  Rust core: protocols, transfers, proxies, storage
src-tauri/            Tauri backend, windows, tray, packaging
ui/                   React frontend, components, tests
docs/                 Architecture, development, testing, configuration
.github/workflows/    GitHub Actions build and release configuration
```

The current desktop entry point is `src-tauri/`. The root `src/main.rs`, `src/app.rs`, and `src/app/` retain the earlier egui implementation.

## Data and configuration

Sites, proxies, and queues are stored in `~/.rust-flashfxp/flashfxp.db`. Saved credentials are encrypted with a fixed application key, which is not a replacement for an OS keychain. Do not publish or share this database casually.

See [configuration](docs/configuration.md) for window state and other settings.

## Documentation

The detailed guides are currently in Chinese:

- [Development](docs/development.md)
- [Architecture](docs/architecture/overview.md)
- [Testing](docs/testing.md)
- [Configuration](docs/configuration.md)

## License

This project is licensed under the [MIT License](LICENSE).

This is an independent implementation and is not affiliated with the original FlashFXP product.
