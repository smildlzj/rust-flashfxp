<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { api, init, onEvent, remoteJoin, remoteParent, humanSize } from './api.js'
import SvgIcon from './components/SvgIcon.vue'
import FilePane from './components/FilePane.vue'
import SiteManager from './components/SiteManager.vue'
import ProxyManager from './components/ProxyManager.vue'
import RelayDialog from './components/RelayDialog.vue'

// ---- 状态 ----
const connected = ref(false)
const currentSite = ref(null)

const localDir = ref('')
const localEntries = ref([])
const localSel = ref(null)
const localAddr = ref('')

const remoteDir = ref(null)
const remoteEntries = ref([])
const remoteSel = ref(null)
const remoteAddr = ref('')

const sortLocal = reactive({ key: 'name', desc: false })
const sortRemote = reactive({ key: 'name', desc: false })
const localMarks = ref({})
const remoteMarks = ref({})
const syncBrowse = ref(false)

const queue = ref([])
const log = ref([])
const showBottom = ref(true)
const bottomTab = ref('queue')
const toasts = ref([])
let nextId = 1

const showSiteManager = ref(false)
const showProxyManager = ref(false)
const showRelay = ref(false)
const showAbout = ref(false)

const qc = reactive({ host: '', port: '21', user: '', pass: '' })

// 菜单栏
const openMenu = ref(null)
const menus = [
  { name: '会话(E)', items: [
    { label: '快速连接…', act: () => {} },
    { label: '断开(D)', act: () => api.disconnect(), enabled: () => connected.value },
    { sep: true },
    { label: '退出(X)', act: () => window.__TAURI_INTERNALS__?.exit?.(), enabled: () => false },
  ]},
  { name: '站点(S)', items: [
    { label: '站点管理器(F4)', act: () => (showSiteManager.value = true) },
    { label: '站点互传(R)', act: () => (showRelay.value = true), enabled: () => connected.value },
  ]},
  { name: '选项(O)', items: [
    { label: '代理设置(P)', act: () => (showProxyManager.value = true) },
  ]},
  { name: '队列(Z)', items: [
    { label: '显示/隐藏 队列与日志', act: () => (showBottom.value = !showBottom.value) },
    { label: '清空已完成', act: clearFinished },
  ]},
  { name: '查看(V)', items: [
    { label: () => (syncBrowse.value ? '✓ ' : '') + '同步浏览', act: () => (syncBrowse.value = !syncBrowse.value) },
  ]},
  { name: '帮助(H)', items: [
    { label: '关于 Rust FlashFXP', act: () => (showAbout.value = true) },
  ]},
]

function menuLabel(it) { return typeof it.label === 'function' ? it.label() : it.label }
function menuEnabled(it) { return it.enabled ? it.enabled() : true }
function runMenu(it) {
  openMenu.value = null
  if (it.enabled && !it.enabled()) return
  it.act && it.act()
}

// ---- 日志 / 提示 ----
function addLog(text) {
  const now = new Date()
  const p = (x) => String(x).padStart(2, '0')
  log.value.push(`[${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}] ${text}`)
  if (log.value.length > 500) log.value.splice(0, log.value.length - 500)
}
function toast(text, err = false) {
  toasts.value.push({ text, err, until: Date.now() + 5000 })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.until > Date.now())
  }, 5200)
}

// ---- 排序 ----
function sortEntries(entries, st) {
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
const sortedLocal = computed(() => sortEntries(localEntries.value, sortLocal))
const sortedRemote = computed(() => sortEntries(remoteEntries.value, sortRemote))

// ---- 事件处理 ----
function handleEvent(p) {
  if (p && p.__dropped) {
    // 拖放上传（拖入窗口的本地文件 → 上传到当前远程目录）
    for (const path of p.__dropped.paths || []) {
      const name = path.split('/').pop()
      if (name) enqueue('upload', name, false)
    }
    return
  }
  if (typeof p === 'string') {
    if (p === 'Connected') {
      connected.value = true
      addLog('已连接站点')
      toast('已连接')
      restoreQueue()
    } else if (p === 'Disconnected') {
      connected.value = false
      currentSite.value = null
      remoteDir.value = null
      remoteEntries.value = []
      remoteSel.value = null
      addLog('已断开')
    }
    return
  }
  if (p.LocalList) {
    localDir.value = p.LocalList.path
    localAddr.value = p.LocalList.path
    localEntries.value = p.LocalList.entries
    localSel.value = null
    localMarks.value = {}
  } else if (p.RemoteList) {
    remoteDir.value = p.RemoteList.path
    remoteAddr.value = p.RemoteList.path
    remoteEntries.value = p.RemoteList.entries
    remoteSel.value = null
    remoteMarks.value = {}
    addLog(`列表完成: ${p.RemoteList.path} (${p.RemoteList.entries.length} 项)`)
  } else if (p.Notify) {
    toast(p.Notify.text, p.Notify.level === 'error')
    if (p.Notify.level === 'error') addLog(`错误: ${p.Notify.text}`)
  } else if (p.TransferStarted) {
    const q = queue.value.find(x => x.id === p.TransferStarted.id)
    if (q) { q.size = p.TransferStarted.size; q.status = 'active' }
  } else if (p.TransferProgress) {
    const q = queue.value.find(x => x.id === p.TransferProgress.id)
    if (q) q.transferred = p.TransferProgress.transferred
  } else if (p.TransferFinished) {
    const q = queue.value.find(x => x.id === p.TransferFinished.id)
    if (q) {
      q.status = p.TransferFinished.ok ? 'done' : 'failed'
      q.error = p.TransferFinished.error || ''
    }
    if (p.TransferFinished.ok) {
      addLog(`传输完成: ${q ? q.remote : p.TransferFinished.id}`)
      toast('传输完成')
      refreshLocal()
      refreshRemote()
    } else {
      addLog(`传输失败: ${p.TransferFinished.error || ''}`)
      toast(`传输失败: ${p.TransferFinished.error || ''}`, true)
    }
  }
}

async function restoreQueue() {
  try {
    const items = await api.restoreQueue()
    if (items && items.length) {
      for (const it of items) {
        queue.value.push({
          id: it.id, dbId: it.dbId, direction: it.direction,
          remote: it.remote, local: it.local, size: 0, transferred: 0, status: 'waiting',
        })
      }
      showBottom.value = true
    }
  } catch {}
}

// ---- 导航 ----
function refreshLocal() { if (localDir.value) api.localList(localDir.value) }
function refreshRemote() { if (remoteDir.value) api.remoteList(remoteDir.value) }

function navLocal(path) {
  api.localList(path)
}
function localUp() {
  if (!localDir.value) return
  const parent = localDir.value.replace(/\/[^/]+\/?$/, '') || '/'
  navLocal(parent)
}
function remoteUp() {
  if (!remoteDir.value) return
  const p = remoteParent(remoteDir.value)
  if (p) api.remoteList(p)
}

function activateLocal(i) {
  const e = sortedLocal.value[i]
  if (!e) return
  if (e.isDir) {
    const p = localDir.value + '/' + e.name
    navLocal(p)
    if (syncBrowse.value && remoteDir.value) {
      const r = sortedRemote.value.find(x => x.name === e.name && x.isDir)
      if (r) api.remoteList(remoteJoin(remoteDir.value, e.name))
      else toast('同步浏览：远程侧没有同名目录', true)
    }
  } else if (remoteDir.value) {
    enqueue('upload', e.name, false)
  }
}

function activateRemote(i) {
  const e = sortedRemote.value[i]
  if (!e) return
  if (e.isDir) {
    api.remoteList(remoteJoin(remoteDir.value, e.name))
    if (syncBrowse.value) {
      const l = sortedLocal.value.find(x => x.name === e.name && x.isDir)
      if (l) api.localList(localDir.value + '/' + e.name)
      else toast('同步浏览：本地侧没有同名目录', true)
    }
  } else {
    enqueue('download', e.name, false)
  }
}

// ---- 操作 ----
const prompt = reactive({ open: false, title: '', text: '', value: '', apply: null })

function askPrompt(title, value, apply) {
  prompt.title = title
  prompt.value = value
  prompt.apply = apply
  prompt.open = true
}

function paneAction(which, action) {
  const selIdx = which === 'local' ? localSel.value : remoteSel.value
  const entries = which === 'local' ? sortedLocal.value : sortedRemote.value
  const sel = selIdx != null ? entries[selIdx] : null
  if (action === 'mkdir') {
    askPrompt(which === 'local' ? '新建本地目录' : '新建远程目录', '', (name) => {
      if (which === 'local') { api.mkdirLocal(localDir.value + '/' + name); refreshLocal() }
      else { api.mkdirRemote(remoteJoin(remoteDir.value, name)); refreshRemote() }
    })
  } else if (action === 'rename' && sel) {
    askPrompt('重命名', sel.name, (name) => {
      if (which === 'local') {
        api.renameLocal(localDir.value + '/' + sel.name, localDir.value + '/' + name)
        refreshLocal()
      } else {
        api.renameRemote(remoteJoin(remoteDir.value, sel.name), remoteJoin(remoteDir.value, name))
        refreshRemote()
      }
    })
  } else if (action === 'delete' && sel) {
    if (!confirm(`删除「${sel.name}」？`)) return
    if (which === 'local') { api.deleteLocal([localDir.value + '/' + sel.name]); localSel.value = null; refreshLocal() }
    else { api.deleteRemote([remoteJoin(remoteDir.value, sel.name)]); remoteSel.value = null; refreshRemote() }
  } else if (action === 'transfer' && sel) {
    enqueue(which === 'local' ? 'upload' : 'download', sel.name, sel.isDir)
  } else if (action === 'compare') {
    comparePanes()
  } else if (action === 'clear-compare') {
    localMarks.value = {}
    remoteMarks.value = {}
  } else if (action === 'sort-name' || action === 'sort-size' || action === 'sort-time') {
    const key = action.split('-')[1]
    const st = which === 'local' ? sortLocal : sortRemote
    if (st.key === key) st.desc = !st.desc
    else { st.key = key; st.desc = false }
  }
}

function comparePanes() {
  const lm = {}
  const rm = {}
  const remoteMap = new Map(remoteEntries.value.map(e => [e.name, e]))
  const localMap = new Map(localEntries.value.map(e => [e.name, e]))
  for (const e of localEntries.value) {
    const r = remoteMap.get(e.name)
    if (!r) lm[e.name] = 'only'
    else if (!e.isDir && !r.isDir && e.size !== r.size) lm[e.name] = 'diff'
    else lm[e.name] = 'same'
  }
  for (const e of remoteEntries.value) {
    const l = localMap.get(e.name)
    if (!l) rm[e.name] = 'only'
    else if (!e.isDir && !l.isDir && e.size !== l.size) rm[e.name] = 'diff'
    else rm[e.name] = 'same'
  }
  localMarks.value = lm
  remoteMarks.value = rm
  const diff = Object.values(lm).filter(m => m !== 'same').length + Object.values(rm).filter(m => m !== 'same').length
  addLog(`比较完成：${diff} 处差异`)
  toast(`比较完成：${diff} 处差异`)
}

// ---- 传输 ----
function enqueue(direction, name, isDir) {
  const remote = remoteJoin(remoteDir.value || '/', name)
  const local = localDir.value + '/' + name
  const id = nextId++
  queue.value.push({
    id, direction, remote, local, size: 0, transferred: 0, status: 'waiting',
  })
  showBottom.value = true
  bottomTab.value = 'queue'
  addLog(`队列: ${direction === 'download' ? '下载' : '上传'} ${remote}`)
  api.enqueue({ id, direction, remotePath: remote, localPath: local, isDir })
}

async function clearFinished() {
  queue.value = queue.value.filter(q => q.status === 'waiting' || q.status === 'active')
  await api.queueClearFinished()
}

function startRelay({ site, path }) {
  const id = nextId++
  queue.value.push({
    id, direction: 'relay', remote: `${site.host}:${path} → ${remoteDir.value || '/'}`,
    local: '', size: 0, transferred: 0, status: 'waiting',
  })
  showBottom.value = true
  bottomTab.value = 'queue'
  showRelay.value = false
  addLog(`互传: ${site.name}:${path} → ${currentSite.value?.host}:${remoteDir.value}`)
  api.relay({
    id, srcSiteId: site.id, srcPath: path,
    dstPath: remoteJoin(remoteDir.value || '/', '').replace(/\/+$/, '') || '/',
  })
}

// ---- 连接 ----
function quickConnect() {
  if (!qc.host.trim()) return
  queue.value = []
  currentSite.value = { host: qc.host.trim(), port: Number(qc.port) || 21 }
  api.quickConnect({
    host: qc.host.trim(),
    port: Number(qc.port) || 21,
    user: qc.user.trim(),
    pass: qc.pass,
  })
}

function onSiteConnected(site) {
  currentSite.value = site || null
}

// ---- 初始化 ----
onMounted(async () => {
  try {
    await init()
    onEvent(handleEvent)
    const home = await api.homeDir()
    navLocal(home)
  } catch (e) {
    toast('初始化失败: ' + String(e), true)
    addLog('初始化失败: ' + String(e))
  }
})

const localTitle = computed(() => '本地')
const remoteTitle = computed(() =>
  currentSite.value ? `${currentSite.value.host}:${currentSite.value.port}` : '远程')

const activeCount = computed(() => queue.value.filter(q => q.status === 'active').length)
const waitingCount = computed(() => queue.value.filter(q => q.status === 'waiting').length)
const nowTime = computed(() => {
  const d = new Date()
  const p = (x) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
})
</script>

<template>
  <!-- 菜单栏 -->
  <div class="menubar">
    <div v-for="m in menus" :key="m.name" class="menu" :class="{ open: openMenu === m.name }"
         @mouseenter="openMenu && (openMenu = m.name)"
         @click="openMenu = openMenu === m.name ? null : m.name">
      {{ m.name }}
      <div class="dropdown">
        <template v-for="(it, i) in m.items" :key="i">
          <div v-if="it.sep" class="sep"></div>
          <div v-else class="item" :style="menuEnabled(it) ? '' : 'color:#888'"
               @click="runMenu(it)">{{ menuLabel(it) }}</div>
        </template>
      </div>
    </div>
  </div>

  <!-- 工具栏 -->
  <div class="toolbar">
    <div class="tbtn" title="连接（在下方快速连接栏输入主机）"><SvgIcon name="connect"/></div>
    <div class="tbtn" :class="{ disabled: !connected }" title="断开连接" @click="connected && api.disconnect()"><SvgIcon name="disconnect"/></div>
    <div class="tbtn" title="刷新双栏" @click="refreshLocal(); refreshRemote()"><SvgIcon name="refresh"/></div>
    <div class="tsep"></div>
    <div class="tbtn" :class="{ disabled: !connected }" title="站点互传（源站点 → 当前站点）" @click="connected && (showRelay = true)"><SvgIcon name="relay"/></div>
    <div class="tbtn" :class="{ disabled: !connected }" title="比较双栏目录差异" @click="connected && comparePanes()"><SvgIcon name="compare"/></div>
    <div class="tsep"></div>
    <div class="tbtn" title="显示/隐藏 队列与日志窗口" @click="showBottom = !showBottom"><SvgIcon name="queue"/></div>
  </div>

  <!-- 快速连接栏 -->
  <div class="quickbar">
    <b>快速连接:</b>
    <label>主机</label><input v-model="qc.host" placeholder="ftp.example.com" style="width: 170px" @keydown.enter="quickConnect">
    <label>端口</label><input v-model="qc.port" style="width: 46px">
    <label>用户</label><input v-model="qc.user" style="width: 110px" placeholder="anonymous">
    <label>密码</label><input v-model="qc.pass" type="password" style="width: 110px">
    <button class="btn-connect" :disabled="!qc.host.trim()" @click="quickConnect">⚡ 连接</button>
  </div>

  <!-- 双栏 -->
  <div class="panes">
    <FilePane pane="local" :title="localTitle" :entries="sortedLocal" :selected="localSel"
      :marks="localMarks" :address="localAddr" :connected="true"
      @navigate="localUp" @refresh="refreshLocal" @select="i => (localSel = i)"
      @activate="activateLocal" @action="a => paneAction('local', a)"
      @address-go="navLocal" />
    <FilePane pane="remote" :title="remoteTitle" :entries="sortedRemote" :selected="remoteSel"
      :marks="remoteMarks" :address="remoteAddr" :connected="connected && !!remoteDir"
      @navigate="remoteUp" @refresh="refreshRemote" @select="i => (remoteSel = i)"
      @activate="activateRemote" @action="a => paneAction('remote', a)"
      @address-go="p => api.remoteList(p)" />
  </div>

  <!-- 底部：队列 / 日志 -->
  <div v-if="showBottom" class="bottom">
    <div class="bottom-tabs">
      <div class="tab" :class="{ active: bottomTab === 'queue' }" @click="bottomTab = 'queue'">队列窗口</div>
      <div class="tab" :class="{ active: bottomTab === 'log' }" @click="bottomTab = 'log'">日志窗口</div>
      <span style="flex: 1"></span>
      <button v-if="bottomTab === 'queue'" class="cbtn" style="min-width: 0; padding: 1px 10px; margin: 3px" @click="clearFinished">清空已完成</button>
    </div>
    <div class="bottom-body">
      <template v-if="bottomTab === 'queue'">
        <div v-if="!queue.length" class="empty-hint" style="color: #666">（队列为空 — 双击文件或拖拽文件到窗口开始传输）</div>
        <div v-for="q in queue" :key="q.id" class="qrow">
          <span>{{ q.direction === 'download' ? '⇩' : (q.direction === 'relay' ? '⇄' : '⇧') }}</span>
          <span class="name" :title="q.direction === 'relay' ? q.remote : `${q.remote} → ${q.local}`">
            {{ (q.direction === 'upload' ? q.local : q.remote).split('/').pop() }}
          </span>
          <div class="bar"><i :style="{ width: (q.size ? Math.min(100, q.transferred / q.size * 100) : 0) + '%' }"></i></div>
          <span>{{ humanSize(q.transferred) }}/{{ humanSize(q.size) }}</span>
          <span v-if="q.status === 'waiting'" style="color: #666">等待中</span>
          <span v-else-if="q.status === 'active'" style="color: #0046c8">传输中…</span>
          <span v-else-if="q.status === 'done'" class="st-done">完成 ✓</span>
          <span v-else class="st-fail" :title="q.error">失败</span>
        </div>
      </template>
      <div v-else class="logview">
        <div v-for="(l, i) in log" :key="i">{{ l }}</div>
      </div>
    </div>
  </div>

  <!-- 状态栏 -->
  <div class="statusbar">
    <div class="cell">{{ connected ? '已连接' : '空闲' }}</div>
    <div class="cell" style="max-width: 260px; overflow: hidden">{{ remoteDir || '—' }}</div>
    <div class="cell grow" style="text-overflow: ellipsis; overflow: hidden">本地: {{ localDir }}</div>
    <div v-if="activeCount + waitingCount > 0" class="cell">传输中 {{ activeCount }}，等待 {{ waitingCount }}</div>
    <div class="cell">{{ nowTime }}</div>
  </div>

  <!-- 对话框们 -->
  <SiteManager v-if="showSiteManager" @close="showSiteManager = false" @connected="onSiteConnected" />
  <ProxyManager v-if="showProxyManager" @close="showProxyManager = false" />
  <RelayDialog v-if="showRelay" :current-site="currentSite" :remote-dir="remoteDir"
    @close="showRelay = false" @start="startRelay" />

  <div v-if="showAbout" class="dialog-mask" @click.self="showAbout = false">
    <div class="dialog" style="width: 380px">
      <div class="dialog-title">关于 Rust FlashFXP <span class="x" @click="showAbout = false">✕</span></div>
      <div class="dialog-body">
        <div style="text-align: center; font-size: 15px; font-weight: bold; margin: 8px 0">Rust FlashFXP 0.1</div>
        <div style="text-align: center; color: #555">FTP / FTPS / SFTP 客户端<br>Rust (Tauri) + Vue 实现</div>
      </div>
      <div class="dialog-foot"><button class="cbtn" @click="showAbout = false">确定</button></div>
    </div>
  </div>

  <!-- 输入对话框 -->
  <div v-if="prompt.open" class="dialog-mask" @click.self="prompt.open = false">
    <div class="dialog" style="width: 320px">
      <div class="dialog-title">{{ prompt.title }} <span class="x" @click="prompt.open = false">✕</span></div>
      <div class="dialog-body">
        <div class="frm"><label>名称:</label><input v-model="prompt.value" @keydown.enter="prompt.apply(prompt.value); prompt.open = false"></div>
      </div>
      <div class="dialog-foot">
        <button class="cbtn" @click="prompt.open = false">取消</button>
        <button class="cbtn primary" @click="prompt.apply(prompt.value); prompt.open = false">确定</button>
      </div>
    </div>
  </div>

  <!-- toast -->
  <div class="toasts">
    <div v-for="(t, i) in toasts" :key="i" class="toast" :class="t.err ? 'err' : 'ok'">{{ t.text }}</div>
  </div>
</template>
