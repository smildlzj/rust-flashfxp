<script setup>
import { computed } from 'vue'
import SvgIcon from './SvgIcon.vue'
import { humanSize, fmtTime } from '../api.js'

const props = defineProps({
  pane: { type: String, required: true }, // 'local' | 'remote'
  title: String,
  entries: Array,
  selected: Number, // index
  marks: Object, // name -> 'same'|'only'|'diff'
  address: String,
  connected: Boolean,
})
const emit = defineEmits([
  'navigate', 'refresh', 'select', 'activate', 'action', 'address-go',
])

const files = computed(() => props.entries.filter(e => !e.isDir).length)
const dirs = computed(() => props.entries.filter(e => e.isDir).length)
const total = computed(() => props.entries.reduce((s, e) => s + (e.size || 0), 0))
const selEntry = computed(() => (props.selected != null ? props.entries[props.selected] : null))

function onRow(i, ev) {
  if (ev.type === 'click') emit('select', i)
}
function onDbl(i) {
  emit('activate', i)
}
function markCls(e) {
  const m = props.marks && props.marks[e.name]
  if (!m || m === 'same') return m === 'same' ? 'mark-same' : ''
  if (m === 'only') return 'mark-only'
  if (m === 'diff') return 'mark-diff'
  return ''
}
function markText(e) {
  const m = props.marks && props.marks[e.name]
  if (!m) return ''
  if (m === 'same') return '·'
  if (m === 'only') return '＋'
  if (m === 'diff') return '▲'
  return ''
}
</script>

<template>
  <div class="pane">
    <!-- 页签 + 导航 + 地址栏 -->
    <div class="pane-tab-row">
      <span :class="['pane-tab', pane]">{{ title }}</span>
      <div class="tbtn" title="上级目录" @click="$emit('navigate')">
        <SvgIcon name="up"/>
      </div>
      <div class="tbtn" title="刷新" @click="$emit('refresh')">
        <SvgIcon name="refresh"/>
      </div>
      <div class="address">
        <input :value="address" :disabled="!connected"
          placeholder="输入路径后回车"
          @change="$event.target.value && $emit('address-go', $event.target.value)"
          @keydown.enter="$emit('address-go', $event.target.value)">
      </div>
    </div>
    <!-- 操作按钮 -->
    <div class="pane-actions">
      <div class="tbtn" title="新建目录" @click="$emit('action', 'mkdir')"><SvgIcon name="newdir"/></div>
      <div class="tbtn" :class="{ disabled: selected == null }" title="重命名" @click="selected != null && $emit('action', 'rename')"><SvgIcon name="rename"/></div>
      <div class="tbtn" :class="{ disabled: selected == null }" title="删除" @click="selected != null && $emit('action', 'delete')"><SvgIcon name="delete"/></div>
      <div v-if="pane === 'local'" class="tbtn" :class="{ disabled: selected == null || !connected }" title="上传到远程" @click="selected != null && connected && $emit('action', 'transfer')"><SvgIcon name="upload"/></div>
      <div v-else class="tbtn" :class="{ disabled: selected == null || !connected }" title="下载到本地" @click="selected != null && connected && $emit('action', 'transfer')"><SvgIcon name="download"/></div>
      <div class="tbtn" :class="{ disabled: !connected }" title="与对侧比较" @click="connected && $emit('action', 'compare')"><SvgIcon name="compare"/></div>
      <span v-if="marks && Object.keys(marks).length" class="legend">
        <b class="g">· 相同</b><b class="b">＋ 仅本侧</b><b class="y">▲ 大小不同</b>
        <a @click="$emit('action', 'clear-compare')">清除比较</a>
      </span>
    </div>
    <!-- 文件列表 -->
    <div class="listview">
      <table v-if="entries.length">
        <thead>
          <tr>
            <th class="col-name" @click="$emit('action', 'sort-name')">名称</th>
            <th class="col-size r" @click="$emit('action', 'sort-size')">大小</th>
            <th class="col-time" @click="$emit('action', 'sort-time')">修改时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(e, i) in entries" :key="e.name" :class="{ sel: selected === i }"
              @click="onRow(i, $event)" @dblclick="onDbl(i)">
            <td class="col-name">
              <span :class="e.isDir ? 'name-dir' : (e.isSymlink ? 'name-symlink' : '')">
                {{ e.isDir ? '📁 ' : (e.isSymlink ? '🔗 ' : '') }}{{ e.name }}<span :class="markCls(e)">{{ markText(e) }}</span>
              </span>
            </td>
            <td class="col-size r">{{ e.isDir ? '' : humanSize(e.size) }}</td>
            <td class="col-time">{{ fmtTime(e.mtime) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-else-if="!connected && pane === 'remote'" class="empty-hint">未连接 — 请在上方快速连接或在站点管理器中选择站点</div>
      <div v-else class="empty-hint">（空目录）</div>
    </div>
    <!-- 栏底统计条 -->
    <div :class="['pane-status', pane]">
      {{ files }} 个文件, {{ dirs }} 个文件夹, 共计 {{ files + dirs }} 项 ({{ humanSize(total) }})
      <span v-if="selEntry" style="float: right">选中: {{ selEntry.name }}</span>
    </div>
  </div>
</template>
