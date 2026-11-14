import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

let handler = null

export function onEvent(cb) {
  handler = cb
}

async function setupListener() {
  await listen('fx-event', (e) => {
    if (handler) handler(e.payload)
  })
  // 系统/前端文件拖放（拖入窗口 = 上传）
  await listen('tauri://drag-drop', (e) => {
    if (handler) handler({ __dropped: e.payload })
  })
}

export async function init() {
  await setupListener()
}

// ---- commands ----
export const api = {
  homeDir: () => invoke('home_dir'),
  diskInfo: (path) => invoke('disk_info', { path }),
  treeList: (path) => invoke('tree_list', { path }),
  quickConnect: (args) => invoke('quick_connect', args),
  connectSite: (siteId) => invoke('connect_site', { siteId }),
  disconnect: () => invoke('disconnect'),
  localList: (path) => invoke('local_list', { path }),
  remoteList: (path) => invoke('remote_list', { path }),
  mkdirLocal: (path) => invoke('mkdir_local', { path }),
  mkdirRemote: (path) => invoke('mkdir_remote', { path }),
  deleteLocal: (paths) => invoke('delete_local', { paths }),
  deleteRemote: (paths) => invoke('delete_remote', { paths }),
  renameLocal: (from, to) => invoke('rename_local', { from, to }),
  renameRemote: (from, to) => invoke('rename_remote', { from, to }),
  enqueue: (a) => invoke('enqueue_transfer', { args: a }),
  relay: (a) => invoke('relay_transfer', { args: a }),
  restoreQueue: () => invoke('restore_pending_queue'),
  queueClearFinished: () => invoke('queue_clear_finished'),
  sites: () => invoke('sites_list'),
  saveSite: (site) => invoke('site_save', { site }),
  deleteSite: (siteId) => invoke('site_delete', { siteId }),
  groups: () => invoke('groups_list'),
  addGroup: (name) => invoke('group_add', { name }),
  proxies: () => invoke('proxies_list'),
  saveProxy: (proxy) => invoke('proxy_save', { proxy }),
  deleteProxy: (proxyId) => invoke('proxy_delete', { proxyId }),
}

// ---- 远程路径工具（与 Rust 端一致） ----
export function remoteJoin(base, name) {
  const b = (base || '').replace(/\/+$/, '')
  if (!b) return `/${name}`
  return `${b}/${name}`
}

export function remoteParent(p) {
  const t = (p || '').replace(/\/+$/, '')
  if (!t) return null
  const i = t.lastIndexOf('/')
  if (i === 0) return '/'
  if (i === -1) return null
  return t.slice(0, i)
}

export function humanSize(n) {
  n = n || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
