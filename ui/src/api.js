import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

let handler = null
let listenerReady = null // 幂等：React.StrictMode 会执行两次 useEffect，重复 listen 会导致事件被处理两遍

export function onEvent(cb) {
  handler = cb
}

async function setupListener() {
  if (listenerReady) return listenerReady
  listenerReady = (async () => {
    await listen('fx-event', (e) => {
      if (handler) handler(e.payload)
    })
    // 系统/前端文件拖放（拖入窗口 = 上传）
    await listen('tauri://drag-drop', (e) => {
      if (handler) handler({ __dropped: e.payload })
    })
  })().catch((err) => { listenerReady = null; throw err })
  return listenerReady
}

export async function init() {
  await setupListener()
}

// ---- commands ----
export const api = {
  homeDir: () => invoke('home_dir'),
  pickFolder: () => invoke('pick_folder'),
  diskInfo: (path) => invoke('disk_info', { path }),
  treeList: (path) => invoke('tree_list', { path }),
  quickConnect: (args) => invoke('quick_connect', args),
  connectSite: async (siteId) => {
    const site = (await invoke('sites_list')).find(s => s.id === siteId)
    if (!site) throw new Error('站点不存在')
    let credentials = { usernameOverride: null, passwordOverride: null }
    if (site.username !== 'anonymous' && (site.loginType === 'prompt' || !site.username || !site.password)) {
      const answer = await new Promise(resolve => window.dispatchEvent(new CustomEvent('fx-credentials', {
        detail: { siteName: site.name, username: site.username || '', resolve },
      })))
      if (!answer) return false
      credentials = { usernameOverride: answer.username, passwordOverride: answer.password }
    }
    await invoke('connect_site', { siteId, ...credentials })
    return true
  },
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
  cancelTransfer: (id) => invoke('transfer_cancel', { id }),
  sites: () => invoke('sites_list'),
  saveSite: (site) => invoke('site_save', { site }),
  deleteSite: (siteId) => invoke('site_delete', { siteId }),
  groups: () => invoke('groups_list'),
  addGroup: (name) => invoke('group_add', { name }),
  proxies: () => invoke('proxies_list'),
  saveProxy: (proxy) => invoke('proxy_save', { proxy }),
  deleteProxy: (proxyId) => invoke('proxy_delete', { proxyId }),
  appExit: () => invoke('app_exit'),
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

/* FlashFXP 原版显示：448 KB / 6.42 MB / 57.63 GB / 0（字节） */
export function humanSize(n) {
  n = Number(n) || 0
  if (n === 0) return '0'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) {
    const v = n / 1024
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} KB`
  }
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/* FlashFXP 原版：2026/6/28 21:54:10（斜杠、月/日/时不补零、含秒） */
export function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts * 1000)
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
