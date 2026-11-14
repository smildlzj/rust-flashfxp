<script setup>
defineProps({ name: String, size: { default: 16 }, color: { default: '#000' } })
</script>

<template>
  <!-- 经典 16×16 矢量图标 -->
  <svg :width="size" :height="size" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- 连接（闪电） -->
    <template v-if="name === 'connect'">
      <path d="M9 1 L4 8 L7 8 L6 15 L12 6 L9 6 Z" fill="#e6a000" stroke="#7a5500" stroke-width="0.6"/>
    </template>
    <!-- 断开（红方框X） -->
    <template v-else-if="name === 'disconnect'">
      <rect x="2" y="2" width="12" height="12" fill="#c80000"/>
      <path d="M5 5 L11 11 M11 5 L5 11" stroke="#fff" stroke-width="1.8"/>
    </template>
    <!-- 刷新（绿圆箭头） -->
    <template v-else-if="name === 'refresh'">
      <circle cx="8" cy="8" r="5" stroke="#008200" stroke-width="1.8" fill="none" stroke-dasharray="24 8"/>
      <path d="M12 3 L12 7 L8 6 Z" fill="#008200"/>
    </template>
    <!-- 上级（蓝色上箭头） -->
    <template v-else-if="name === 'up'">
      <path d="M8 2 L13 8 L10 8 L10 13 L6 13 L6 8 L3 8 Z" fill="#0046c8"/>
    </template>
    <!-- 新建目录（金色文件夹） -->
    <template v-else-if="name === 'newdir'">
      <path d="M1 4 h4 l1 1 h9 v8 H1 Z" fill="#e6a000" stroke="#7a5500" stroke-width="0.6"/>
      <path d="M1 4 v-1 h5 l1 1" fill="#e6a000" stroke="#7a5500" stroke-width="0.6"/>
    </template>
    <!-- 重命名（铅笔） -->
    <template v-else-if="name === 'rename'">
      <path d="M3 13 L3 11 L11 3 L13 5 L5 13 Z" fill="#e6a000" stroke="#555" stroke-width="0.5"/>
      <path d="M3 13 L5 13 L3 11 Z" fill="#0046c8"/>
    </template>
    <!-- 删除（红X） -->
    <template v-else-if="name === 'delete'">
      <path d="M3 3 L13 13 M13 3 L3 13" stroke="#c80000" stroke-width="2.2"/>
    </template>
    <!-- 上传（蓝箭头+托盘） -->
    <template v-else-if="name === 'upload'">
      <path d="M8 2 L12 6 L9 6 L9 10 L7 10 L7 6 L4 6 Z" fill="#0046c8"/>
      <path d="M2 12 h12" stroke="#555" stroke-width="1.6"/>
    </template>
    <!-- 下载（绿箭头+托盘） -->
    <template v-else-if="name === 'download'">
      <path d="M8 13 L12 9 L9 9 L9 5 L7 5 L7 9 L4 9 Z" fill="#008200"/>
      <path d="M2 3 h12" stroke="#555" stroke-width="1.6"/>
    </template>
    <!-- 比较（双框） -->
    <template v-else-if="name === 'compare'">
      <rect x="1" y="2" width="8" height="11" fill="#4c84d933" stroke="#0046c8" stroke-width="0.8"/>
      <rect x="6" y="4" width="9" height="10" fill="#66c03333" stroke="#008200" stroke-width="0.8"/>
    </template>
    <!-- 互传（双向箭头） -->
    <template v-else-if="name === 'relay'">
      <path d="M2 5 H12 L10 3 M10 7 L12 5" stroke="#b07000" stroke-width="1.6" fill="none"/>
      <path d="M14 10 H4 L6 8 M6 12 L4 10" stroke="#b07000" stroke-width="1.6" fill="none"/>
    </template>
    <!-- 队列 -->
    <template v-else-if="name === 'queue'">
      <path d="M2 4 H14 M2 8 H14 M2 12 H9" stroke="#1a1a6e" stroke-width="1.6"/>
    </template>
  </svg>
</template>
