import React, { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Zap, Square, RotateCw, ArrowLeftRight, GitCompareArrows, ListChecks, FolderTree,
  Database, Network, ArrowLeft, ArrowDown, ArrowUp, Check, X,
} from 'lucide-react'
import FilePane from './components/FilePane.jsx'
import DirTree from './components/DirTree.jsx'
import SiteManager from './components/SiteManager.jsx'
import ProxyManager from './components/ProxyManager.jsx'
import RelayDialog from './components/RelayDialog.jsx'
import { api, init, onEvent, remoteJoin, remoteParent, humanSize } from './api.js'

let nextId = 1

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

  const [sortLocal, setSortLocal] = useState({ key: 'name', desc: false })
  const [sortRemote, setSortRemote] = useState({ key: 'name', desc: false })
  const [localMarks, setLocalMarks] = useState({})
  const [remoteMarks, setRemoteMarks] = useState({})
  const [syncBrowse, setSyncBrowse] = useState(() => uiPref.get('syncBrowse', false))

  const [queue, setQueue] = useState([])
  const [log, setLog] = useState([])
  const [showBottom, setShowBottom] = useState(() => uiPref.get('showBottom', true))
  const [bottomTab, setBottomTab] = useState(() => uiPref.get('bottomTab', 'queue'))

  const [showTree, setShowTree] = useState(() => uiPref.get('showTree', true))
  const [siteManagerOpen, setSiteManagerOpen] = useState(false)
  const [proxyManagerOpen, setProxyManagerOpen] = useState(false)
  const [relayOpen, setRelayOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  const [qc, setQc] = useState(() => ({
    host: uiPref.get('qcHost', ''), port: uiPref.get('qcPort', '21'),
    user: uiPref.get('qcUser', ''), pass: '',
  }))
  const [prompt, setPrompt] = useState(null) // {title, value, apply}

  // 事件回调注册于首次渲染，读状态必须经 ref 取最新值
  const stateRef = useRef({})
  stateRef.current = { localDir, remoteDir, connected, currentSite }
  // 最新动作引用（供 UI 自动化驱动；须在动作定义之后赋值）
  const actionsRef = useRef({})

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
        toast.success('已连接')
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
      setLocalEntries(p.LocalList.entries)
      setLocalSel(null)
      setLocalMarks({})
      if (p.LocalList.path) {
        api.diskInfo(p.LocalList.path).then(([free]) => setDiskFree(free)).catch(() => {})
      }
    } else if (p.RemoteList) {
      setRemoteDir(p.RemoteList.path)
      setRemoteEntries(p.RemoteList.entries)
      setRemoteSel(null)
      setRemoteMarks({})
      addLog(`列表完成: ${p.RemoteList.path} (${p.RemoteList.entries.length} 项)`)
    } else if (p.Notify) {
      if (p.Notify.level === 'error') {
        toast.error(p.Notify.text)
        addLog(`错误: ${p.Notify.text}`)
      } else {
        toast.warning(p.Notify.text)
      }
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
        addLog(`传输完成`)
        toast.success('传输完成')
        if (stateRef.current.localDir) api.localList(stateRef.current.localDir)
        if (stateRef.current.remoteDir) api.remoteList(stateRef.current.remoteDir)
      } else {
        addLog(`传输失败: ${p.TransferFinished.error || ''}`)
        toast.error(`传输失败: ${p.TransferFinished.error || ''}`)
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
        toast.info(`已恢复 ${items.length} 个待传任务（未自动执行，需手动恢复传输）`)
      }
    } catch {}
  }

  // 手动重放恢复的待传任务
  const resumeRestored = () => {
    const items = queue.filter(q => q.restored && q.status === 'waiting')
    if (!items.length) return
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
        else toast.warning('同步浏览：远程侧没有同名目录')
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
        else toast.warning('同步浏览：本地侧没有同名目录')
      }
    } else {
      enqueue('download', e.name, false)
    }
  }

  // ---- 操作 ----
  const askPrompt = (title, value, apply) => setPrompt({ title, value, apply })

  const paneAction = (which, action) => {
    const selIdx = which === 'local' ? localSel : remoteSel
    const entries = which === 'local' ? sortedLocal : sortedRemote
    const sel = selIdx != null ? entries[selIdx] : null
    if (action === 'mkdir') {
      askPrompt(which === 'local' ? '新建本地目录' : '新建远程目录', '', (name) => {
        if (which === 'local') { api.mkdirLocal(`${localDir}/${name}`); refreshLocal() }
        else { api.mkdirRemote(remoteJoin(remoteDir, name)); refreshRemote() }
      })
    } else if (action === 'rename' && sel) {
      askPrompt('重命名', sel.name, (name) => {
        if (which === 'local') {
          api.renameLocal(`${localDir}/${sel.name}`, `${localDir}/${name}`)
          refreshLocal()
        } else {
          api.renameRemote(remoteJoin(remoteDir, sel.name), remoteJoin(remoteDir, name))
          refreshRemote()
        }
      })
    } else if (action === 'delete' && sel) {
      if (!window.confirm(`删除「${sel.name}」？`)) return
      if (which === 'local') { api.deleteLocal([`${localDir}/${sel.name}`]); setLocalSel(null); refreshLocal() }
      else { api.deleteRemote([remoteJoin(remoteDir, sel.name)]); setRemoteSel(null); refreshRemote() }
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
    toast(`比较完成：${diff} 处差异`)
  }

  // ---- 传输 ----
  const enqueue = (direction, name, isDir) => {
    const remote = remoteJoin(remoteDir || '/', name)
    const local = `${localDir}/${name}`
    const id = nextId++
    setQueue(qs => [...qs, { id, direction, remote, local, size: 0, transferred: 0, status: 'waiting' }])
    setShowBottom(true)
    setBottomTab('queue')
    addLog(`队列: ${direction === 'download' ? '下载' : '上传'} ${remote}`)
    api.enqueue({ id, direction, remotePath: remote, localPath: local, isDir })
  }

  const clearFinished = async () => {
    setQueue(qs => qs.filter(q => q.status === 'waiting' || q.status === 'active'))
    await api.queueClearFinished()
  }

  const startRelay = ({ site, path }) => {
    const id = nextId++
    setQueue(qs => [...qs, {
      id, direction: 'relay', remote: `${site.host}:${path} → ${remoteDir || '/'}`,
      local: '', size: 0, transferred: 0, status: 'waiting',
    }])
    setShowBottom(true)
    setBottomTab('queue')
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
    if (!f.host.trim()) return
    setQueue([])
    setCurrentSite({ host: f.host.trim(), port: Number(f.port) || 21 })
    api.quickConnect({
      host: f.host.trim(), port: Number(f.port) || 21,
      user: f.user.trim(), pass: f.pass,
    })
  }

  // ---- 初始化 ----
  useEffect(() => {
    ;(async () => {
      try {
        await init()
        onEvent(handleEvent)
        const home = await api.homeDir()
        setHomePath(home)
        const lastDir = uiPref.get('localDir', '')
        // 恢复上次浏览的本地目录（存在才用）
        if (lastDir) {
          api.treeList(lastDir).then(() => navLocal(lastDir)).catch(() => navLocal(home))
        } else {
          navLocal(home)
        }
      } catch (e) {
        toast.error(`初始化失败: ${e}`)
      }
    })()
  }, [])

  // 配置变更持久化
  useEffect(() => { uiPref.set('showTree', showTree) }, [showTree])
  useEffect(() => { uiPref.set('showBottom', showBottom) }, [showBottom])
  useEffect(() => { uiPref.set('bottomTab', bottomTab) }, [bottomTab])
  useEffect(() => { uiPref.set('syncBrowse', syncBrowse) }, [syncBrowse])
  useEffect(() => { uiPref.set('qcHost', qc.host); uiPref.set('qcPort', qc.port); uiPref.set('qcUser', qc.user) }, [qc])

  // 动态标题
  useEffect(() => {
    document.title = currentSite
      ? `Rust FlashFXP - [${currentSite.host}:${currentSite.port}]`
      : 'Rust FlashFXP'
  }, [currentSite])

  actionsRef.current = { quickConnect, enqueue, comparePanes, navLocal, paneAction, refreshLocal, refreshRemote }

  // ---- DEV：UI 自动化驱动（轮询 http://127.0.0.1:5199/cmd） ----
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
          if (args[0] === 'prompt') askPrompt('新建本地目录', '', () => {})
          if (args[0] === 'queue') setShowBottom(true)
          break
        case 'close':
          setSiteManagerOpen(false); setProxyManagerOpen(false)
          setRelayOpen(false); setAboutOpen(false); setPrompt(null)
          break
        case 'menu': {
          const name = cmd.slice(5)
          const el = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name)
          el?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
          break
        }
        case 'quickfill': {
          const [host, port, user, pass] = cmd.slice(10).split(':')
          setQc({ host, port, user, pass })
          setTimeout(() => a().quickConnect({ host, port: port || '21', user: user || '', pass: pass || '' }), 100)
          break
        }
        case 'connect':
          a().quickConnect()
          break
        case 'enqueue':
          a().enqueue(args[0], args[1], args[2] === 'dir')
          break
        case 'compare':
          a().comparePanes()
          break
        case 'tab':
          setBottomTab(args[0]); setShowBottom(true)
          break
        case 'sync':
          setSyncBrowse(args[0] !== 'off')
          break
        case 'tree':
          setShowTree(args[0] !== 'off')
          break
        case 'bottom':
          setShowBottom(args[0] !== 'off')
          break
        case 'nav':
          a().navLocal(cmd.slice(4))
          break
        case 'reload':
          window.location.reload()
          break
        case 'refresh':
          a().refreshLocal(); a().refreshRemote()
          break
        case 'rmenu': {
          const n = Number(args[0] || 0)
          const rows = document.querySelectorAll('.listview tbody tr')
          const el = rows[n]
          if (el) {
            el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse' }))
            el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, pointerId: 1, pointerType: 'mouse' }))
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
          }
          break
        }
        case 'rmenubg': {
          const pane = document.querySelectorAll('.listview')[Number(args[0] || 0)]
          if (pane) {
            pane.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, buttons: 2, pointerId: 1, pointerType: 'mouse' }))
            pane.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, pointerId: 1, pointerType: 'mouse' }))
            pane.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
          }
          break
        }
      }
    }
    let last = ''
    const t = setInterval(async () => {
      try {
        const r = await fetch('http://127.0.0.1:5199/cmd', { cache: 'no-store' })
        const cmd = (await r.text()).trim()
        if (cmd && cmd !== last) {
          last = cmd
          window.__fxDrive(cmd)
        }
      } catch {}
    }, 400)
    return () => { clearInterval(t); delete window.__fxDrive }
  }, [])

  const activeCount = queue.filter(q => q.status === 'active').length
  const waitingCount = queue.filter(q => q.status === 'waiting').length

  // ---- 菜单 ----
  const menus = [
    { name: '会话(E)', items: [
      { label: '快速连接…' },
      { label: '断开(D)', act: () => api.disconnect(), disabled: !connected },
    ]},
    { name: '站点(S)', items: [
      { label: '站点管理器(F4)', act: () => setSiteManagerOpen(true) },
      { label: '站点互传(R)', act: () => setRelayOpen(true), disabled: !connected },
    ]},
    { name: '选项(O)', items: [
      { label: '代理设置(P)', act: () => setProxyManagerOpen(true) },
      { label: '参数选择…' },
    ]},
    { name: '队列(Z)', items: [
      { label: '显示/隐藏 队列与日志', act: () => setShowBottom(v => !v) },
      { label: '清空已完成', act: clearFinished },
    ]},
    { name: '命令(C)', items: [
      { label: '编辑命令…' },
      { label: '查看原始命令', act: () => { setBottomTab('log'); setShowBottom(true) } },
    ]},
    { name: '工具(T)', items: [
      { label: '比较文件夹', act: comparePanes, disabled: !connected },
      { label: (syncBrowse ? '✓ ' : '') + '同步浏览', act: () => setSyncBrowse(v => !v) },
    ]},
    { name: '目录(D)', items: [
      { label: '新建目录…', act: () => paneAction('local', 'mkdir') },
      { label: '刷新(F5)', act: () => { refreshLocal(); refreshRemote() } },
    ]},
    { name: '查看(V)', items: [
      { label: (showTree ? '✓ ' : '') + '目录树', act: () => setShowTree(v => !v) },
      { label: (showBottom ? '✓ ' : '') + '队列与日志窗口', act: () => setShowBottom(v => !v) },
    ]},
    { name: '帮助(H)', items: [
      { label: '关于 Rust FlashFXP', act: () => setAboutOpen(true) },
    ]},
  ]

  const TBtn = ({ icon: Icon, title, disabled, onClick }) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" disabled={disabled} onClick={onClick}>
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">{title}</TooltipContent>
    </Tooltip>
  )

  return (
    <div className="h-screen flex flex-col bg-muted/30 text-sm overflow-hidden">
      {/* 菜单栏 */}
      <div className="flex items-center gap-0.5 px-2 py-0.5 bg-background border-b flex-none">
        <span className="font-bold text-sm px-2">Rust FlashFXP</span>
        <Separator orientation="vertical" className="h-4 mx-1" />
        {menus.map(m => (
          <DropdownMenu key={m.name}>
            <DropdownMenuTrigger className="px-2 py-0.5 rounded-sm text-xs hover:bg-accent cursor-default">{m.name}</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="text-xs">
              {m.items.map((it, i) => it.sep ? <DropdownMenuSeparator key={i} /> : (
                <DropdownMenuItem key={i} disabled={it.disabled || false} onClick={() => it.act && it.act()}>
                  {typeof it.label === 'function' ? it.label() : it.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-0.5 px-2 py-1 bg-background border-b flex-none">
        <TBtn icon={Zap} title="连接（聚焦下方快速连接栏）" onClick={() => document.getElementById('qc-host')?.focus()} />
        <TBtn icon={Square} title="断开连接" className="text-red-600" disabled={!connected} onClick={() => api.disconnect()} />
        <TBtn icon={RotateCw} title="刷新双栏" onClick={() => { refreshLocal(); refreshRemote() }} />
        <Separator orientation="vertical" className="h-5 mx-1" />
        <TBtn icon={ArrowLeftRight} title="站点互传（源站点 → 当前站点）" disabled={!connected} onClick={() => setRelayOpen(true)} />
        <TBtn icon={GitCompareArrows} title="比较双栏目录差异" disabled={!connected} onClick={comparePanes} />
        <TBtn icon={FolderTree} title="目录树" onClick={() => setShowTree(v => !v)} />
        <TBtn icon={ListChecks} title="显示/隐藏 队列与日志窗口" onClick={() => setShowBottom(v => !v)} />
        <div className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-default">
          <input type="checkbox" checked={syncBrowse} onChange={(e) => setSyncBrowse(e.target.checked)} />
          同步浏览
        </label>
      </div>

      {/* 快速连接栏 */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-background border-b flex-none">
        <span className="font-medium">快速连接:</span>
        <span className="text-muted-foreground text-xs">主机</span>
        <Input id="qc-host" className="h-7 w-44 font-mono text-xs" placeholder="ftp.example.com"
               value={qc.host} onChange={(e) => setQc({ ...qc, host: e.target.value })}
               onKeyDown={(e) => e.key === 'Enter' && quickConnect()} />
        <span className="text-muted-foreground text-xs">端口</span>
        <Input className="h-7 w-16 text-xs" value={qc.port} onChange={(e) => setQc({ ...qc, port: e.target.value.replace(/\D/g, '') })} />
        <span className="text-muted-foreground text-xs">用户</span>
        <Input className="h-7 w-28 text-xs" placeholder="anonymous" value={qc.user} onChange={(e) => setQc({ ...qc, user: e.target.value })} />
        <span className="text-muted-foreground text-xs">密码</span>
        <Input className="h-7 w-28 text-xs" type="password" value={qc.pass} onChange={(e) => setQc({ ...qc, pass: e.target.value })} />
        <Button className="h-7" disabled={!qc.host.trim()} onClick={quickConnect}><Zap className="h-3.5 w-3.5 mr-1" />连接</Button>
      </div>

      {/* 主区：目录树 + 双栏 */}
      <div className="flex-1 flex gap-2 p-2 min-h-0">
        {showTree && homePath && <DirTree home={homePath} onNavigate={navLocal} />}
        <FilePane pane="local" title="本地" entries={sortedLocal} selected={localSel}
          marks={localMarks} address={localDir} connected diskFree={diskFree}
          onNavigate={localUp} onRefresh={refreshLocal} onSelect={setLocalSel}
          onActivate={activateLocal} onAction={(a) => paneAction('local', a)}
          onAddressGo={navLocal} onHome={() => navLocal(homePath)}
          onDropTransfer={(dir, name, isDir) => enqueue(dir, name, isDir)} />
        <FilePane pane="remote"
          title={currentSite ? `${currentSite.host}:${currentSite.port}` : '远程'}
          entries={sortedRemote} selected={remoteSel}
          marks={remoteMarks} address={remoteDir || ''} connected={connected && !!remoteDir}
          host={currentSite ? `${currentSite.host}:${currentSite.port}` : ''}
          onNavigate={remoteUp} onRefresh={refreshRemote} onSelect={setRemoteSel}
          onActivate={activateRemote} onAction={(a) => paneAction('remote', a)}
          onAddressGo={(p) => api.remoteList(p)} onHome={() => api.remoteList('/')}
          onDropTransfer={(dir, name, isDir) => enqueue(dir, name, isDir)} />
      </div>

      {/* 底部：队列 / 日志 */}
      {showBottom && (
        <div className="flex-none h-44 mx-2 mb-2 border rounded-md bg-card flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1 border-b flex-none">
            <Tabs value={bottomTab} onValueChange={setBottomTab}>
              <TabsList className="h-7">
                <TabsTrigger value="queue" className="text-xs h-6">队列窗口</TabsTrigger>
                <TabsTrigger value="log" className="text-xs h-6">日志窗口</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1" />
            {activeCount + waitingCount > 0 && (
              <Badge variant="secondary" className="text-xs">传输中 {activeCount} · 等待 {waitingCount}</Badge>
            )}
            {bottomTab === 'queue' && queue.some(q => q.restored && q.status === 'waiting') && (
              <Button size="sm" className="h-6 text-xs" onClick={resumeRestored}>▶ 恢复待传</Button>
            )}
            {bottomTab === 'queue' && queue.length > 0 && (
              <Button variant="outline" size="sm" className="h-6 text-xs" onClick={clearFinished}>清空已完成</Button>
            )}
          </div>
          <ScrollArea className="flex-1 min-h-0">
            {bottomTab === 'queue' ? (
              queue.length ? (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="h-7 w-8">#</TableHead>
                      <TableHead className="h-7">名称</TableHead>
                      <TableHead className="h-7">目标</TableHead>
                      <TableHead className="h-7 w-24 text-right">大小</TableHead>
                      <TableHead className="h-7 w-52">进度</TableHead>
                      <TableHead className="h-7 w-20">状态</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queue.map((q, i) => (
                      <TableRow key={q.id} className={cn('cursor-default', q.status === 'failed' && 'text-red-600')}>
                        <TableCell className="py-0.5 text-xs text-muted-foreground text-right">{i + 1}</TableCell>
                        <TableCell className="py-0.5 font-mono text-xs max-w-0 truncate">
                          {(q.direction === 'upload' ? q.local : q.remote).split('/').pop()}
                        </TableCell>
                        <TableCell className="py-0.5 font-mono text-xs text-muted-foreground max-w-0 truncate">
                          {q.direction === 'relay' ? q.remote : (q.direction === 'download' ? q.local : q.remote)}
                        </TableCell>
                        <TableCell className="py-0.5 text-xs text-right text-muted-foreground">{humanSize(q.size)}</TableCell>
                        <TableCell className="py-0.5">
                          <Progress value={q.size ? Math.min(100, (q.transferred / q.size) * 100) : 0} className="h-2.5" />
                        </TableCell>
                        <TableCell className="py-0.5 text-xs">
                          {q.status === 'waiting' && (
                            <span className="flex items-center gap-1">
                              <span className="text-muted-foreground">等待</span>
                              <button title="取消该任务" className="text-red-600 hover:text-red-700"
                                      onClick={() => api.cancelTransfer(q.id)}>✕</button>
                            </span>
                          )}
                          {q.status === 'active' && <span className="text-blue-600">传输中</span>}
                          {q.status === 'done' && <span className="text-green-600 flex items-center gap-0.5"><Check className="h-3 w-3" />完成</span>}
                          {q.status === 'failed' && <span title={q.error} className="flex items-center gap-0.5"><X className="h-3 w-3" />{q.error === '已取消' ? '已取消' : '失败'}</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="h-24 flex items-center justify-center text-xs text-muted-foreground">
                  （队列为空 — 双击文件或拖拽文件到窗口开始传输）
                </div>
              )
            ) : (
              <div className="font-mono text-xs p-2 leading-relaxed">
                {log.map((l, i) => (
                  <div key={i} className={cn(
                    'border-b border-dotted border-border/50 py-0.5',
                    /失败|错误/.test(l) ? 'text-red-600' : /完成|已连接/.test(l) ? 'text-green-700' : 'text-muted-foreground',
                  )}>{l}</div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}

      {/* 状态栏 */}
      <div className="flex items-center gap-3 px-3 py-1 bg-background border-t text-xs text-muted-foreground flex-none">
        <span className={cn('font-medium', connected ? 'text-green-700' : '')}>{connected ? '● 已连接' : '○ 空闲'}</span>
        <span className="font-mono truncate max-w-60">{remoteDir || '—'}</span>
        <span className="truncate flex-1">本地: {localDir}</span>
        {activeCount + waitingCount > 0 && <span>传输中 {activeCount}，等待 {waitingCount}</span>}
      </div>

      {/* 对话框 */}
      <SiteManager open={siteManagerOpen} onOpenChange={setSiteManagerOpen}
        onConnected={(site) => setCurrentSite(site)} />
      <ProxyManager open={proxyManagerOpen} onOpenChange={setProxyManagerOpen} />
      <RelayDialog open={relayOpen} onOpenChange={setRelayOpen}
        currentSite={currentSite} remoteDir={remoteDir} onStart={startRelay} />

      <Dialog open={aboutOpen} onOpenChange={setAboutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>关于 Rust FlashFXP</DialogTitle></DialogHeader>
          <div className="text-center py-3">
            <div className="font-bold text-lg">Rust FlashFXP 0.1</div>
            <div className="text-muted-foreground mt-1">FTP / FTPS / SFTP 客户端<br />Rust (Tauri 2) + React + shadcn/ui</div>
          </div>
          <DialogFooter><Button onClick={() => setAboutOpen(false)}>确定</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 输入对话框 */}
      <Dialog open={!!prompt} onOpenChange={(v) => !v && setPrompt(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader><DialogTitle>{prompt?.title}</DialogTitle></DialogHeader>
          <Input autoFocus value={prompt?.value || ''}
                 onChange={(e) => setPrompt(p => ({ ...p, value: e.target.value }))}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter' && prompt) { prompt.apply(prompt.value); setPrompt(null) }
                 }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrompt(null)}>取消</Button>
            <Button onClick={() => { if (prompt) { prompt.apply(prompt.value); setPrompt(null) } }}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Toaster position="bottom-right" />
    </div>
  )
}
