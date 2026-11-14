<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'

const emit = defineEmits(['close', 'connected'])

const sites = ref([])
const groups = ref([])
const proxies = ref([])
const editSite = ref(null)
const tab = ref(0) // 0=常规 1=高级
const newGroupName = ref('')
const sitesLoaded = ref(false)

async function reload() {
  sites.value = await api.sites()
  groups.value = await api.groups()
  proxies.value = await api.proxies()
}

onMounted(async () => {
  await reload()
  sitesLoaded.value = true
})

function select(s) {
  editSite.value = { ...s }
}

function newSite() {
  editSite.value = {
    id: 0, groupId: null, name: '', host: '', port: 21, protocol: 'ftp',
    username: '', password: '', encoding: 'auto', passiveMode: true,
    loginCmds: '', proxyId: null, tlsAcceptInvalid: false,
  }
  tab.value = 0
}

async function save() {
  if (!editSite.value || !editSite.value.name.trim() || !editSite.value.host.trim()) return
  await api.saveSite(toRaw(editSite.value))
  await reload()
}

function toRaw(s) {
  return {
    id: s.id || 0,
    groupId: s.groupId ?? null,
    name: s.name, host: s.host, port: Number(s.port) || 21,
    protocol: s.protocol,
    username: s.username || '', password: s.password || '',
    encoding: s.encoding, passiveMode: !!s.passiveMode,
    loginCmds: null, proxyId: s.proxyId ?? null,
    tlsAcceptInvalid: !!s.tlsAcceptInvalid,
  }
}

async function remove() {
  if (!editSite.value || !editSite.value.id) return
  if (!confirm(`删除站点「${editSite.value.name}」？`)) return
  await api.deleteSite(editSite.value.id)
  editSite.value = null
  await reload()
}

async function connect() {
  if (!editSite.value || !editSite.value.host.trim()) return
  await save()
  await api.connectSite(editSite.value.id)
  emit('connected', { ...editSite.value })
  emit('close')
}

async function addGroup() {
  const n = newGroupName.value.trim()
  if (!n) return
  await api.addGroup(n)
  newGroupName.value = ''
  await reload()
}

const protoName = computed(() => ({
  ftp: 'FTP', ftps_explicit: 'FTPS (显式 TLS)', ftps_implicit: 'FTPS (隐式 SSL)', sftp: 'SFTP (SSH)',
}[editSite.value?.protocol] || 'FTP'))

const encName = computed(() => ({
  auto: '自动检测', 'utf-8': 'UTF-8', gbk: 'GBK (简体中文)', big5: 'Big5 (繁体中文)', 'shift-jis': 'Shift-JIS (日文)',
}[editSite.value?.encoding] || '自动检测'))
</script>

<template>
  <div class="dialog-mask" @click.self="$emit('close')">
    <div class="dialog" style="width: 760px; max-width: 95vw">
      <div class="dialog-title">站点管理器 <span class="x" @click="$emit('close')">✕</span></div>
      <div class="dialog-body" style="gap: 4px">
        <!-- 对话框工具栏 -->
        <div style="display: flex; gap: 8px; align-items: center">
          <button class="cbtn primary" :disabled="!editSite || !editSite.id" @click="connect">连接(C)</button>
          <button class="cbtn" @click="newSite">新建站点(N)</button>
          <button class="cbtn" @click="addGroup" title="使用右侧输入框">新建组(G)</button>
          <button class="cbtn" :disabled="!editSite || !editSite.id" @click="remove">删除(D)</button>
          <span style="margin-left: auto; display: flex; gap: 4px; align-items: center">
            <input v-model="newGroupName" placeholder="新分组名称" style="width: 120px; border: 1px solid #78766c; background: #fff; padding: 2px 4px; font: inherit">
            <button class="cbtn" @click="addGroup">＋</button>
          </span>
        </div>
        <div class="sm-layout">
          <!-- 左侧树 -->
          <div class="sm-left">
            <div class="sm-tree">
              <template v-for="g in groups" :key="'g' + g.id">
                <div class="group">📁 {{ g.name }}</div>
                <div v-for="s in sites.filter(x => x.groupId === g.id)" :key="s.id"
                     class="site" :class="{ sel: editSite && editSite.id === s.id }"
                     @click="select(s)" @dblclick="select(s) || connect()">
                  　📄 {{ s.name }}
                </div>
              </template>
              <div v-for="s in sites.filter(x => x.groupId == null)" :key="'u' + s.id"
                   class="site" :class="{ sel: editSite && editSite.id === s.id }"
                   @click="select(s)" @dblclick="select(s) || connect()">
                📄 {{ s.name }}
              </div>
            </div>
          </div>
          <!-- 右侧表单 -->
          <div class="sm-right">
            <div class="sm-tabs">
              <div class="tab" :class="{ active: tab === 0 }" @click="tab = 0">常规</div>
              <div class="tab" :class="{ active: tab === 1 }" @click="tab = 1">高级</div>
            </div>
            <div class="sm-form" v-if="editSite">
              <div v-if="tab === 0" class="frm">
                <label>站点名称:</label><input v-model="editSite.name">
                <label>IP 地址:</label><input v-model="editSite.host" placeholder="ftp.example.com 或 192.168.1.1">
                <label>端口:</label><input v-model.number="editSite.port" style="width: 70px">
                <label>用户名:</label><input v-model="editSite.username">
                <label>密码:</label><input v-model="editSite.password" type="password">
              </div>
              <div v-else class="frm">
                <label>协议:</label>
                <select v-model="editSite.protocol">
                  <option value="ftp">FTP</option>
                  <option value="ftps_explicit">FTPS (显式 TLS)</option>
                  <option value="ftps_implicit">FTPS (隐式 SSL)</option>
                  <option value="sftp">SFTP (SSH)</option>
                </select>
                <label>编码:</label>
                <select v-model="editSite.encoding">
                  <option value="auto">自动检测</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="gbk">GBK (简体中文)</option>
                  <option value="big5">Big5 (繁体中文)</option>
                  <option value="shift-jis">Shift-JIS (日文)</option>
                </select>
                <label>传输模式:</label>
                <select v-model="editSite.passiveMode" :value="editSite.passiveMode ? '1' : '0'" @change="editSite.passiveMode = $event.target.value === '1'">
                  <option value="1">被动模式 (PASV)</option>
                  <option value="0">主动模式 (PORT)</option>
                </select>
                <label>证书校验:</label>
                <span><input type="checkbox" v-model="editSite.tlsAcceptInvalid"> 忽略证书错误（自签名服务器）</span>
                <label>代理:</label>
                <select v-model="editSite.proxyId">
                  <option :value="null">（无）</option>
                  <option v-for="p in proxies" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select>
                <label>分组:</label>
                <select v-model="editSite.groupId">
                  <option :value="null">（无）</option>
                  <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
              </div>
            </div>
            <div v-else class="sm-form" style="display: flex; align-items: center; justify-content: center; color: #666">
              选择左侧站点，或点击「新建站点」；<b>双击站点名可直接连接</b>
            </div>
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="cbtn" @click="$emit('close')">关闭(X)</button>
        <button class="cbtn" @click="save">应用(A)</button>
        <button class="cbtn primary" :disabled="!editSite || !editSite.host" @click="connect">连接(C)</button>
      </div>
    </div>
  </div>
</template>
