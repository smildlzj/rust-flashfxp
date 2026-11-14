<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api.js'

const emit = defineEmits(['close'])
const proxies = ref([])
const edit = ref(null)

async function reload() {
  proxies.value = await api.proxies()
}

onMounted(reload)

function addNew() {
  edit.value = { id: 0, name: '', kind: 'socks5', host: '', port: 1080, username: '', password: '' }
}

async function save() {
  if (!edit.value || !edit.value.name.trim() || !edit.value.host.trim()) return
  await api.saveProxy({
    ...edit.value,
    id: edit.value.id || 0,
    port: Number(edit.value.port) || 1080,
    username: edit.value.username || '',
    password: edit.value.password || '',
  })
  edit.value = null
  await reload()
}

async function remove(p) {
  if (!confirm(`删除代理「${p.name}」？`)) return
  await api.deleteProxy(p.id)
  await reload()
}
</script>

<template>
  <div class="dialog-mask" @click.self="$emit('close')">
    <div class="dialog" style="width: 480px">
      <div class="dialog-title">代理设置 <span class="x" @click="$emit('close')">✕</span></div>
      <div class="dialog-body">
        <div class="sunken" style="max-height: 180px; overflow: auto; padding: 2px">
          <div v-if="!proxies.length" style="padding: 8px; color: #666">（暂无代理）</div>
          <div v-for="p in proxies" :key="p.id" class="qrow">
            <b>{{ p.name }}</b>
            <span style="color: #666">{{ p.kind === 'socks5' ? 'SOCKS5' : 'HTTP' }} {{ p.host }}:{{ p.port }}</span>
            <span style="flex: 1"></span>
            <button class="cbtn" @click="edit = { ...p }">编辑</button>
            <button class="cbtn" @click="remove(p)">删除</button>
          </div>
        </div>
        <div v-if="edit">
          <div class="frm" style="margin-top: 8px">
            <label>名称:</label><input v-model="edit.name">
            <label>类型:</label>
            <select v-model="edit.kind">
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP (CONNECT)</option>
            </select>
            <label>主机:</label><input v-model="edit.host">
            <label>端口:</label><input v-model.number="edit.port" style="width: 80px">
            <label>用户名:</label><input v-model="edit.username">
            <label>密码:</label><input v-model="edit.password" type="password">
          </div>
        </div>
      </div>
      <div class="dialog-foot">
        <button class="cbtn" @click="addNew">＋ 新增</button>
        <span style="flex: 1"></span>
        <button v-if="edit" class="cbtn" @click="save">保存</button>
        <button v-if="edit" class="cbtn" @click="edit = null">取消</button>
        <button class="cbtn" @click="$emit('close')">关闭(X)</button>
      </div>
    </div>
  </div>
</template>
