import { t, getLocale, errorMessage, formatNumber } from './i18n.js'
import { useLanguage } from './LanguageContext.jsx'
import CredentialsDialog from './components/CredentialsDialog.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import FilePane from './components/FilePane.jsx'
import BookmarkManager from './components/BookmarkManager.jsx'
import FiltersDialog from './components/FiltersDialog.jsx'
import DirTree from './components/DirTree.jsx'
import SiteManager from './components/SiteManager.jsx'
import ProxyManager from './components/ProxyManager.jsx'
import RelayDialog from './components/RelayDialog.jsx'
import OptionsDialog from './components/OptionsDialog.jsx'
import QuickConnectDialog from './components/QuickConnectDialog.jsx'
import { parseQuickConnect, quickAddress, quickHistoryKey, rememberQuickConnect } from './quick-connect.js'
import { Ico, FxIconDefs, AppLogo } from './winicons.jsx'
import {
  WinMenuBar, WinButton, WinInput, WinCheck, WinDialog,
  WinFieldset, WinToolButton, WinContextMenu, useWinContextMenu, IconTip,
} from './win32.jsx'
import { api, init, onEvent, remoteJoin, remoteParent, humanSize } from './api.js'

let nextId = 1

/* Rust 事件载荷里字段可能是 snake_case（is_dir）或 camelCase（isDir），统一规范化 */
function normalizeEntries(entries) {
  return (entries || []).map(e => ({
    ...e,
    isDir: e.isDir ?? e.is_dir ?? false,
    isSymlink: e.isSymlink ?? e.is_symlink ?? false,
  }))
}

/* 地址栏：Win32 组合框（本地缓冲，回车/失焦导航） */
function AddressCombo({ value, onGo, disabled, history = [] }) {
  const [buf, setBuf] = useState(value || '')
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  useEffect(() => { setBuf(value || '') }, [value])
  useEffect(() => {
    const h = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const pick = (p) => { setBuf(p); setOpen(false); if (p) onGo(p) }
  return (
    <div className="fx-address-combo-wrap" ref={wrap}>
      <div className="fx-address-combo">
        <Ico name="folder" size={14} className="fx-addr-folder" />
        <input value={buf} disabled={disabled} spellCheck={false}
               onChange={(e) => setBuf(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter' && buf) { onGo(buf); e.currentTarget.blur() } }}
               onBlur={() => { if (!open && buf && buf !== value) onGo(buf) }} />
        <button type="button" className="caret" disabled={disabled} title={t("path_history")}
                onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(v => !v)}>▼</button>
      </div>
      {open && !disabled && (
        <div className="fx-combo-popup fx-scroll">
          {history.length
            ? history.map(p => <button key={p} className="fx-combo-item" title={p} onClick={() => pick(p)}>{p}</button>)
            : <div className="fx-combo-empty">{t("no_path_history")}</div>}
        </div>
      )}
    </div>
  )
}

function LogBody({ text, level = 'info' }) {
  const cls = { error: 'fx-log-err', success: 'fx-log-ok', command: 'fx-log-cmd', info: 'fx-log-info' }[level] || 'fx-log-info'
  return <span className={cls}>{text}</span>
}

export default function App() {
  const { language, setLanguage } = useLanguage()
  // ---- UI 配置持久化（localStorage；须在所有使用它的 useState 之前） ----
  const uiPref = {
    get: (k, d) => {
      try { const v = localStorage.getItem('fx.ui.' + k); return v === null ? d : JSON.parse(v) } catch { return d }
    },
    set: (k, v) => {
      try {
        localStorage.setItem('fx.ui.' + k, JSON.stringify(v))
        return true
      } catch {
        return false
      }
    },
  }

  const [connected, setConnected] = useState(false)
  const [currentSite, setCurrentSite] = useState(null)
  const [homePath, setHomePath] = useState('')

  const [localDir, setLocalDir] = useState('')
  const [localEntries, setLocalEntries] = useState([])
  const [localSelection, setLocalSelection] = useState(null)
  const [diskFree, setDiskFree] = useState(0)

  const [remoteDir, setRemoteDir] = useState(null)
  const [remoteEntries, setRemoteEntries] = useState([])
  const [remoteSelection, setRemoteSelection] = useState(null)
  const [activePane, setActivePane] = useState('local') // 键盘操作作用于哪一栏

  const [localHistory, setLocalHistory] = useState([])
  const [remoteHistory, setRemoteHistory] = useState([])

  const [sortLocal, setSortLocal] = useState({ key: 'name', desc: false })
  const [sortRemote, setSortRemote] = useState({ key: 'name', desc: false })
  const [localMarks, setLocalMarks] = useState({})
  const [remoteMarks, setRemoteMarks] = useState({})
  const [syncBrowse, setSyncBrowse] = useState(() => uiPref.get('syncBrowse', false))

  const [queue, setQueue] = useState([])
  const [log, setLog] = useState([])
  const [showBottom, setShowBottom] = useState(() => uiPref.get('startupBottom', true))
  // 原版默认布局：目录树显示、队列与日志并排、快速连接栏可见
  const [bottomTab, setBottomTab] = useState('both')
  const [bottomHeight, setBottomHeight] = useState(() => {
    const value = uiPref.get('bottomHeight', 220)
    return Number.isFinite(value) ? Math.max(100, value) : 220
  })
  const [queueWidth, setQueueWidth] = useState(() => {
    const value = uiPref.get('queueWidth', 73)
    return Number.isFinite(value) ? Math.max(20, Math.min(80, value)) : 73
  })
  const resizeBottom = (event, axis) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const container = event.currentTarget.parentElement
    event.currentTarget.dataset.resizing = axis
    event.currentTarget._resizeBounds = container.getBoundingClientRect()
  }
  const moveBottom = (event) => {
    const handle = event.currentTarget
    if (!handle.hasPointerCapture(event.pointerId)) return
    const bounds = handle._resizeBounds
    if (handle.dataset.resizing === 'height') {
      const height = Math.round(Math.max(100, Math.min(window.innerHeight * 0.6, bounds.bottom - event.clientY)))
      setBottomHeight(height)
      uiPref.set('bottomHeight', height)
    } else {
      const width = Math.max(20, Math.min(80, (event.clientX - bounds.left) / bounds.width * 100))
      setQueueWidth(width)
      uiPref.set('queueWidth', width)
    }
  }
  const splitterProps = (axis) => ({
    role: 'separator',
    'aria-label': axis === 'height' ? t("resize_queue_and_log_height") : t("resize_queue_and_log_widths"),
    'aria-orientation': axis === 'height' ? 'horizontal' : 'vertical',
    onPointerDown: (event) => resizeBottom(event, axis),
    onPointerMove: moveBottom,
    onPointerUp: (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    },
  })

  const [showTree, setShowTree] = useState(() => uiPref.get('startupTree', true))
  const [showQuick, setShowQuick] = useState(() => uiPref.get('startupQuickbar', true))
  const [showHeader, setShowHeader] = useState(() => uiPref.get('startupHeaderbar', true))
  const [siteManagerOpen, setSiteManagerOpen] = useState(false)
  const [proxyManagerOpen, setProxyManagerOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [update, setUpdate] = useState(null)

  async function checkUpdate() {
    setUpdate({ checking: true })
    try {
      setUpdate(await api.checkUpdate())
    } catch (error) {
      setUpdate({ error: errorMessage(error) })
    }
  }

  async function installUpdate() {
    const available = update
    setUpdate({ ...available, downloading: true, error: null })
    try {
      await api.installUpdate(available.latestVersion)
      setUpdate({ ...available, opened: true, error: null })
    } catch (error) {
      setUpdate({ ...available, error: errorMessage(error) })
    }
  }

  const updateBusy = update?.checking || update?.downloading
  const closeUpdate = () => { if (!updateBusy) setUpdate(null) }
  const [connectMenuOpen, setConnectMenuOpen] = useState(false)
  const [connectSites, setConnectSites] = useState([])

  const [qc, setQc] = useState({ host: '', port: '21', user: '', pass: '', protocol: 'ftp' })
  const [quickConnectDraft, setQuickConnectDraft] = useState(null)
  const [quickHistory, setQuickHistory] = useState(() => uiPref.get('quickConnectHistory', []))
  const [newSiteDraft, setNewSiteDraft] = useState(null)
  const [deleteConfirmation, setDeleteConfirmation] = useState(null)
  const [prompt, setPrompt] = useState(null) // {title, value, apply}
  const [notice, setNotice] = useState('')
  const [elapsed, setElapsed] = useState(0)

  // Win32 风格提示：写进状态栏，不用现代 toast
  const noticeTimer = useRef(null)
  const showNotice = (text) => {
    setNotice(String(text))
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(''), 2800)
  }
  const toast = (text) => showNotice(text)
  toast.success = showNotice
  toast.error = showNotice
  toast.warning = showNotice
  toast.info = showNotice

  // 事件回调注册于首次渲染，读状态必须经 ref 取最新值
  const stateRef = useRef({})
  stateRef.current = { localDir, remoteDir, connected, currentSite }
  const actionsRef = useRef({})
  const listSearch = useRef(null)
  const bootLogged = useRef(false) // StrictMode 下避免启动日志重复
  const ctxMenu = useWinContextMenu()
  const openLogMenu = (event) => {
    const logPanel = event.currentTarget
    const selection = document.getSelection()
    const text = selection && logPanel.contains(selection.anchorNode) && logPanel.contains(selection.focusNode)
      ? selection.toString()
      : ''
    ctxMenu.openMenu(event, [
      { label: t('copy_log_selection'), disabled: !text, act: async () => {
        try { await navigator.clipboard.writeText(text) }
        catch (error) { showNotice(errorMessage(error)) }
      } },
      { label: t('select_all_log'), act: () => {
        if (!selection) return
        const range = document.createRange()
        range.selectNodeContents(logPanel)
        selection.removeAllRanges()
        selection.addRange(range)
      } },
      { sep: true },
      { label: t('clear_log'), disabled: !log.length, act: () => setLog([]) },
    ])
  }
  const [appVersion, setAppVersion] = useState('…')
  const [highlightRules, setHighlightRules] = useState([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [bookmarkMode, setBookmarkMode] = useState('manage')
  const [bookmarkSiteId, setBookmarkSiteId] = useState(null)
  useEffect(() => {
    let active = true
    let unlisten
    const reload = () => api.highlights().then(rules => { if (active) setHighlightRules(rules) })
      .catch(error => { if (active) showNotice(errorMessage(error)) })
    reload()
    api.onBrowsingChanged(kind => { if (kind === 'highlights') reload() })
      .then(stop => { if (active) unlisten = stop; else stop() })
      .catch(error => { if (active) showNotice(errorMessage(error)) })
    return () => { active = false; unlisten?.() }
  }, [])
  const manageBookmarks = (mode = 'manage') => {
    setBookmarkSiteId(currentSite?.id > 0 ? currentSite.id : null)
    setBookmarkMode(mode)
    setBookmarkOpen(true)
  }
  const activateBookmark = async bookmark => {
    try {
      const sync = await api.openBookmark(bookmark.id)
      if (sync !== 'default') setSyncBrowse(sync === 'enabled')
    } catch (error) { showNotice(errorMessage(error)) }
  }
  const openBookmarks = async event => {
    event.preventDefault(); event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const anchor = { clientX: rect.left, clientY: rect.bottom, preventDefault() {}, stopPropagation() {} }
    try {
      const bookmarks = await api.bookmarks()
      ctxMenu.openMenu(anchor, [
        ...bookmarks.map(bookmark => ({ label: bookmark.caption, act: () => activateBookmark(bookmark) })),
        ...(bookmarks.length ? [{ sep: true }] : [{ label: t('bookmark_empty'), disabled: true }]),
        { label: t('bookmark_add_current'), act: () => manageBookmarks('add') },
        { label: t('bookmark_manage'), act: () => manageBookmarks() },
      ])
    } catch (error) { showNotice(errorMessage(error)) }
  }

  useEffect(() => {
    if (!aboutOpen) return
    let cancelled = false
    api.appVersion().then(version => { if (!cancelled) setAppVersion(version) })
      .catch(() => { if (!cancelled) setAppVersion('—') })
    return () => { cancelled = true }
  }, [aboutOpen])

  const addLog = (text, level = 'info') => {
    const now = new Date()
    const p = (x) => String(x).padStart(2, '0')
    setLog(l => [...l.slice(-499), { text: `[${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}] ${text}`, level }])
  }

  // ---- 排序 ----
  const sortEntries = (entries, st) => {
    const v = [...entries]
    const dirOf = (e) => (e.isDir ? 0 : 1)
    const cmp = {
      name: (a, b) => dirOf(a) - dirOf(b) || a.name.localeCompare(b.name, language),
      size: (a, b) => dirOf(a) - dirOf(b) || a.size - b.size,
      time: (a, b) => dirOf(a) - dirOf(b) || (a.mtime || 0) - (b.mtime || 0),
    }[st.key]
    v.sort(cmp)
    if (st.desc) v.reverse()
    return v
  }
  const sortedLocal = useMemo(() => sortEntries(localEntries, sortLocal), [localEntries, sortLocal, language])
  const sortedRemote = useMemo(() => sortEntries(remoteEntries, sortRemote), [remoteEntries, sortRemote, language])
  // 排序结果需在定义之后再写入 ref（早于此处引用会触发 TDZ 白屏）
  stateRef.current.sortedLocal = sortedLocal
  stateRef.current.sortedRemote = sortedRemote

  // Selection belongs to a filename, not its position in the current locale's sort order.
  const selectedIndex = (entries, name) => {
    if (name == null) return null
    const index = entries.findIndex(entry => entry.name === name)
    return index < 0 ? null : index
  }
  const localNames = new Set(localSelection?.names)
  const remoteNames = new Set(remoteSelection?.names)
  const localSel = selectedIndex(sortedLocal, localSelection?.names.at(-1))
  const remoteSel = selectedIndex(sortedRemote, remoteSelection?.names.at(-1))

  const selectRow = (entries, setter, index, options = {}) => {
    const name = entries[index]?.name
    if (name == null) {
      setter(null)
      return
    }
    const available = new Set(entries.map(entry => entry.name))
    setter(selection => {
      const names = (selection?.names ?? []).filter(item => available.has(item))
      if (options.context && names.includes(name)) return selection
      const anchor = selectedIndex(entries, selection?.anchor)
      if (options.shiftKey && anchor != null) {
        const range = entries.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map(entry => entry.name)
        return { anchor: selection.anchor, names: [...range.filter(item => item !== name), name] }
      }
      if (options.metaKey || options.ctrlKey) {
        return { anchor: name, names: names.includes(name) ? names.filter(item => item !== name) : [...names, name] }
      }
      return { anchor: name, names: [name] }
    })
  }
  const setLocalSel = (index, options) => selectRow(stateRef.current.sortedLocal, setLocalSelection, index, options)
  const setRemoteSel = (index, options) => selectRow(stateRef.current.sortedRemote, setRemoteSelection, index, options)

  // ---- 事件处理 ----
  const handleEvent = (p) => {
    if (p && p.__dropped) {
      for (const path of p.__dropped.paths || []) {
        const name = path.split('/').pop()
        if (name) enqueue('upload', name, false)
      }
      return
    }
    if (typeof p === 'string') {
      if (p === 'Connected') {
        setConnected(true)
        addLog(t("connected_to_site"), 'success')
        showNotice(t("connected"))
        restoreQueue()
      } else if (p === 'Disconnected') {
        setConnected(false)
        setCurrentSite(null)
        setRemoteDir(null)
        setRemoteEntries([])
        setRemoteSel(null)
        addLog(t("disconnected"))
      }
      return
    }
    if (p.LocalList) {
      uiPref.set('localDir', p.LocalList.path)
      setLocalDir(p.LocalList.path)
      setLocalHistory(h => [p.LocalList.path, ...h.filter(x => x !== p.LocalList.path)].slice(0, 12))
      setLocalEntries(normalizeEntries(p.LocalList.entries))
      setLocalSel(null)
      setLocalMarks({})
      if (p.LocalList.path) {
        api.diskInfo(p.LocalList.path).then(([free]) => setDiskFree(free)).catch(() => {})
      }
    } else if (p.RemoteList) {
      setRemoteDir(p.RemoteList.path)
      setRemoteHistory(h => [p.RemoteList.path, ...h.filter(x => x !== p.RemoteList.path)].slice(0, 12))
      setRemoteEntries(normalizeEntries(p.RemoteList.entries))
      setRemoteSel(null)
      setRemoteMarks({})
      addLog(t("listing_complete_value_value_items", [p.RemoteList.path, p.RemoteList.entries.length]))
    } else if (p.Notify) {
      showNotice(p.Notify.text)
      if (p.Notify.level === 'error') addLog(t("error_value", [p.Notify.text]), p.Notify.level)
    } else if (p.TransferStarted) {
      setQueue(qs => qs.map(q => q.id === p.TransferStarted.id
        ? { ...q, size: p.TransferStarted.size, status: 'active' } : q))
    } else if (p.TransferProgress) {
      setQueue(qs => qs.map(q => q.id === p.TransferProgress.id
        ? { ...q, transferred: p.TransferProgress.transferred } : q))
    } else if (p.TransferFinished) {
      setQueue(qs => qs.map(q => q.id === p.TransferFinished.id
        ? { ...q, status: p.TransferFinished.ok ? 'done' : 'failed', error: p.TransferFinished.error || '', cancelled: !!p.TransferFinished.cancelled } : q))
      if (p.TransferFinished.ok) {
        addLog(t("transfer_complete"), 'success')
        showNotice(t("transfer_complete"))
        if (stateRef.current.localDir) api.localList(stateRef.current.localDir)
        if (stateRef.current.remoteDir) api.remoteList(stateRef.current.remoteDir)
      } else {
        addLog(t("transfer_failed_value", [p.TransferFinished.error || '']), 'error')
        showNotice(t("transfer_failed_value", [p.TransferFinished.error || '']))
      }
    }
  }

  const restoreQueue = async () => {
    try {
      const items = await api.restoreQueue()
      if (items && items.length) {
        setQueue(qs => [...qs, ...items.map(it => ({
          id: it.id, direction: it.direction, remote: it.remote, local: it.local,
          size: 0, transferred: 0, status: 'waiting', restored: true, isDir: it.isDir,
        }))])
        setShowBottom(true)
        showNotice(t("restored_value_queued_transfers_resume_manually", [items.length]))
      }
    } catch {}
  }

  const resumeRestored = async () => {
    const items = queue.filter(q => q.restored && q.status === 'waiting')
    if (!items.length) { showNotice(t("no_transfers_to_resume")); return }
    for (const it of items) {
      try {
        await api.enqueue({
          id: it.id, direction: it.direction,
          remotePath: it.remote, localPath: it.local, isDir: it.isDir,
        })
        setQueue(qs => qs.map(q => q.id === it.id ? { ...q, restored: false } : q))
      } catch (error) { showNotice(errorMessage(error)) }
    }
  }

  // ---- 导航 ----
  const refreshLocal = async () => {
    if (!localDir) return
    try { await api.localList(localDir) } catch (error) { showNotice(errorMessage(error)) }
  }
  const refreshRemote = async () => {
    if (!remoteDir) return
    try { await api.remoteList(remoteDir) } catch (error) { showNotice(errorMessage(error)) }
  }
  const navLocal = (path) => api.localList(path)
  // 连接已保存站点后，若配置了本地初始路径则切换本地面板（配置无效时保持现状）
  const applySiteLocalPath = (site) => {
    const p = (site && site.localPath || '').trim()
    if (p) {
      api.treeList(p).then(() => api.localList(p)).catch(e => showNotice(t("initial_local_directory_unavailable_value", [e])))
    }
  }
  const localUp = () => {
    if (!localDir) return
    const parent = localDir.replace(/\/[^/]+\/?$/, '') || '/'
    navLocal(parent)
  }
  const remoteUp = () => {
    if (!remoteDir) return
    const pp = remoteParent(remoteDir)
    if (pp) api.remoteList(pp)
  }

  const activateLocal = (i) => {
    const e = sortedLocal[i]
    if (!e) return
    if (e.isDir) {
      navLocal(`${localDir}/${e.name}`)
      if (syncBrowse && remoteDir) {
        const r = sortedRemote.find(x => x.name === e.name && x.isDir)
        if (r) api.remoteList(remoteJoin(remoteDir, e.name))
        else showNotice(t("synchronized_browsing_no_matching_remote_directory"))
      }
    } else if (remoteDir) {
      enqueue('upload', e.name, false)
    }
  }

  const activateRemote = (i) => {
    const e = sortedRemote[i]
    if (!e) return
    if (e.isDir) {
      api.remoteList(remoteJoin(remoteDir, e.name))
      if (syncBrowse) {
        const l = sortedLocal.find(x => x.name === e.name && x.isDir)
        if (l) navLocal(`${localDir}/${e.name}`)
        else showNotice(t("synchronized_browsing_no_matching_local_directory"))
      }
    } else {
      enqueue('download', e.name, false)
    }
  }

  // ---- 操作 ----
  const askPrompt = (title, value, apply) => setPrompt({ title, value, apply })

  const editorPreferences = () => ({
    associations: uiPref.get('fileAssociations', []),
    policy: uiPref.get('remoteEditOnSave', 'prompt'),
    remember: uiPref.get('rememberEditHistory', false),
  })

  const paneAction = (which, action, target) => {
    const selIdx = which === 'local' ? localSel : remoteSel
    const entries = which === 'local' ? sortedLocal : sortedRemote
    const sel = target ?? (selIdx != null ? entries[selIdx] : null)
    const names = which === 'local' ? localNames : remoteNames
    const selected = target && !names.has(target.name)
      ? [target]
      : entries.filter(entry => names.has(entry.name))
    // 后端命令与列目录走同一条 UiCmd 队列：必须 await 操作命令入队后再刷新，
    // 否则刷新可能先于 mkdir/rename/delete 执行，列表看不到结果（真实时序缺陷）。
    if (action === 'view' || action === 'edit') {
      const remote = which === 'remote'
      const directory = remote ? remoteDir : localDir
      if (!directory || (remote && !connected)) return
      const files = selected.filter(entry => !entry.isDir)
      if (!files.length) return
      void api.showFileEditor({
        action, remote,
        ...editorPreferences(),
        show: action === 'view' || uiPref.get('showActiveEditsOnOpen', true),
        entries: files.map(entry => ({
          name: entry.name,
          path: remote ? remoteJoin(directory, entry.name) : `${directory}/${entry.name}`,
        })),
      }).catch(problem => showNotice(errorMessage(problem)))
    } else if (action === 'mkdir') {
      askPrompt(which === 'local' ? t("new_local_folder") : t("new_remote_folder"), '', async (name) => {
        try {
          if (which === 'local') await api.mkdirLocal(`${localDir}/${name}`)
          else await api.mkdirRemote(remoteJoin(remoteDir, name))
        } catch (e) { showNotice(t("create_folder_failed_value", [e])); return }
        if (which === 'local') refreshLocal(); else refreshRemote()
      })
    } else if (action === 'rename' && sel) {
      askPrompt(t("rename"), sel.name, async (name) => {
        try {
          if (which === 'local') await api.renameLocal(`${localDir}/${sel.name}`, `${localDir}/${name}`)
          else await api.renameRemote(remoteJoin(remoteDir, sel.name), remoteJoin(remoteDir, name))
        } catch (e) { showNotice(t("rename_failed_value", [e])); return }
        if (which === 'local') refreshLocal(); else refreshRemote()
      })
    } else if (action === 'delete' && selected.length) {
      const remove = async () => {
        try {
          if (which === 'local') { await api.deleteLocal(selected.map(entry => `${localDir}/${entry.name}`)); setLocalSel(null) }
          else { await api.deleteRemote(selected.map(entry => remoteJoin(remoteDir, entry.name))); setRemoteSel(null) }
        } catch (e) { showNotice(t("delete_failed_value", [e])); return }
        if (which === 'local') refreshLocal(); else refreshRemote()
      }
      if (uiPref.get('confirmDelete', true)) {
        setDeleteConfirmation({ selected, remove })
      } else {
        void remove()
      }
    } else if (action === 'transfer') {
      for (const entry of selected) enqueue(which === 'local' ? 'upload' : 'download', entry.name, entry.isDir)
    } else if (action === 'compare') {
      comparePanes()
    } else if (action === 'clear-compare') {
      setLocalMarks({})
      setRemoteMarks({})
    } else if (action.startsWith('sort-')) {
      const key = action.split('-')[1]
      const setter = which === 'local' ? setSortLocal : setSortRemote
      const cur = which === 'local' ? sortLocal : sortRemote
      setter(cur.key === key ? { key, desc: !cur.desc } : { key, desc: false })
    }
  }

  const comparePanes = () => {
    const lm = {}
    const rm = {}
    const remoteMap = new Map(remoteEntries.map(e => [e.name, e]))
    const localMap = new Map(localEntries.map(e => [e.name, e]))
    for (const e of localEntries) {
      const r = remoteMap.get(e.name)
      if (!r) lm[e.name] = 'only'
      else if (!e.isDir && !r.isDir && e.size !== r.size) lm[e.name] = 'diff'
      else lm[e.name] = 'same'
    }
    for (const e of remoteEntries) {
      const l = localMap.get(e.name)
      if (!l) rm[e.name] = 'only'
      else if (!e.isDir && !l.isDir && e.size !== l.size) rm[e.name] = 'diff'
      else rm[e.name] = 'same'
    }
    setLocalMarks(lm)
    setRemoteMarks(rm)
    const diff = Object.values(lm).filter(m => m !== 'same').length + Object.values(rm).filter(m => m !== 'same').length
    addLog(t("comparison_complete_value_differences", [diff]))
    showNotice(t("comparison_complete_value_differences", [diff]))
  }

  // ---- 传输 ----
  const enqueue = (direction, name, isDir) => {
    if (!localDir) { showNotice(t("local_directory_is_not_ready_for_transfer")); return }
    const remote = remoteJoin(remoteDir || '/', name)
    const local = `${localDir}/${name}`
    const id = nextId++
    setQueue(qs => [...qs, { id, direction, remote, local, size: 0, transferred: 0, status: 'waiting' }])
    setShowBottom(true)
    if (bottomTab === 'log') setBottomTab('queue')
    addLog(t("queue_value_value", [direction === 'download' ? t("download") : t("upload"), remote]))
    api.enqueue({ id, direction, remotePath: remote, localPath: local, isDir })
  }

  const clearFinished = async () => {
    setQueue(qs => qs.filter(q => q.status === 'waiting' || q.status === 'active'))
    await api.queueClearFinished()
  }

  const cancelWaiting = () => {
    const items = queue.filter(q => q.status === 'waiting')
    if (!items.length) { showNotice(t("no_waiting_transfers_in_queue")); return }
    for (const q of items) api.cancelTransfer(q.id)
    showNotice(t("requested_cancellation_of_value_waiting_transfers", [items.length]))
  }

  const startRelay = ({ site, path }) => {
    const id = nextId++
    setQueue(qs => [...qs, {
      id, direction: 'relay', remote: `${site.host}:${path} → ${remoteDir || '/'}`,
      local: '', size: 0, transferred: 0, status: 'waiting',
    }])
    setShowBottom(true)
    if (bottomTab === 'log') setBottomTab('queue')
    setRelayOpen(false)
    addLog(t("site_transfer_value_value_value_value", [site.name, path, currentSite?.host, remoteDir]))
    api.relay({
      id, srcSiteId: site.id, srcPath: path,
      dstPath: (remoteJoin(remoteDir || '/', '').replace(/\/+$/, '')) || '/',
    })
  }

  // ---- 连接 ----
  const quickFields = (fields) => {
    try { return parseQuickConnect(fields) }
    catch (problem) { throw new Error(t(problem.message)) }
  }
  const storeQuickHistory = (entries) => {
    uiPref.set('quickConnectHistory', entries)
    setQuickHistory(entries)
  }
  const quickConnect = async (fields = qc) => {
    const connection = quickFields(fields)
    setQueue([])
    await api.quickConnect(connection)
    setCurrentSite({ host: connection.host, port: connection.port })
    setQc({ ...connection, pass: '' })
    storeQuickHistory(rememberQuickConnect(uiPref.get('quickConnectHistory', []), connection))
  }
  const runQuickConnect = (fields) => {
    void quickConnect(fields ?? { ...qc, protocol: 'ftp', remotePath: null }).catch(problem => showNotice(errorMessage(problem)))
  }
  const openQuickConnect = (entry) => {
    setConnectMenuOpen(false)
    setQuickHistory(uiPref.get('quickConnectHistory', []))
    setQuickConnectDraft(entry ? { ...entry, pass: '', historyKey: quickHistoryKey(entry) } : { ...qc })
  }
  const quickSiteDraft = (fields) => {
    const { host, port, protocol, user, pass, remotePath } = quickFields(fields)
    setNewSiteDraft({
      name: quickAddress({ host, port }), host, port, protocol,
      username: user, password: pass, remotePath: remotePath || '',
    })
    setQuickConnectDraft(null)
    setSiteManagerOpen(true)
  }

  // 工具栏右侧「连接」下拉：快速连接 / 站点管理器 / 已保存站点
  const toggleConnectMenu = async () => {
    const next = !connectMenuOpen
    setConnectMenuOpen(next)
    if (next) {
      setQuickHistory(uiPref.get('quickConnectHistory', []))
      try { setConnectSites(await api.sites()) } catch { setConnectSites([]) }
    }
  }
  const connectFromMenu = async (s) => {
    setConnectMenuOpen(false)
    try {
      if (!await api.connectSite(s.id)) return
      setCurrentSite({ id: s.id, host: s.host, port: Number(s.port) || 21, name: s.name })
      applySiteLocalPath(s)
    } catch (e) { showNotice(t("connection_failed_value", [e])) }
  }
  useEffect(() => {
    if (!connectMenuOpen) return
    const h = (e) => { if (!e.target.closest('.fx-tool-connect')) setConnectMenuOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [connectMenuOpen])

  // ---- 初始化 ----
  useEffect(() => {
    ;(async () => {
      try {
        await api.setLanguage(getLocale())
        document.documentElement.lang = getLocale()
        await init()
        onEvent(handleEvent)
        const home = await api.homeDir()
        setHomePath(home)
        if (!bootLogged.current) {
          bootLogged.current = true
          addLog(t("rust_flash_ftp_started"))
          addLog(t("l_ftp_ftps_sftp_ready"))
          addLog(t("l_connection_mode_passive_pasv"))
          addLog(t("l_filename_encoding_auto_detect"))
          addLog(t("l_proxy_server_disabled"))
          addLog(t("l_local_browser_value", [home]))
          addLog(t("l_queue_window_0_items"))
          addLog(t("l_transfer_queue_sequential_resume_enabled"))
          addLog(t("l_status_idle_waiting_for_connection"))
        }
        const prefDir = uiPref.get('defaultLocalDir', '') || uiPref.get('localDir', '')
        if (prefDir) {
          api.treeList(prefDir).then(() => navLocal(prefDir)).catch(() => navLocal(home))
        } else {
          navLocal(home)
        }
      } catch (e) {
        showNotice(t("initialization_failed_value", [e]))
      }
    })()
    const elapsedTimer = setInterval(() => setElapsed(v => v + 1), 1000)
    return () => clearInterval(elapsedTimer)
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten
    api.onFileEditorSave(async ({ status, directory, remote, error }) => {
      if (disposed) return
      if (remote) {
        const [site, path] = remote
        if (status === 'started') addLog(t('edit_upload_started', [site, path]), 'command')
        if (status === 'saved') addLog(t('edit_upload_saved', [site, path]), 'success')
        if (status === 'failed') addLog(t('edit_upload_failed', [site, path, error]), 'error')
      }
      if (status !== 'saved') return
      const current = stateRef.current
      try {
        if (!remote && directory === current.localDir) await api.localList(current.localDir)
        if (remote && current.connected && directory === current.remoteDir) await api.remoteList(current.remoteDir)
      } catch (problem) {
        showNotice(errorMessage(problem))
      }
    }).then(stop => {
      if (disposed) stop()
      else unlisten = stop
    }).catch(problem => showNotice(errorMessage(problem)))
    return () => { disposed = true; unlisten?.() }
  }, [])

  useEffect(() => { uiPref.set('startupTree', showTree) }, [showTree])
  useEffect(() => { uiPref.set('startupBottom', showBottom) }, [showBottom])
  useEffect(() => { uiPref.set('startupQuickbar', showQuick) }, [showQuick])
  useEffect(() => { uiPref.set('startupHeaderbar', showHeader) }, [showHeader])
  useEffect(() => { uiPref.set('bottomTab', bottomTab) }, [bottomTab])
  useEffect(() => { uiPref.set('syncBrowse', syncBrowse) }, [syncBrowse])

  useEffect(() => {
    const siteLabel = currentSite?.name || (currentSite?.host
      ? `${currentSite.host}${currentSite.port ? `:${currentSite.port}` : ''}`
      : '')
    const title = connected && siteLabel ? `${siteLabel} — Rust Flash Ftp` : 'Rust Flash Ftp'
    document.title = title
    api.setWindowTitle(title).catch(() => {})
  }, [connected, currentSite])

  actionsRef.current = { quickConnect: runQuickConnect, enqueue, comparePanes, navLocal, paneAction, refreshLocal, refreshRemote, activateLocal, activateRemote, remoteUp, localUp }

  // 菜单里标注的快捷键需要真实生效：F4/F5/F6/F7/F8、Delete、Backspace、Enter、Escape
  // 无依赖数组 → 每次渲染后重新注册，闭包内状态始终是最新值
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const dialogOpen = siteManagerOpen || proxyManagerOpen || relayOpen || optionsOpen || aboutOpen || !!update || bookmarkOpen || filtersOpen || !!prompt || !!deleteConfirmation || !!quickConnectDraft
      if (e.key === 'Escape') {
        if (dialogOpen) {
          setSiteManagerOpen(false); setProxyManagerOpen(false); setRelayOpen(false)
          setAboutOpen(false); closeUpdate(); setBookmarkOpen(false); setFiltersOpen(false); setPrompt(null); setDeleteConfirmation(null); setQuickConnectDraft(null); setNewSiteDraft(null)
        }
        return
      }
      if (!typing && !dialogOpen && e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        document.querySelector(`[data-bookmark-pane="${activePane}"]`)?.click()
        return
      }
      if (dialogOpen) return
      if (e.key === 'F5' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        actionsRef.current.refreshLocal()
        actionsRef.current.refreshRemote()
        return
      }
      if (e.key === 'F8' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        openQuickConnect()
        return
      }
      if (typing) return
      if (e.metaKey && !e.ctrlKey && !e.altKey && e.key === 'Backspace') {
        e.preventDefault()
        actionsRef.current.paneAction(activePane, 'delete')
        return
      }
      if (!ctxMenu.menu && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.target?.closest?.('[data-file-list]')) {
        const key = e.key.toLowerCase()
        if (key === 'v' || key === 'e') {
          e.preventDefault()
          actionsRef.current.paneAction(activePane, key === 'v' ? 'view' : 'edit')
          return
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const a = actionsRef.current
      switch (e.key) {
        case 'F12': e.preventDefault(); api.newSession().catch(e => showNotice(errorMessage(e))); break
        case 'F4': e.preventDefault(); setSiteManagerOpen(true); break
        case 'F6': e.preventDefault(); setOptionsOpen(true); break
        case 'F7': e.preventDefault(); a.paneAction('local', 'mkdir'); break
        case 'Delete': e.preventDefault(); a.paneAction(activePane, 'delete'); break
        case 'Backspace':
          e.preventDefault()
          if (activePane === 'remote') a.remoteUp(); else a.localUp()
          break
        case 'Enter':
          e.preventDefault()
          if (activePane === 'remote') a.activateRemote(remoteSel)
          else a.activateLocal(localSel)
          break
        default: {
          if (ctxMenu.menu || e.isComposing || !/^[\p{L}\p{N}]$/u.test(e.key)) break
          const list = e.target?.closest?.('[data-file-list]')
          if (!list) break
          const pane = list.dataset.fileList
          const remote = pane === 'remote'
          const entries = remote ? sortedRemote : sortedLocal
          const selection = remote ? remoteSelection : localSelection
          const path = remote ? remoteDir : localDir
          const current = listSearch.current
          const now = Date.now()
          const letter = e.key.toLocaleLowerCase(language)
          const recent = current?.pane === pane && current.path === path && now - current.time < 800
          const cycle = recent && current.prefix === letter
          const prefix = recent && !cycle ? current.prefix + letter : letter
          listSearch.current = { pane, path, time: now, prefix }

          const matches = entry => entry.name.normalize('NFC').toLocaleLowerCase(language).startsWith(prefix)
          const selected = selectedIndex(entries, selection?.names.at(-1))
          let index = cycle && selected != null
            ? entries.findIndex((entry, i) => i > selected && matches(entry))
            : -1
          if (index < 0) index = entries.findIndex(matches)
          if (index < 0) break

          e.preventDefault()
          const select = remote ? setRemoteSel : setLocalSel
          select(index)
          list.querySelectorAll('[data-file-row]')[index]?.scrollIntoView({ block: 'nearest' })
          break
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  // ---- DEV：UI 自动化驱动 ----
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__fxDrive = (cmd) => {
      const [op, ...args] = cmd.split(':')
      const a = () => actionsRef.current
      switch (op) {
        case 'open':
          if (args[0] === 'site') setSiteManagerOpen(true)
          if (args[0] === 'proxy') setProxyManagerOpen(true)
          if (args[0] === 'relay') setRelayOpen(true)
          if (args[0] === 'about') setAboutOpen(true)
          if (args[0] === 'options') setOptionsOpen(true)
          if (args[0] === 'prompt') askPrompt(t("new_local_folder"), '', () => {})
          if (args[0] === 'queue') setShowBottom(true)
          break
        case 'close':
          setSiteManagerOpen(false); setProxyManagerOpen(false)
          setRelayOpen(false); setAboutOpen(false); setOptionsOpen(false); setPrompt(null)
          document.dispatchEvent(new Event('fx-close-menus'))
          break
        case 'menu': {
          const name = cmd.slice(5)
          const el = [...document.querySelectorAll('.fx-menu-top')].find(b => b.textContent.trim() === name)
          el?.click()
          break
        }
        case 'click': {
          const label = cmd.slice(6)
          const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label)
          el?.click()
          break
        }
        case 'menuitem': {
          const label = cmd.slice(9)
          const el = [...document.querySelectorAll('.fx-menu-popup .fx-menu-row, .fx-ctx .fx-menu-row')]
            .find(b => b.querySelector('.fx-menu-label')?.textContent.trim() === label)
          el?.click()
          break
        }
        case 'ctxitem': {
          const label = cmd.slice(8)
          const el = [...document.querySelectorAll('.fx-ctx .fx-menu-row')]
            .find(b => b.querySelector('.fx-menu-label')?.textContent.trim() === label)
          el?.click()
          break
        }
        case 'tool': {
          const t = cmd.slice(5)
          const el = [...document.querySelectorAll('.fx-tool-btn, .fx-address-icon')].find(b => b.title === t)
          el?.click()
          break
        }
        case 'quick': setShowQuick(args[0] !== 'off'); break
        case 'key':
          document.dispatchEvent(new KeyboardEvent('keydown', { key: cmd.slice(4), bubbles: true, cancelable: true }))
          break
        case 'delsite': {
          const name = cmd.slice(8)
          api.sites().then(list => { const s = list.find(x => x.name === name); if (s) api.deleteSite(s.id) }).catch(() => {})
          break
        }
        case 'delproxy': {
          const name = cmd.slice(9)
          api.proxies().then(list => { const p = list.find(x => x.name === name); if (p) api.deleteProxy(p.id) }).catch(() => {})
          break
        }
        case 'combo': {
          const wraps = document.querySelectorAll('.fx-address-combo-wrap')
          wraps[args[0] === 'right' ? 1 : 0]?.querySelector('.caret')?.click()
          break
        }
        case 'addrgo': {
          const side = args[0] === 'right' ? 1 : 0
          const path = cmd.split(':').slice(2).join(':')
          const inp = document.querySelectorAll('.fx-address-combo-wrap input')[side]
          if (inp) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp, path)
            inp.dispatchEvent(new Event('input', { bubbles: true }))
            inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
          }
          break
        }
        case 'treectx': {
          const row = document.querySelectorAll('.fx-tree-row')[Number(args[0] || 0)]
          if (row) row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 180, clientY: 240 }))
          break
        }
        case 'fill': {
          const rest = cmd.slice(5)
          const idx = Number(rest.split(':')[0])
          const val = rest.slice(rest.indexOf(':') + 1)
          const el = document.querySelectorAll('.fx-dialog input')[idx]
          if (el) {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)
            el.dispatchEvent(new Event('input', { bubbles: true }))
          }
          break
        }
        case 'reset':
          setSiteManagerOpen(false); setProxyManagerOpen(false); setRelayOpen(false)
          setAboutOpen(false); closeUpdate(); setBookmarkOpen(false); setFiltersOpen(false); setPrompt(null)
          setShowTree(true); setShowBottom(true); setBottomTab('both')
          setShowQuick(true); setSyncBrowse(false)
          api.homeDir().then(p => { if (p) api.localList(p) }).catch(() => {})
          document.dispatchEvent(new Event('fx-close-menus'))
          break
        case 'quickfill': {
          const [host, port, user, pass] = cmd.slice(10).split(':')
          setQc({ host, port, user, pass, protocol: 'ftp' })
          setTimeout(() => a().quickConnect({ host, port: port || '21', user: user || '', pass: pass || '' }), 100)
          break
        }
        case 'connect': a().quickConnect(); break
        case 'site': api.connectSite(Number(args[0])).catch(e => showNotice(String(e))); break
        case 'enqueue': a().enqueue(args[0], args[1], args[2] === 'dir'); break
        case 'compare': a().comparePanes(); break
        case 'tab': setBottomTab(args[0] === 'both' ? 'both' : args[0]); setShowBottom(true); break
        case 'sync': setSyncBrowse(args[0] !== 'off'); break
        case 'tree': setShowTree(args[0] !== 'off'); break
        case 'bottom': setShowBottom(args[0] !== 'off'); break
        case 'nav': a().navLocal(cmd.slice(4)); break
        case 'rnav': api.remoteList(cmd.slice(5)); break
        case 'rdelete': api.deleteRemote([cmd.slice(8)]); break
        case 'sel': {
          const set = args[0] === 'local' ? setLocalSel : setRemoteSel
          set(Number(args[1]))
          break
        }
        case 'selname': {
          const pane = args[0]
          const name = cmd.split(':').slice(2).join(':')
          // 驱动 effect 注册于首次渲染，列表必须走 ref 取最新值
          const list = pane === 'remote' ? stateRef.current.sortedRemote : stateRef.current.sortedLocal
          const i = (list || []).findIndex(e => e.name === name)
          if (i >= 0) {
            if (pane === 'remote') { setRemoteSel(i); setActivePane('remote') }
            else { setLocalSel(i); setActivePane('local') }
          }
          break
        }
        case 'act': a().paneAction(args[0], cmd.split(':').slice(2).join(':')); break
        case 'activate': {
          const f = args[0] === 'local' ? a().activateLocal : a().activateRemote
          f(Number(args[1]))
          break
        }
        case 'dbg': {
          const el = document.querySelector('[data-slot="dialog-content"]')
          const info = { found: !!el }
          if (el) {
            const cs = getComputedStyle(el)
            const r = el.getBoundingClientRect()
            info.cls = el.className
            info.pos = cs.position; info.top = cs.top; info.left = cs.left
            info.rect = { x: r.x, y: r.y, w: r.width, h: r.height }
            info.vw = innerWidth; info.vh = innerHeight
          }
          fetch('http://127.0.0.1:5199/report?d=' + encodeURIComponent(JSON.stringify(info))).catch(() => {})
          break
        }
        case 'state': {
          // DEV 诊断：从 DOM 回读当前功能状态（供自动化回归验证）
          const q = (s) => [...document.querySelectorAll(s)]
          const txt = (e) => (e?.innerText || '').replace(/\s*\n\s*/g, ' | ').replace(/\s*\t\s*/g, ' ').trim()
          const info = {
            title: document.title,
            focus: document.activeElement?.id || document.activeElement?.tagName || '',
            addresses: q('.fx-address-combo input').map(i => i.value),
            stats: q('.fx-main .fx-stat').map(txt),
            lists: q('.fx-main .listview').map(t => ({
              rows: t.querySelectorAll('tbody tr').length,
              sample: [...t.querySelectorAll('tbody tr')].slice(0, 5).map(txt),
            })),
            listNames: q('.fx-main .listview').map(t => [...t.querySelectorAll('tbody tr td:first-child .fx-cell-name')].map(txt)),
            queueRows: q('.fx-queue tbody tr').length,
            queueSample: q('.fx-queue tbody tr').slice(0, 5).map(txt),
            queueHeads: q('.fx-queue thead th').map(txt),
            logTail: q('.fx-log-line').slice(-6).map(txt),
            status: q('.fx-status-cell').map(txt),
            dialogs: q('[data-slot="dialog-content"] [data-slot="dialog-title"]').map(txt),
            menuPopup: q('.fx-menu-popup').map(txt),
            ctxMenu: q('.fx-ctx').map(txt),
            topMenus: q('.fx-menu-top').map(txt),
            menuItems: q('.fx-menu-popup .fx-menu-row, .fx-ctx .fx-menu-row').map(b => ({
              label: txt(b.querySelector('.fx-menu-label')),
              disabled: !!b.disabled,
              checked: !!b.querySelector('.fx-menu-check')?.innerText.trim(),
              key: txt(b.querySelector('.fx-menu-key')),
              scope: b.closest('.fx-ctx') ? 'ctx' : 'menu',
            })),
            toolButtons: q('.fx-toolbar .fx-tool-btn, .fx-address-icon').map(b => ({
              title: b.title, disabled: !!b.disabled, pressed: b.classList.contains('fx-pressed'),
            })),
            dialogButtons: q('[data-slot="dialog-content"] button').map(b => ({ label: txt(b), disabled: !!b.disabled })),
            dialogList: q('[data-slot="dialog-content"] .fx-listbox-row').map(txt),
            comboPopup: q('.fx-combo-item').map(txt),
            comboEmpty: !!document.querySelector('.fx-combo-empty'),
            tabButtons: q('.fx-tab').map(b => ({ label: txt(b), active: b.classList.contains('fx-active') })),
            notice: q('.fx-status-cell.grow').map(txt)[0] || '',
            marks: q('.fx-mark').length,
            treeNodes: q('.fx-tree-row').length,
            tabs: q('.fx-tab.fx-active').map(txt),
            bottomVisible: !!document.querySelector('.fx-bottom'),
            treeVisible: !!document.querySelector('.fx-tree'),
            quickVisible: !!document.querySelector('.fx-quickbar'),
            syncPressed: !!document.querySelector('.fx-tool-btn.fx-pressed'),
          }
          fetch('http://127.0.0.1:5199/report?d=' + encodeURIComponent(JSON.stringify(info))).catch(() => {})
          break
        }
        case 'reload': window.location.reload(); break
        case 'refresh': a().refreshLocal(); a().refreshRemote(); break
        case 'rmenu': {
          const rows = document.querySelectorAll('.listview tbody tr')
          const el = rows[Number(args[0] || 0)]
          if (el) el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))
          break
        }
        case 'rmenubg': {
          const pane = document.querySelectorAll('.fx-list-wrap')[Number(args[0] || 0)]
          if (pane) pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 }))
          break
        }
      }
    }
    let last = ''
    const elapsedTimer = setInterval(async () => {
      try {
        const r = await fetch('http://127.0.0.1:5199/cmd', { cache: 'no-store' })
        const cmd = (await r.text()).trim()
        if (cmd && cmd !== last) { last = cmd; window.__fxDrive(cmd) }
      } catch {}
    }, 400)
    return () => { clearInterval(elapsedTimer); delete window.__fxDrive }
  }, [])

  const activeCount = queue.filter(q => q.status === 'active').length
  const waitingCount = queue.filter(q => q.status === 'waiting').length
  const doneCount = queue.filter(q => q.status === 'done').length
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  // ---- 菜单：仅保留已实现的功能 ----
  const menus = [
    { name: t("session_e"), items: [
      { label: t('new_session'), key: 'F12', act: () => api.newSession().catch(e => showNotice(errorMessage(e))) },
      { label: t("quick_connect"), key: 'F8', act: () => openQuickConnect() },
      { label: t("connect_to_site"), key: 'F4', act: () => setSiteManagerOpen(true) },
      { sep: true },
      { label: t("disconnect_d"), act: () => api.disconnect(), disabled: !connected },
      { label: t("disconnect_all"), act: () => api.disconnect(), disabled: !connected },
      { sep: true },
      { label: t("exit_x"), key: '⌘Q', act: () => api.appExit() },
    ]},
    { name: t("sites_s"), items: [
      { label: t("site_manager"), key: 'F4', act: () => setSiteManagerOpen(true) },
      { label: t("site_to_site_transfer_r"), act: () => setRelayOpen(true), disabled: !connected },
    ]},
    { name: t("options_o"), items: [
      { label: t('language'), items: [
        { label: '简体中文', checked: language === 'zh-CN', act: () => setLanguage('zh-CN') },
        { label: 'English', checked: language === 'en', act: () => setLanguage('en') },
      ] },
      { label: t("preferences"), key: 'F6', act: () => setOptionsOpen(true) },
      { label: t("proxy_settings_p"), act: () => setProxyManagerOpen(true) },
      { label: t('filters') + '…', act: () => setFiltersOpen(true) },
    ]},
    { name: t("queue_z"), items: [
      { label: t("show_hide_queue_and_log"), act: () => setShowBottom(v => !v) },
      { label: t("resume_pending"), act: resumeRestored },
      { label: t("cancel_waiting_transfers"), act: cancelWaiting },
      { label: t("clear_completed"), act: clearFinished },
    ]},
    { name: t("tools_t"), items: [
      { label: t("compare_folders"), act: comparePanes, disabled: !connected },
      { label: t("clear_comparison_marks"), act: () => { setLocalMarks({}); setRemoteMarks({}) } },
      { sep: true },
      { label: t("synchronized_browsing"), checked: syncBrowse, act: () => setSyncBrowse(v => !v) },
    ]},
    { name: t("directory_d"), items: [
      { label: t("new_folder"), key: 'F7', act: () => paneAction('local', 'mkdir') },
      { label: t("rename_2"), act: () => paneAction('local', 'rename') },
      { label: t("delete"), key: 'Del', act: () => paneAction(activePane, 'delete') },
      { sep: true },
      { label: t("refresh_f5"), key: 'F5', act: () => { refreshLocal(); refreshRemote() } },
    ]},
    { name: t("view_v"), items: [
      { label: t("active_file_edits"), act: () => api.showFileEditor({ action: 'manage', ...editorPreferences(), entries: [] }).catch(problem => showNotice(errorMessage(problem))) },
      { label: t("directory_tree"), checked: showTree, act: () => setShowTree(v => !v) },
      { label: t("queue_and_log_windows"), checked: showBottom, act: () => setShowBottom(v => !v) },
      { label: t("quick_connect_bar"), checked: showQuick, act: () => setShowQuick(v => !v) },
      { label: t("header_status_bar"), checked: showHeader, act: () => setShowHeader(v => !v) },
    ]},
    { name: t("help_h"), items: [
      { label: t("check_for_updates"), act: checkUpdate },
      { label: t("about_rust_flash_ftp"), act: () => setAboutOpen(true) },
    ]},
  ]

  const gridCols = showTree ? '360px minmax(0, 1fr) minmax(0, 1.25fr)' : 'minmax(0, 1fr) minmax(0, 1.25fr)'
  const leftCol = showTree ? '1 / 3' : '1 / 2'
  const rightCol = showTree ? '3 / 4' : '2 / 3'
  return (
    <div className="fx-app">
      <FxIconDefs />
      {/* ===== 菜单栏（窗口装饰交给 macOS 原生） ===== */}
      <WinMenuBar menus={menus} />

      {/* ===== 头部状态栏：会话状态 + 各功能入口（查看 > 头部状态栏 可显隐） ===== */}
      {showHeader && <div className="fx-headerbar">
        <button className="fx-header-cell" title={t("site_manager_2")} onClick={() => setSiteManagerOpen(true)}>
          <Ico name={connected ? 'connected' : 'miniComputer'} size={14} />
          {connected
            ? `${currentSite ? (currentSite.name || `${currentSite.host}:${currentSite.port}`) : t("connected")}${currentSite && currentSite.user ? `（${currentSite.user}）` : ''}`
            : t("disconnected_click_to_select_a_site")}
        </button>
        <button className="fx-header-cell" title={t("proxy_manager")} onClick={() => setProxyManagerOpen(true)}>
          <Ico name="globe" size={14} /> {t("proxy")} </button>
        <button className="fx-header-cell" title={t("site_to_site_transfer")} disabled={!connected} onClick={() => setRelayOpen(true)}>
          <Ico name="folderTransfer" size={14} /> {t("site_transfer")} </button>
        <div className="fx-header-spacer" />
        <button className="fx-header-cell" title={t("open_queue_window")}
                onClick={() => { setShowBottom(true); setBottomTab('queue') }}>
          <Ico name="playDrop" size={14} /> {t("queue")} {formatNumber(activeCount)} {t("active")} {formatNumber(waitingCount)} {t("waiting")} </button>
        <button className="fx-header-cell" title={t("open_log_window")}
                onClick={() => { setShowBottom(true); setBottomTab('log') }}> {t("log")} </button>
        <button className="fx-header-cell" title={t("preferences_2")} onClick={() => setOptionsOpen(true)}> {t("options")} </button>
      </div>}

      {/* ===== 工具栏（左：本地浏览器 / 右：连接与传输） ===== */}
      <div className="fx-toolbar">
        <span className="fx-tool-caption">{t("local_browser")}</span>
        <div className="fx-tool-group">
          <WinToolButton icon="pause" size={28} title={t("clear_completed_transfers")} onClick={clearFinished} />
          <WinToolButton icon="playDrop" size={28} title={t("resume_pending_transfers")} onClick={resumeRestored} />
          <WinToolButton icon="greenRefreshDoc" size={31} title={t("compare_folders")} disabled={!connected} onClick={comparePanes} />
          <WinToolButton icon="blueRefresh" size={31} title={t("synchronized_browsing_on_off")} pressed={syncBrowse}
                         onClick={() => setSyncBrowse(v => !v)} />
          <WinToolButton icon="home" size={33} title={t("local_home_directory")} onClick={() => homePath && navLocal(homePath)} />
        </div>
        <div className="fx-tool-spacer" />
        <div className="fx-tool-group right">
          <div className="fx-tool-connect">
            <WinToolButton icon="connect" size={35} big title={t("connect_quick_connect_site")}
                           pressed={connectMenuOpen} onClick={toggleConnectMenu} />
            {connectMenuOpen && (
              <div className="fx-menu-popup fx-connect-menu">
                <button className="fx-menu-row" onClick={() => openQuickConnect()}>
                  <span className="fx-menu-check" />
                  <span className="fx-menu-label">{t("quick_connect")}</span>
                </button>
                <button className="fx-menu-row" onClick={() => { setConnectMenuOpen(false); setSiteManagerOpen(true) }}>
                  <span className="fx-menu-check" />
                  <span className="fx-menu-label">{t("site_manager")}</span>
                </button>
                {quickHistory.length > 0 && <>
                  <div className="fx-menu-sep" />
                  <div className="px-3 py-1 text-xs text-muted-foreground">{t('quick_connect_history')}</div>
                  {quickHistory.slice(0, 5).map(entry => (
                    <button key={quickHistoryKey(entry)} className="fx-menu-row" onClick={() => openQuickConnect(entry)}>
                      <span className="fx-menu-check" />
                      <span className="fx-menu-label">{quickAddress(entry)}</span>
                      <span className="fx-menu-key">{entry.user}</span>
                    </button>
                  ))}
                </>}
                {connectSites.length > 0 && <div className="fx-menu-sep" />}
                {connectSites.map(s => (
                  <button key={s.id} className="fx-menu-row" onClick={() => connectFromMenu(s)}>
                    <span className="fx-menu-check" />
                    <span className="fx-menu-label">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <WinToolButton icon="disconnect" size={35} big title={t("disconnect")} disabled={!connected}
                         onClick={() => api.disconnect()} />
          <WinToolButton icon="cancel" size={33} big title={t("cancel_waiting_transfers")} onClick={cancelWaiting} />
          <WinToolButton icon="playBig" size={33} big title={t("resume_pending_transfers")} onClick={resumeRestored} />
          <WinToolButton icon="folderTransfer" size={33} big title={t("site_to_site_transfer")} disabled={!connected}
                         onClick={() => setRelayOpen(true)} />
          <WinToolButton icon="blueRefresh" size={34} big title={t("refresh_both_panes")}
                         onClick={() => { refreshLocal(); refreshRemote() }} />
          <WinToolButton icon="globe" size={34} big title={t("site_manager_2")} onClick={() => setSiteManagerOpen(true)} />
        </div>
      </div>

      {/* ===== 快速连接栏（查看 > 快速连接栏 可显隐） ===== */}
      {showQuick && <div className="fx-quickbar">
        <span className="fx-q-label">{t("quick_connect_2")}</span>
        <span className="fx-q-field">{t("server_or_url")}</span>
        <WinInput id="qc-host" style={{ flex: '1.6', minWidth: 90 }} placeholder="ftp.example.com"
                  value={qc.host} onChange={(e) => setQc({ ...qc, host: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && runQuickConnect()} />
        <span className="fx-q-field">{t("port")}</span>
        <WinInput style={{ width: 50 }} value={qc.port}
                  onChange={(e) => setQc({ ...qc, port: e.target.value.replace(/\D/g, '') })} />
        <span className="fx-q-field">{t("username")}</span>
        <WinInput style={{ width: 120 }} placeholder="anonymous" value={qc.user}
                  onChange={(e) => setQc({ ...qc, user: e.target.value })} />
        <span className="fx-q-field">{t("password")}</span>
        <WinInput style={{ width: 100 }} type="password" value={qc.pass}
                  onChange={(e) => setQc({ ...qc, pass: e.target.value })} />
        <WinButton compact className="shrink-0 gap-2 px-3" onClick={() => runQuickConnect()} disabled={!qc.host.trim()}>
          <Ico name="app" size={13} /> {t("connect")} </WinButton>
        <span className="fx-tool-sep" />
        <WinCheck checked={syncBrowse} onChange={setSyncBrowse} label={t("synchronized_browsing")} />
      </div>}

      {/* ===== 地址栏（左：本地 / 右：远程） ===== */}
      <div className="fx-address-row" style={{ gridTemplateColumns: gridCols }}>
        <div className="fx-address-cell left" style={{ gridColumn: leftCol }}>
          <IconTip title={t("site_manager_2")}><button className="fx-address-icon" onClick={() => setSiteManagerOpen(true)}><Ico name="miniComputer" size={17} /></button></IconTip>
          <IconTip title={t('bookmarks')}><button className="fx-address-icon" data-bookmark-pane="local" aria-label={t('bookmarks')} onClick={openBookmarks}><Ico name="star" size={17} /></button></IconTip>
          <IconTip title={t("parent_directory")}><button className="fx-address-icon" onClick={localUp}><Ico name="greenUp" size={17} /></button></IconTip>
          <AddressCombo value={localDir} onGo={navLocal} history={localHistory} />
        </div>
        <div className="fx-address-cell right" style={{ gridColumn: rightCol }}>
          <IconTip title={t("site_manager_2")}><button className="fx-address-icon" onClick={() => setSiteManagerOpen(true)}><Ico name="miniComputer" size={17} /></button></IconTip>
          <IconTip title={t('bookmarks')}><button className="fx-address-icon" data-bookmark-pane="remote" aria-label={t('bookmarks')} disabled={!connected} onClick={openBookmarks}><Ico name="star" size={17} /></button></IconTip>
          <IconTip title={t("parent_directory")}><button className="fx-address-icon" onClick={remoteUp}><Ico name="greenUp" size={17} /></button></IconTip>
          <AddressCombo value={remoteDir || ''} onGo={(p) => api.remoteList(p)} disabled={!connected} history={remoteHistory} />
        </div>
      </div>

      {/* ===== 主区：目录树 + 本地列表 + 远程列表 ===== */}
      <div className="fx-main" style={{ gridTemplateColumns: gridCols }}>
        {showTree && homePath && <DirTree home={homePath} onNavigate={navLocal}
          currentPath={localDir} onContextMenu={ctxMenu.openMenu} />}
        <FilePane highlightRules={highlightRules} pane="local" title={t("local_browser")} entries={sortedLocal} selectedNames={localNames}
          marks={localMarks} address={localDir} connected={connected} diskFree={diskFree}
          sort={sortLocal} onNavigate={localUp} onRefresh={refreshLocal}
          onFocus={() => { listSearch.current = null; setActivePane('local') }}
          onSelect={(i, options) => { listSearch.current = null; setLocalSel(i, options); setActivePane('local') }}
          onActivate={activateLocal} onAction={(a, target) => paneAction('local', a, target)}
          onAddressGo={navLocal} onHome={() => navLocal(homePath)}
          onContextMenu={ctxMenu.openMenu}
          onDropTransfer={(dir, name, isDir) => enqueue(dir, name, isDir)} />
        <FilePane highlightRules={highlightRules} pane="remote" title={t("remote_browser")}
          entries={sortedRemote} selectedNames={remoteNames}
          marks={remoteMarks} address={remoteDir || ''} connected={connected && !!remoteDir}
          host={currentSite ? `${currentSite.host}` : ''} sort={sortRemote}
          onNavigate={remoteUp} onRefresh={refreshRemote}
          onFocus={() => { listSearch.current = null; setActivePane('remote') }}
          onSelect={(i, options) => { listSearch.current = null; setRemoteSel(i, options); setActivePane('remote') }}
          onActivate={activateRemote} onAction={(a, target) => paneAction('remote', a, target)}
          onAddressGo={(p) => api.remoteList(p)} onHome={() => api.remoteList('/')}
          onContextMenu={ctxMenu.openMenu}
          onDropTransfer={(dir, name, isDir) => enqueue(dir, name, isDir)} />
      </div>

      {/* ===== 底部：队列窗口 / 日志窗口 ===== */}
      {showBottom && (
        <div className="fx-bottom" style={{ height: bottomHeight, maxHeight: '60vh' }}>
          <div className="fx-splitter fx-splitter-horizontal" {...splitterProps('height')} />
          <div className="fx-bottom-tabs">
            <button className={`fx-tab ${bottomTab === 'queue' ? 'fx-active' : ''}`}
                    onClick={() => setBottomTab('queue')}>{t("queue_window")}</button>
            <button className={`fx-tab ${bottomTab === 'log' ? 'fx-active' : ''}`}
                    onClick={() => setBottomTab('log')}>{t("log_window")}</button>
            <button className={`fx-tab ${bottomTab === 'both' ? 'fx-active' : ''}`}
                    onClick={() => setBottomTab('both')} title={t("show_queue_and_log_side_by_side")}>{t("side_by_side")}</button>
            <div className="fx-bottom-tools">
              {queue.some(q => q.restored && q.status === 'waiting') && (
                <WinButton compact onClick={resumeRestored}>{t("resume_pending_2")}</WinButton>
              )}
              <WinButton compact onClick={clearFinished} disabled={!queue.length}>{t("clear_completed")}</WinButton>
              <span className="fx-hint"> {t("transfers")} {formatNumber(activeCount)} {t("waiting_2")} {formatNumber(waitingCount)} {t("completed")} {formatNumber(doneCount)}
              </span>
            </div>
          </div>
          <div className="fx-bottom-body">
            {bottomTab !== 'log' && (
              <div className={`fx-queue fx-scroll ${bottomTab === 'queue' ? '' : ''}`}
                   style={{ flex: bottomTab === 'both' ? `0 0 calc(${queueWidth}% - 3px)` : '1 1 100%', borderRight: bottomTab === 'both' ? undefined : 0 }}>
                <table className="fx-list listview" style={{ tableLayout: 'fixed' }}>
                    <colgroup><col style={{ width: '26%' }} /><col style={{ width: '28%' }} /><col style={{ width: '12%' }} /><col /></colgroup>
                    <thead><tr>
                      <th>{t("name")}</th><th>{t("destination")}</th><th className="fx-th-right">{t("size")}</th><th>{t("notes")}</th>
                    </tr></thead>
                    <tbody>
                      {queue.map((q, i) => (
                        <tr key={q.id} onContextMenu={(e) => ctxMenu.openMenu(e, [
                          { label: t("cancel_transfer"), disabled: q.status !== 'waiting', act: () => api.cancelTransfer(q.id) },
                          { sep: true },
                          { label: t("copy_name"), act: () => navigator.clipboard?.writeText(q.remote) },
                        ])}>
                          <td title={(q.direction === 'upload' ? q.local : q.remote)}>
                            {(q.direction === 'upload' ? q.local : q.remote).split('/').pop()}
                          </td>
                          <td title={q.direction === 'relay' ? q.remote : (q.direction === 'download' ? q.local : q.remote)}>
                            {q.direction === 'relay' ? q.remote : (q.direction === 'download' ? q.local : q.remote)}
                          </td>
                          <td className="fx-num">{humanSize(q.size)}</td>
                          <td>
                            <div className="fx-note">
                              {q.status === 'active' && <div className="fx-progress"><i style={{ width: `${q.size ? Math.min(100, q.transferred / q.size * 100) : 0}%` }} /></div>}
                              <span style={{ color: q.status === 'failed' ? '#c00000' : q.status === 'done' ? '#008000' : '#303030' }}>
                                {q.status === 'waiting' ? (q.restored ? t("awaiting_resume") : t("waiting")) : q.status === 'active' ? t("transferring") : q.status === 'done' ? t("completed_2") : (q.cancelled ? t("cancelled") : t("failed"))}
                              </span>
                              {q.status === 'waiting' && <button className="x" title={t("cancel_transfer")} onClick={() => api.cancelTransfer(q.id)}>✕</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                </table>
              </div>
            )}
            {bottomTab === 'both' && <div className="fx-splitter fx-splitter-vertical" {...splitterProps('width')} />}
            {bottomTab !== 'queue' && (
              <div className="fx-log fx-scroll" style={{ flex: 1 }} onContextMenu={openLogMenu}>
                {log.length ? log.map((l, i) => {
                  const m = l.text.match(/^(\[[^\]]+\])\s*(.*)$/)
                  return (
                    <div className="fx-log-line" key={i}>
                      {m ? <><span className="fx-log-ts">{m[1]}</span> <LogBody text={m[2]} level={l.level} /></> : <LogBody text={l.text} level={l.level} />}
                    </div>
                  )
                }) : <div className="fx-log-line fx-log-info">{t("ready_rust_flash_ftp_started_waiting_for_connection")}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 状态栏 ===== */}
      <div className="fx-statusbar">
        <div className="fx-status-cell" style={{ width: 130 }}>
          <Ico name="statusPc" size={13} /> {connected ? t("connected") : t("idle")} ({mmss})
        </div>
        <div className="fx-status-cell grow">
          {notice || (connected
            ? `${currentSite ? `${currentSite.host}:${currentSite.port}` : ''} — ${remoteDir || '/'}`
            : t("local_browser_value", [localDir || '']))}
        </div>
        <div className="fx-status-cell" style={{ width: language === 'en' ? 210 : 168 }}> {t("queue")} {formatNumber(activeCount)} {t("active")} {formatNumber(waitingCount)} {t("waiting")} </div>
        <div className="fx-status-cell" style={{ width: 74 }}>Flash Ftp</div>
      </div>

      {/* ===== 对话框 ===== */}
      <CredentialsDialog />
      <BookmarkManager open={bookmarkOpen} onOpenChange={setBookmarkOpen} siteId={bookmarkSiteId}
        localPath={localDir || ''} remotePath={connected ? remoteDir || '' : ''} initialAdd={bookmarkMode === 'add'} />
      <FiltersDialog open={filtersOpen} onOpenChange={setFiltersOpen} />
      <QuickConnectDialog initial={quickConnectDraft} history={quickHistory} onConnect={quickConnect}
        onClose={() => setQuickConnectDraft(null)} onSiteDraft={quickSiteDraft}
        onRemoveHistory={key => storeQuickHistory(uiPref.get('quickConnectHistory', []).filter(item => quickHistoryKey(item) !== key))} />
      <SiteManager open={siteManagerOpen} initialSite={newSiteDraft} onOpenChange={open => {
        setSiteManagerOpen(open)
        if (!open) setNewSiteDraft(null)
      }}
        onConnected={(site) => { setCurrentSite(site); applySiteLocalPath(site) }} />
      <ProxyManager open={proxyManagerOpen} onOpenChange={setProxyManagerOpen} />
      <OptionsDialog open={optionsOpen} onOpenChange={setOptionsOpen}
        uiPref={uiPref}
        currentLocalDir={localDir}
        setters={{ setShowQuick, setShowTree, setShowBottom, setShowHeader }} />
      <RelayDialog open={relayOpen} onOpenChange={setRelayOpen}
        currentSite={currentSite} remoteDir={remoteDir} onStart={startRelay} />

      <WinDialog open={!!update} title={t("check_for_updates")} width={430} onClose={closeUpdate}
        footer={<>
          {update?.installerAvailable && !update.opened && (
            <WinButton disabled={updateBusy} onClick={installUpdate}>{t("download_and_install_update")}</WinButton>
          )}
          <WinButton variant="outline" disabled={updateBusy} onClick={closeUpdate}>{t("ok")}</WinButton>
        </>}>
        <div className="space-y-2 text-sm" role="status">
          {update?.checking && <p>{t("checking_github_for_updates")}</p>}
          {update?.currentVersion && <p>{t("update_current_version", [update.currentVersion])}</p>}
          {update?.currentVersion && !update.releasePublished && <p>{t("update_no_release")}</p>}
          {update?.releasePublished && !update.latestVersion && <p>{t("update_already_current")}</p>}
          {update?.latestVersion && <p>{t("update_latest_version", [update.latestVersion])}</p>}
          {update?.latestVersion && !update.installerAvailable && <p>{t("update_installer_unavailable")}</p>}
          {update?.downloading && <p>{t("update_downloading")}</p>}
          {update?.opened && <p>{t("update_installer_opened")}</p>}
          {update?.error && <p className="break-words text-destructive">{t(update.latestVersion ? "update_install_failed" : "update_check_failed", [update.error])}</p>}
        </div>
      </WinDialog>

      <WinDialog open={aboutOpen} title={t("about_rust_flash_ftp_2")} width={380} onClose={() => setAboutOpen(false)}
        footer={<WinButton onClick={() => setAboutOpen(false)}>{t("ok")}</WinButton>}>
        <div className="fx-about-logo">
          <AppLogo size={48} />
          <div>
            <h2>Rust Flash Ftp</h2>
            <p>{t("version_value_rust_edition", [appVersion])}<br />{t("ftp_ftps_sftp_client")}<br />Rust (Tauri 2) + React</p>
          </div>
        </div>
        <WinFieldset legend={t("features")}>
          <div className="fx-hint"> {t("ftp_ftps_sftp_site_management_proxies_dual_panes_transfer_resume")}<br /> {t("persistent_queue_synchronized_browsing_directory_comparison_site_transfers")} </div>
        </WinFieldset>
      </WinDialog>

      <WinDialog open={!!prompt} title={prompt?.title || ''} width={330} onClose={() => setPrompt(null)}
        footer={<>
          <WinButton variant="outline" onClick={() => setPrompt(null)}>{t("cancel")}</WinButton>
          <WinButton onClick={() => { if (prompt) { prompt.apply(prompt.value); setPrompt(null) } }}>{t("ok")}</WinButton>
        </>}>
        <WinInput autoFocus style={{ width: '100%' }} value={prompt?.value || ''}
          onChange={(e) => setPrompt(p => ({ ...p, value: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter' && prompt) { prompt.apply(prompt.value); setPrompt(null) } }} />
      </WinDialog>

      <WinDialog open={!!deleteConfirmation} title={t("delete")} width={330}
        onClose={() => setDeleteConfirmation(null)}
        footer={<>
          <WinButton variant="outline" onClick={() => setDeleteConfirmation(null)}>{t("cancel")}</WinButton>
          <WinButton onClick={() => {
            const confirmation = deleteConfirmation
            setDeleteConfirmation(null)
            void confirmation?.remove()
          }}>{t("delete")}</WinButton>
        </>}>
        {deleteConfirmation && (deleteConfirmation.selected.length === 1
          ? t("delete_value", [deleteConfirmation.selected[0].name])
          : t("delete_items_value", [deleteConfirmation.selected.length]))}
      </WinDialog>

      <WinContextMenu menu={ctxMenu.menu} onClose={ctxMenu.closeMenu} />
    </div>
  )
}
