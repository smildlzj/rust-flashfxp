import React from 'react'
import {
  AppWindow, Zap, PlugZap, Unplug, File as FileIcon, Folder, FolderOpen,
  ArrowUp, Monitor, Network, Star, Pause, Play, House, Globe, CircleX,
  RefreshCw, GitCompareArrows, FolderInput, Trash2, RotateCcw, ListFilter,
} from 'lucide-react'

/* 旧版自绘 SVG 图标已全部替换为 lucide-react（shadcn 标准图标库）。
   保留 Ico / FxIconDefs 同名导出，调用方无需改动。 */

const ICON_MAP = {
  // 通用 / 状态
  app: AppWindow,
  file: FileIcon,
  folder: Folder,
  folderOpen: FolderOpen,
  network: Network,
  star: Star,
  statusPc: Monitor,
  miniComputer: Monitor,
  up: ArrowUp,
  greenUp: ArrowUp,

  // 连接
  connect: Zap,
  connected: PlugZap,
  disconnect: Unplug,

  // 传输 / 队列
  pause: Pause,
  pauseBig: Pause,
  play: Play,
  playBig: Play,
  playDrop: Play,
  cancel: CircleX,
  clear: Trash2,
  resume: RotateCcw,

  // 导航 / 视图
  home: House,
  globe: Globe,
  blueRefresh: RefreshCw,
  greenRefreshDoc: GitCompareArrows,
  folderTransfer: FolderInput,
  filter: ListFilter,
}

export function Ico({ name, size = 16, className = '', ...rest }) {
  const C = ICON_MAP[name] || FileIcon
  return <C size={size} className={className} aria-hidden {...rest} />
}

/* 应用 Logo：蓝色渐变圆角方块 + 白色闪电，与 src-tauri/icons/icon.png 一致。 */
export function AppLogo({ size = 40, className = '' }) {
  const id = React.useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" className={className} aria-label="Rust Flash Ftp logo" role="img">
      <defs>
        <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5AA9FF" />
          <stop offset="1" stopColor="#1752D6" />
        </linearGradient>
        <linearGradient id={`sh-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.16" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="115" fill={`url(#bg-${id})`} />
      <rect x="26" y="26" width="460" height="250" rx="100" fill={`url(#sh-${id})`} />
      <path d="M277 78 L143 268 H241 L222 434 L370 229 H272 Z" fill="#FFFFFF"
            stroke="#FFFFFF" strokeWidth="14" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* 旧版 SVG <defs> 渐变定义已弃用，保留空组件避免破坏 import。 */
export function FxIconDefs() {
  return null
}

export default Ico
