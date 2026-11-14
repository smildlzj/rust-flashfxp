<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../api.js'

const props = defineProps({ currentSite: Object, remoteDir: String })
const emit = defineEmits(['close', 'start'])
const sites = ref([])
const srcSiteId = ref(null)
const srcPath = ref('/')

onMounted(async () => {
  sites.value = await api.sites()
})

const ready = computed(() => srcSiteId.value != null && srcPath.value.trim() && props.currentSite)

function start() {
  const site = sites.value.find(s => s.id === srcSiteId.value)
  if (!site) return
  emit('start', { site, path: srcPath.value.trim() })
}
</script>

<template>
  <div class="dialog-mask" @click.self="$emit('close')">
    <div class="dialog" style="width: 520px">
      <div class="dialog-title">站点互传（内存流水线，不落盘） <span class="x" @click="$emit('close')">✕</span></div>
      <div class="dialog-body">
        <div>目标：<b>{{ currentSite ? currentSite.host + ':' + currentSite.port : '（未连接）' }}</b> → {{ remoteDir || '/' }}</div>
        <div class="frm">
          <label>源站点:</label>
          <select v-model="srcSiteId">
            <option :value="null">（选择站点）</option>
            <option v-for="s in sites" :key="s.id" :value="s.id">{{ s.name }} ({{ s.host }}:{{ s.port }})</option>
          </select>
          <label>源路径:</label>
          <input v-model="srcPath" placeholder="/tmp">
        </div>
        <div style="color: #666; font-size: 11px">
          数据在内存中从源站点直转目标站点（8×256KB 缓冲流水线）。目录将递归复制。
        </div>
      </div>
      <div class="dialog-foot">
        <button class="cbtn" @click="$emit('close')">取消</button>
        <button class="cbtn primary" :disabled="!ready" @click="start">开始互传</button>
      </div>
    </div>
  </div>
</template>
