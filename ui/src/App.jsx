import CredentialsDialog from './components/CredentialsDialog.jsx'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import FilePane from './components/FilePane.jsx'
import DirTree from './components/DirTree.jsx'
import SiteManager from './components/SiteManager.jsx'
import ProxyManager from './components/ProxyManager.jsx'
import RelayDialog from './components/RelayDialog.jsx'
import OptionsDialog from './components/OptionsDialog.jsx'
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
        <button type="button" className="caret" disabled={disabled} title="路径历史"
                onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(v => !v)}>▼</button>
      </div>
      {open && !disabled && (
        <div className="fx-combo-popup fx-scroll">
          {history.length
            ? history.map(p => <button key={p} className="fx-combo-item" title={p} onClick={() => pick(p)}>{p}</button>)
            : <div className="fx-combo-empty">（暂无历史路径）</div>}
        </div>
      )}
    </div>
  )
}

function LogBody({ text }) {
  let cls = 'fx-log-info'
  if (/失败|错误|拒绝|超时/.test(text)) cls = 'fx-log-err'
  else if (/完成|已连接|成功|就绪|已启动|OK|220|150|226/.test(text)) cls = 'fx-log-ok'
  else if (/队列|列表|连接|PASV|MLSD|LIST|传输/.test(text)) cls = 'fx-log-cmd'
  return <span className={cls}>{text}</span>
}

export default function App() {
  // ---- UI 配置持久化（localStorage；须在所有使用它的 useState 之前） ----
  const uiPref = {
    get: (k, d) => {
      try { const v = localStorage.getItem('fx.ui.' + k); return v === null ? d : JSON.parse(v) } catch { return d }
    },
    set: (k, v) => { try { localStorage.setItem('fx.ui.' + k, JSON.stringify(v)) } catch {} },
  }

  const [connected, setConnected] = useState(false)
  const [currentSite, setCurrentSite] = useState(null)
  const [homePath, setHomePath] = useState('')

  const [localDir, setLocalDir] = useState('')
  const [localEntries, setLocalEntries] = useState([])
  const [localSel, setLocalSel] = useState(null)
  const [diskFree, setDiskFree] = useState(0)

  const [remoteDir, setRemoteDir] = useState(null)
  const [remoteEntries, setRemoteEntries] = useState([])
  const [remoteSel, setRemoteSel] = useState(null)
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
  const [showTree, setShowTree] = useState(() => uiPref.get('startupTree', true))
  const [showQuick, setShowQuick] = useState(() => uiPref.get('startupQuickbar', true))
  const [showHeader, setShowHeader] = useState(() => uiPref.get('startupHeaderbar', true))
  const [siteManagerOpen, setSiteManagerOpen] = useState(false)
  const [proxyManagerOpen, setProxyManagerOpen] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [connectMenuOpen, setConnectMenuOpen] = useState(false)
  const [connectSites, setConnectSites] = useState([])

  const [qc, setQc] = useState({ host: '', port: '21', user: '', pass: '' })
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
  const bootLogged = useRef(false) // StrictMode 下避免启动日志重复
  const ctxMenu = useWinContextMenu()

  const addLog = (text) => {
    const now = new Date()
    const p = (x) => String(x).padStart(2, '0')
    setLog(l => [...l.slice(-499), `[${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}] ${text}`])
  }

  // ---- 排序 ----
  const sortEntries = (entries, st) => {
    const v = [...entries]
    const dirOf = (e) => (e.isDir ? 0 : 1)
    const cmp = {
      name: (a, b) => dirOf(a) - dirOf(b) || a.name.localeCompare(b.name, 'zh-Hans-CN'),
      size: (a, b) => dirOf(a) - dirOf(b) || a.size - b.size,
      time: (a, b) => dirOf(a) - dirOf(b) || (a.mtime || 0) - (b.mtime || 0),
    }[st.key]
    v.sort(cmp)
    if (st.desc) v.reverse()
    return v
  }
  const sortedLocal = useMemo(() => sortEntries(localEntries, sortLocal), [localEntries, sortLocal])
  const sortedRemote = useMemo(() => sortEntries(remoteEntries, sortRemote), [remoteEntries, sortRemote])
  // 排序结果需在定义之后再写入 ref（早于此处引用会触发 TDZ 白屏）
  stateRef.current.sortedLocal = sortedLocal
  stateRef.current.sortedRemote = sortedRemote

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
        addLog('已连接站点')
        showNotice('已连接')
        restoreQueue()
      } else if (p === 'Disconnected') {
        setConnected(false)
        setCurrentSite(null)
        setRemoteDir(null)
        setRemoteEntries([])
        setRemoteSel(null)
        addLog('已断开')
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
      addLog(`列表完成: ${p.RemoteList.path} (${p.RemoteList.entries.length} 项)`)
    } else if (p.Notify) {
      showNotice(p.Notify.text)
      if (p.Notify.level === 'error') addLog(`错误: ${p.Notify.text}`)
    } else if (p.TransferStarted) {
      setQueue(qs => qs.map(q => q.id === p.TransferStarted.id
        ? { ...q, size: p.TransferStarted.size, status: 'active' } : q))
    } else if (p.TransferProgress) {
      setQueue(qs => qs.map(q => q.id === p.TransferProgress.id
        ? { ...q, transferred: p.TransferProgress.transferred } : q))
    } else if (p.TransferFinished) {
      setQueue(qs => qs.map(q => q.id === p.TransferFinished.id
        ? { ...q, status: p.TransferFinished.ok ? 'done' : 'failed', error: p.TransferFinished.error || '' } : q))
      if (p.TransferFinished.ok) {
        addLog('传输完成')
        showNotice('传输完成')
        if (stateRef.current.localDir) api.localList(stateRef.current.localDir)
        if (stateRef.current.remoteDir) api.remoteList(stateRef.current.remoteDir)
      } else {
        addLog(`传输失败: ${p.TransferFinished.error || ''}`)
        showNotice(`传输失败: ${p.TransferFinished.error || ''}`)
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
        showNotice(`已恢复 ${items.length} 个待传任务（需手动恢复传输）`)
      }
    } catch {}
  }

  const resumeRestored = () => {
    const items = queue.filter(q => q.restored && q.status === 'waiting')
    if (!items.length) { showNotice('没有待恢复的任务'); return }
    for (const it of items) {
      api.enqueue({
        id: it.id, direction: it.direction,
        remotePath: it.remote, localPath: it.local, isDir: it.isDir,
      })
      setQueue(qs => qs.map(q => q.id === it.id ? { ...q, restored: false } : q))
    }
  }

  // ---- 导航 ----
  const refreshLocal = () => { if (localDir) api.localList(localDir) }
  const refreshRemote = () => { if (remoteDir) api.remoteList(remoteDir) }
  const navLocal = (path) => api.localList(path)
  // 连接已保存站点后，若配置了本地初始路径则切换本地面板（配置无效时保持现状）
  const applySiteLocalPath = (site) => {
    const p = (site && site.localPath || '').trim()
    if (p) {
      api.treeList(p).then(() => api.localList(p)).catch(e => showNotice(`本地初始目录不可用：${e}`))
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
        else showNotice('同步浏览：远程侧没有同名目录')
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
        else showNotice('同步浏览：本地侧没有同名目录')
      }
    } else {
      enqueue('download', e.name, false)
    }
  }

  // ---- 操作 ----
  const askPrompt = (title, value, apply) => setPrompt({ title, value, apply })

  const paneAction = (which, action, target) => {
    const selIdx = which === 'local' ? localSel : remoteSel
    const entries = which === 'local' ? sortedLocal : sortedRemote
    const sel = target ?? (selIdx != null ? entries[selIdx] : null)
    // 后端命令与列目录走同一条 UiCmd 队列：必须 await 操作命令入队后再刷新，
    // 否则刷新可能先于 mkdir/rename/delete 执行，列表看不到结果（真实时序缺陷）。
    if (action === 'mkdir') {
      askPrompt(which === 'local' ? '新建本地目录' : '新建远程目录', '', async (name) => {
        try {
          if (which === 'local') await api.mkdirLocal(`${localDir}/${name}`)
          else await api.mkdirRemote(remoteJoin(remoteDir, name))
        } catch (e) { showNotice(`创建目录失败: ${e}`); return }
        if (which === 'local') refreshLocal(); else refreshRemote()
      })
    } else if (action === 'rename' && sel) {
      askPrompt('重命名', sel.name, async (name) => {
        try {
          if (which === 'local') await api.renameLocal(`${localDir}/${sel.name}`, `${localDir}/${name}`)
          else await api.renameRemote(remoteJoin(remoteDir, sel.name), remoteJoin(remoteDir, name))
        } catch (e) { showNotice(`重命名失败: ${e}`); return }
        if (which === 'local') refreshLocal(); else refreshRemote()
      })
    } else if (action === 'delete' && sel) {
      if (uiPref.get('confirmDelete', true) && !window.confirm(`删除「${sel.name}」？`)) return
      ;(async () => {
        try {
          if (which === 'local') { await api.deleteLocal([`${localDir}/${sel.name}`]); setLocalSel(null) }
          else { await api.deleteRemote([remoteJoin(remoteDir, sel.name)]); setRemoteSel(null) }
        } catch (e) { showNotice(`删除失败: ${e}`); return }
        if (which === 'local') refreshLocal(); else refreshRemote()
      })()
    } else if (action === 'transfer' && sel) {
      enqueue(which === 'local' ? 'upload' : 'download', sel.name, sel.isDir)
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
    addLog(`比较完成：${diff} 处差异`)
    showNotice(`比较完成：${diff} 处差异`)
  }

  // ---- 传输 ----
  const enqueue = (direction, name, isDir) => {
    if (!localDir) { showNotice('本地目录未就绪，无法传输'); return }
    const remote = remoteJoin(remoteDir || '/', name)
    const local = `${localDir}/${name}`
    const id = nextId++
    setQueue(qs => [...qs, { id, direction, remote, local, size: 0, transferred: 0, status: 'waiting' }])
    setShowBottom(true)
    if (bottomTab === 'log') setBottomTab('queue')
    addLog(`队列: ${direction === 'download' ? '下载' : '上传'} ${remote}`)
    api.enqueue({ id, direction, remotePath: remote, localPath: local, isDir })
  }

  const clearFinished = async () => {
    setQueue(qs => qs.filter(q => q.status === 'waiting' || q.status === 'active'))
    await api.queueClearFinished()
  }

  const cancelWaiting = () => {
    const items = queue.filter(q => q.status === 'waiting')
    if (!items.length) { showNotice('队列中没有等待的任务'); return }
    for (const q of items) api.cancelTransfer(q.id)
    showNotice(`已请求取消 ${items.length} 个等待任务`)
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
    addLog(`互传: ${site.name}:${path} → ${currentSite?.host}:${remoteDir}`)
    api.relay({
      id, srcSiteId: site.id, srcPath: path,
      dstPath: (remoteJoin(remoteDir || '/', '').replace(/\/+$/, '')) || '/',
    })
  }

  // ---- 连接 ----
  const quickConnect = (fields) => {
    const f = fields || qc
    if (!f.host.trim()) { showNotice('请输入服务器地址'); return }
    setQueue([])
    setCurrentSite({ host: f.host.trim(), port: Number(f.port) || 21 })
    api.quickConnect({
      host: f.host.trim(), port: Number(f.port) || 21,
      user: f.user.trim(), pass: f.pass,
    })
  }

  // 工具栏右侧「连接」下拉：快速连接 / 站点管理器 / 已保存站点
  const toggleConnectMenu = async () => {
    const next = !connectMenuOpen
    setConnectMenuOpen(next)
    if (next) {
      try { setConnectSites(await api.sites()) } catch { setConnectSites([]) }
    }
  }
  const connectFromMenu = async (s) => {
    setConnectMenuOpen(false)
    try {
      if (!await api.connectSite(s.id)) return
      setCurrentSite({ host: s.host, port: Number(s.port) || 21, name: s.name })
      applySiteLocalPath(s)
    } catch (e) { showNotice(`连接失败：${e}`) }
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
        await init()
        onEvent(handleEvent)
        const home = await api.homeDir()
        setHomePath(home)
        if (!bootLogged.current) {
          bootLogged.current = true
          addLog('Rust Flash Ftp 已启动')
          addLog('[L] FTP / FTPS / SFTP 已就绪')
          addLog('[L] 连接模式: 被动 (PASV)')
          addLog('[L] 文件名编码: 自动检测')
          addLog('[L] 代理服务器: 未启用')
          addLog(`[L] 本地浏览器: ${home}`)
          addLog('[L] 队列窗口: 0 项')
          addLog('[L] 传输队列: 串行，断点续传已启用')
          addLog('[L] 状态: 空闲 — 等待连接')
        }
        const prefDir = uiPref.get('defaultLocalDir', '') || uiPref.get('localDir', '')
        if (prefDir) {
          api.treeList(prefDir).then(() => navLocal(prefDir)).catch(() => navLocal(home))
        } else {
          navLocal(home)
        }
      } catch (e) {
        showNotice(`初始化失败: ${e}`)
      }
    })()
    const t = setInterval(() => setElapsed(v => v + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => { uiPref.set('startupTree', showTree) }, [showTree])
  useEffect(() => { uiPref.set('startupBottom', showBottom) }, [showBottom])
  useEffect(() => { uiPref.set('startupQuickbar', showQuick) }, [showQuick])
  useEffect(() => { uiPref.set('startupHeaderbar', showHeader) }, [showHeader])
  useEffect(() => { uiPref.set('bottomTab', bottomTab) }, [bottomTab])
  useEffect(() => { uiPref.set('syncBrowse', syncBrowse) }, [syncBrowse])
  useEffect(() => { uiPref.set('qcHost', qc.host); uiPref.set('qcPort', qc.port); uiPref.set('qcUser', qc.user) }, [qc])

  useEffect(() => {
    document.title = currentSite
      ? `Rust Flash Ftp - [${currentSite.host}:${currentSite.port}]`
      : 'Rust Flash Ftp'
  }, [currentSite])

  actionsRef.current = { quickConnect, enqueue, comparePanes, navLocal, paneAction, refreshLocal, refreshRemote, activateLocal, activateRemote, remoteUp, localUp }

  // 菜单里标注的快捷键需要真实生效：F4/F5/F6/F7/F8、Delete、Backspace、Enter、Escape
  // 无依赖数组 → 每次渲染后重新注册，闭包内状态始终是最新值
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      const dialogOpen = siteManagerOpen || proxyManagerOpen || relayOpen || aboutOpen || !!prompt
      if (e.key === 'Escape') {
        if (dialogOpen) {
          setSiteManagerOpen(false); setProxyManagerOpen(false); setRelayOpen(false)
          setAboutOpen(false); setPrompt(null)
        }
        return
      }
      if (typing || dialogOpen || e.metaKey || e.ctrlKey || e.altKey) return
      const a = actionsRef.current
      switch (e.key) {
        case 'F4': e.preventDefault(); setSiteManagerOpen(true); break
        case 'F5': e.preventDefault(); a.refreshLocal(); a.refreshRemote(); break
        case 'F6': e.preventDefault(); setProxyManagerOpen(true); break
        case 'F7': e.preventDefault(); a.paneAction('local', 'mkdir'); break
        case 'F8':
          e.preventDefault(); setShowQuick(true)
          setTimeout(() => document.getElementById('qc-host')?.focus(), 0)
          break
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
        default: break
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
          if (args[0] === 'prompt') askPrompt('新建本地目录', '', () => {})
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
          setAboutOpen(false); setPrompt(null)
          setShowTree(true); setShowBottom(true); setBottomTab('both')
          setShowQuick(true); setSyncBrowse(false)
          api.homeDir().then(p => { if (p) api.localList(p) }).catch(() => {})
          document.dispatchEvent(new Event('fx-close-menus'))
          break
        case 'quickfill': {
          const [host, port, user, pass] = cmd.slice(10).split(':')
          setQc({ host, port, user, pass })
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
    const t = setInterval(async () => {
      try {
        const r = await fetch('http://127.0.0.1:5199/cmd', { cache: 'no-store' })
        const cmd = (await r.text()).trim()
        if (cmd && cmd !== last) { last = cmd; window.__fxDrive(cmd) }
      } catch {}
    }, 400)
    return () => { clearInterval(t); delete window.__fxDrive }
  }, [])

  const activeCount = queue.filter(q => q.status === 'active').length
  const waitingCount = queue.filter(q => q.status === 'waiting').length
  const doneCount = queue.filter(q => q.status === 'done').length
  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`

  // ---- 菜单（与原版 FlashFXP 一致） ----
  const menus = [
    { name: '会话(E)', items: [
      { label: '快速连接…', key: 'F8', act: () => document.getElementById('qc-host')?.focus() },
      { label: '连接到站点…', key: 'F4', act: () => setSiteManagerOpen(true) },
      { sep: true },
      { label: '断开(D)', act: () => api.disconnect(), disabled: !connected },
      { label: '全部断开', act: () => api.disconnect(), disabled: !connected },
      { sep: true },
      { label: '退出(X)', key: '⌘Q', act: () => api.appExit() },
    ]},
    { name: '站点(S)', items: [
      { label: '站点管理器…', key: 'F4', act: () => setSiteManagerOpen(true) },
      { label: '站点互传(R)…', act: () => setRelayOpen(true), disabled: !connected },
      { sep: true },
      { label: '导入站点…', act: () => showNotice('请使用站点管理器管理站点') },
      { label: '导出站点…', act: () => showNotice('请使用站点管理器管理站点') },
    ]},
    { name: '选项(O)', items: [
      { label: '参数选择…', key: 'F6', act: () => setOptionsOpen(true) },
      { label: '代理设置(P)…', act: () => setProxyManagerOpen(true) },
      { sep: true },
      { label: '保存窗口位置', act: () => showNotice('窗口位置已自动保存') },
    ]},
    { name: '队列(Z)', items: [
      { label: '显示/隐藏 队列与日志', act: () => setShowBottom(v => !v) },
      { label: '恢复待传', act: resumeRestored },
      { label: '取消等待任务', act: cancelWaiting },
      { label: '清空已完成', act: clearFinished },
    ]},
    { name: '命令(C)', items: [
      { label: '编辑命令…', act: () => { setBottomTab('log'); setShowBottom(true) } },
      { label: '查看原始命令', act: () => { setBottomTab('log'); setShowBottom(true) } },
      { sep: true },
      { label: '计算已使用空间', act: () => { refreshLocal(); showNotice('已刷新目录') } },
    ]},
    { name: '工具(T)', items: [
      { label: '比较文件夹', act: comparePanes, disabled: !connected },
      { label: '清除比较标记', act: () => { setLocalMarks({}); setRemoteMarks({}) } },
      { sep: true },
      { label: '同步浏览', checked: syncBrowse, act: () => setSyncBrowse(v => !v) },
    ]},
    { name: '目录(D)', items: [
      { label: '新建目录…', key: 'F7', act: () => paneAction('local', 'mkdir') },
      { label: '重命名…', act: () => paneAction('local', 'rename') },
      { label: '删除', key: 'Del', act: () => paneAction('local', 'delete') },
      { sep: true },
      { label: '刷新(F5)', key: 'F5', act: () => { refreshLocal(); refreshRemote() } },
    ]},
    { name: '查看(V)', items: [
      { label: '目录树', checked: showTree, act: () => setShowTree(v => !v) },
      { label: '队列与日志窗口', checked: showBottom, act: () => setShowBottom(v => !v) },
      { label: '快速连接栏', checked: showQuick, act: () => setShowQuick(v => !v) },
      { label: '头部状态栏', checked: showHeader, act: () => setShowHeader(v => !v) },
      { sep: true },
      { label: '并排显示队列与日志', checked: bottomTab === 'both', act: () => setBottomTab('both') },
    ]},
    { name: '帮助(H)', items: [
      { label: '关于 Rust Flash Ftp…', act: () => setAboutOpen(true) },
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
        <button className="fx-header-cell" title="站点管理器" onClick={() => setSiteManagerOpen(true)}>
          <Ico name={connected ? 'connected' : 'miniComputer'} size={14} />
          {connected
            ? `${currentSite ? (currentSite.name || `${currentSite.host}:${currentSite.port}`) : '已连接'}${currentSite && currentSite.user ? `（${currentSite.user}）` : ''}`
            : '未连接 — 点击选择站点'}
        </button>
        <button className="fx-header-cell" title="代理管理器" onClick={() => setProxyManagerOpen(true)}>
          <Ico name="globe" size={14} /> 代理
        </button>
        <button className="fx-header-cell" title="站点互传" disabled={!connected} onClick={() => setRelayOpen(true)}>
          <Ico name="folderTransfer" size={14} /> 互传
        </button>
        <div className="fx-header-spacer" />
        <button className="fx-header-cell" title="打开队列窗口"
                onClick={() => { setShowBottom(true); setBottomTab('queue') }}>
          <Ico name="playDrop" size={14} /> 队列 {activeCount} 活动 / {waitingCount} 等待
        </button>
        <button className="fx-header-cell" title="打开日志窗口"
                onClick={() => { setShowBottom(true); setBottomTab('log') }}>
          日志
        </button>
        <button className="fx-header-cell" title="参数选择" onClick={() => setOptionsOpen(true)}>
          选项
        </button>
      </div>}

      {/* ===== 工具栏（左：本地浏览器 / 右：连接与传输） ===== */}
      <div className="fx-toolbar">
        <span className="fx-tool-caption">本地浏览器</span>
        <div className="fx-tool-group">
          <WinToolButton icon="pause" size={28} title="清空已完成队列" onClick={clearFinished} />
          <WinToolButton icon="playDrop" size={28} title="恢复待传任务" onClick={resumeRestored} />
          <WinToolButton icon="greenRefreshDoc" size={31} title="比较文件夹" disabled={!connected} onClick={comparePanes} />
          <WinToolButton icon="blueRefresh" size={31} title="同步浏览（开/关）" pressed={syncBrowse}
                         onClick={() => setSyncBrowse(v => !v)} />
          <WinToolButton icon="home" size={33} title="本地主目录" onClick={() => homePath && navLocal(homePath)} />
        </div>
        <div className="fx-tool-spacer" />
        <div className="fx-tool-group right">
          <div className="fx-tool-connect">
            <WinToolButton icon="connect" size={35} big title="连接（快速连接 / 站点）"
                           pressed={connectMenuOpen} onClick={toggleConnectMenu} />
            {connectMenuOpen && (
              <div className="fx-menu-popup fx-connect-menu" style={{ top: '100%', right: 0 }}>
                <button className="fx-menu-row" onClick={() => { setConnectMenuOpen(false); document.getElementById('qc-host')?.focus() }}>
                  <span className="fx-menu-check" />
                  <span className="fx-menu-label">快速连接…</span>
                </button>
                <button className="fx-menu-row" onClick={() => { setConnectMenuOpen(false); setSiteManagerOpen(true) }}>
                  <span className="fx-menu-check" />
                  <span className="fx-menu-label">站点管理器…</span>
                </button>
                {connectSites.length > 0 && <div className="fx-menu-sep" />}
                {connectSites.map(s => (
                  <button key={s.id} className="fx-menu-row" onClick={() => connectFromMenu(s)}>
                    <span className="fx-menu-check" />
                    <span className="fx-menu-label">{s.name}</span>
                    <span className="fx-menu-key">{s.host}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <WinToolButton icon="disconnect" size={35} big title="断开连接" disabled={!connected}
                         onClick={() => api.disconnect()} />
          <WinToolButton icon="cancel" size={33} big title="取消等待任务" onClick={cancelWaiting} />
          <WinToolButton icon="pauseBig" size={33} big title="暂停队列（取消等待任务）" onClick={cancelWaiting} />
          <WinToolButton icon="playBig" size={33} big title="开始传输 / 恢复待传" onClick={resumeRestored} />
          <WinToolButton icon="folderTransfer" size={33} big title="站点互传 / 文件夹操作" disabled={!connected}
                         onClick={() => setRelayOpen(true)} />
          <WinToolButton icon="blueRefresh" size={34} big title="刷新双栏"
                         onClick={() => { refreshLocal(); refreshRemote() }} />
          <WinToolButton icon="globe" size={34} big title="站点管理器" onClick={() => setSiteManagerOpen(true)} />
        </div>
      </div>

      {/* ===== 快速连接栏（查看 > 快速连接栏 可显隐） ===== */}
      {showQuick && <div className="fx-quickbar">
        <span className="fx-q-label">快速连接:</span>
        <span className="fx-q-field">服务器或 URL:</span>
        <WinInput id="qc-host" style={{ flex: '1.6', minWidth: 90 }} placeholder="ftp.example.com"
                  value={qc.host} onChange={(e) => setQc({ ...qc, host: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && quickConnect()} />
        <span className="fx-q-field">端口:</span>
        <WinInput style={{ width: 50 }} value={qc.port}
                  onChange={(e) => setQc({ ...qc, port: e.target.value.replace(/\D/g, '') })} />
        <span className="fx-q-field">用户名称:</span>
        <WinInput style={{ width: 120 }} placeholder="anonymous" value={qc.user}
                  onChange={(e) => setQc({ ...qc, user: e.target.value })} />
        <span className="fx-q-field">密码:</span>
        <WinInput style={{ width: 100 }} type="password" value={qc.pass}
                  onChange={(e) => setQc({ ...qc, pass: e.target.value })} />
        <WinButton compact onClick={quickConnect} disabled={!qc.host.trim()}>
          <Ico name="app" size={13} /> 连接
        </WinButton>
        <span className="fx-tool-sep" />
        <WinCheck checked={syncBrowse} onChange={setSyncBrowse} label="同步浏览" />
      </div>}

      {/* ===== 地址栏（左：本地 / 右：远程） ===== */}
      <div className="fx-address-row" style={{ gridTemplateColumns: gridCols }}>
        <div className="fx-address-cell left" style={{ gridColumn: leftCol }}>
          <IconTip title="站点管理器"><button className="fx-address-icon" onClick={() => setSiteManagerOpen(true)}><Ico name="miniComputer" size={17} /></button></IconTip>
          <IconTip title="快速连接"><button className="fx-address-icon" onClick={() => document.getElementById('qc-host')?.focus()}><Ico name="star" size={17} /></button></IconTip>
          <IconTip title="上级目录"><button className="fx-address-icon" onClick={localUp}><Ico name="greenUp" size={17} /></button></IconTip>
          <AddressCombo value={localDir} onGo={navLocal} history={localHistory} />
        </div>
        <div className="fx-address-cell right" style={{ gridColumn: rightCol }}>
          <IconTip title="站点管理器"><button className="fx-address-icon" onClick={() => setSiteManagerOpen(true)}><Ico name="miniComputer" size={17} /></button></IconTip>
          <IconTip title="远程主目录"><button className="fx-address-icon" onClick={() => api.remoteList('/')}><Ico name="star" size={17} /></button></IconTip>
          <IconTip title="上级目录"><button className="fx-address-icon" onClick={remoteUp}><Ico name="greenUp" size={17} /></button></IconTip>
          <AddressCombo value={remoteDir || ''} onGo={(p) => api.remoteList(p)} disabled={!connected} history={remoteHistory} />
        </div>
      </div>

      {/* ===== 主区：目录树 + 本地列表 + 远程列表 ===== */}
      <div className="fx-main" style={{ gridTemplateColumns: gridCols }}>
        {showTree && homePath && <DirTree home={homePath} onNavigate={navLocal}
          currentPath={localDir} onContextMenu={ctxMenu.openMenu} />}
        <FilePane pane="local" title="本地浏览器" entries={sortedLocal} selected={localSel}
          marks={localMarks} address={localDir} connected={connected} diskFree={diskFree}
          sort={sortLocal} onNavigate={localUp} onRefresh={refreshLocal}
          onSelect={(i) => { setLocalSel(i); setActivePane('local') }}
          onActivate={activateLocal} onAction={(a, target) => paneAction('local', a, target)}
          onAddressGo={navLocal} onHome={() => navLocal(homePath)}
          onContextMenu={ctxMenu.openMenu}
          onDropTransfer={(dir, name, isDir) => enqueue(dir, name, isDir)} />
        <FilePane pane="remote" title="远程浏览器"
          entries={sortedRemote} selected={remoteSel}
          marks={remoteMarks} address={remoteDir || ''} connected={connected && !!remoteDir}
          host={currentSite ? `${currentSite.host}` : ''} sort={sortRemote}
          onNavigate={remoteUp} onRefresh={refreshRemote}
          onSelect={(i) => { setRemoteSel(i); setActivePane('remote') }}
          onActivate={activateRemote} onAction={(a, target) => paneAction('remote', a, target)}
          onAddressGo={(p) => api.remoteList(p)} onHome={() => api.remoteList('/')}
          onContextMenu={ctxMenu.openMenu}
          onDropTransfer={(dir, name, isDir) => enqueue(dir, name, isDir)} />
      </div>

      {/* ===== 底部：队列窗口 / 日志窗口 ===== */}
      {showBottom && (
        <div className="fx-bottom">
          <div className="fx-bottom-tabs">
            <button className={`fx-tab ${bottomTab === 'queue' ? 'fx-active' : ''}`}
                    onClick={() => setBottomTab('queue')}>队列窗口</button>
            <button className={`fx-tab ${bottomTab === 'log' ? 'fx-active' : ''}`}
                    onClick={() => setBottomTab('log')}>日志窗口</button>
            <button className={`fx-tab ${bottomTab === 'both' ? 'fx-active' : ''}`}
                    onClick={() => setBottomTab('both')} title="并排显示队列与日志">并排</button>
            <div className="fx-bottom-tools">
              {queue.some(q => q.restored && q.status === 'waiting') && (
                <WinButton compact onClick={resumeRestored}>▶ 恢复待传</WinButton>
              )}
              <WinButton compact onClick={clearFinished} disabled={!queue.length}>清空已完成</WinButton>
              <span className="fx-hint">
                传输 {activeCount} · 等待 {waitingCount} · 完成 {doneCount}
              </span>
            </div>
          </div>
          <div className="fx-bottom-body">
            {bottomTab !== 'log' && (
              <div className={`fx-queue fx-scroll ${bottomTab === 'queue' ? '' : ''}`}
                   style={{ flex: bottomTab === 'both' ? '0 0 73%' : '1 1 100%', borderRight: bottomTab === 'both' ? undefined : 0 }}>
                <table className="fx-list listview" style={{ tableLayout: 'fixed' }}>
                    <colgroup><col style={{ width: '26%' }} /><col style={{ width: '28%' }} /><col style={{ width: '12%' }} /><col /></colgroup>
                    <thead><tr>
                      <th>名称</th><th>目标</th><th className="fx-th-right">大小</th><th>备注</th>
                    </tr></thead>
                    <tbody>
                      {queue.map((q, i) => (
                        <tr key={q.id} onContextMenu={(e) => ctxMenu.openMenu(e, [
                          { label: '取消该任务', disabled: q.status !== 'waiting', act: () => api.cancelTransfer(q.id) },
                          { sep: true },
                          { label: '复制名称', act: () => navigator.clipboard?.writeText(q.remote) },
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
                                {q.status === 'waiting' ? (q.restored ? '等待恢复' : '等待') : q.status === 'active' ? '传输中' : q.status === 'done' ? '完成' : (q.error === '已取消' ? '已取消' : '失败')}
                              </span>
                              {q.status === 'waiting' && <button className="x" title="取消该任务" onClick={() => api.cancelTransfer(q.id)}>✕</button>}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                </table>
              </div>
            )}
            {bottomTab !== 'queue' && (
              <div className="fx-log fx-scroll" style={{ flex: 1 }}>
                {log.length ? log.map((l, i) => {
                  const m = l.match(/^(\[[^\]]+\])\s*(.*)$/)
                  return (
                    <div className="fx-log-line" key={i}>
                      {m ? <><span className="fx-log-ts">{m[1]}</span> <LogBody text={m[2]} /></> : <LogBody text={l} />}
                    </div>
                  )
                }) : <div className="fx-log-line fx-log-info">[就绪] Rust Flash Ftp 已启动，等待连接…</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== 状态栏 ===== */}
      <div className="fx-statusbar">
        <div className="fx-status-cell" style={{ width: 130 }}>
          <Ico name="statusPc" size={13} /> {connected ? '已连接' : '空闲'} ({mmss})
        </div>
        <div className="fx-status-cell grow">
          {notice || (connected
            ? `${currentSite ? `${currentSite.host}:${currentSite.port}` : ''} — ${remoteDir || '/'}`
            : `本地浏览器 — ${localDir || ''}`)}
        </div>
        <div className="fx-status-cell" style={{ width: 168 }}>
          队列 {activeCount} 活动 / {waitingCount} 等待
        </div>
        <div className="fx-status-cell" style={{ width: 74 }}>Flash Ftp</div>
      </div>

      {/* ===== 对话框 ===== */}
      <CredentialsDialog />
      <SiteManager open={siteManagerOpen} onOpenChange={setSiteManagerOpen}
        onConnected={(site) => { setCurrentSite(site); applySiteLocalPath(site) }} />
      <ProxyManager open={proxyManagerOpen} onOpenChange={setProxyManagerOpen} />
      <OptionsDialog open={optionsOpen} onOpenChange={setOptionsOpen}
        uiPref={uiPref}
        currentLocalDir={localDir}
        setters={{ setShowQuick, setShowTree, setShowBottom, setShowHeader }} />
      <RelayDialog open={relayOpen} onOpenChange={setRelayOpen}
        currentSite={currentSite} remoteDir={remoteDir} onStart={startRelay} />

      <WinDialog open={aboutOpen} title="关于 Rust Flash Ftp" width={380} onClose={() => setAboutOpen(false)}
        footer={<WinButton onClick={() => setAboutOpen(false)}>确定</WinButton>}>
        <div className="fx-about-logo">
          <AppLogo size={48} />
          <div>
            <h2>Rust Flash Ftp</h2>
            <p>版本 0.1 (Rust 复刻版)<br />FTP / FTPS / SFTP 客户端<br />Rust (Tauri 2) + React</p>
          </div>
        </div>
        <WinFieldset legend="功能">
          <div className="fx-hint">
            FTP / FTPS / SFTP、站点管理、代理、双栏浏览、断点续传、<br />
            队列持久化、同步浏览、目录比较、站点互传。
          </div>
        </WinFieldset>
      </WinDialog>

      <WinDialog open={!!prompt} title={prompt?.title || ''} width={330} onClose={() => setPrompt(null)}
        footer={<>
          <WinButton variant="outline" onClick={() => setPrompt(null)}>取消</WinButton>
          <WinButton onClick={() => { if (prompt) { prompt.apply(prompt.value); setPrompt(null) } }}>确定</WinButton>
        </>}>
        <WinInput autoFocus style={{ width: '100%' }} value={prompt?.value || ''}
          onChange={(e) => setPrompt(p => ({ ...p, value: e.target.value }))}
          onKeyDown={(e) => { if (e.key === 'Enter' && prompt) { prompt.apply(prompt.value); setPrompt(null) } }} />
      </WinDialog>

      <WinContextMenu menu={ctxMenu.menu} onClose={ctxMenu.closeMenu} />
    </div>
  )
}
