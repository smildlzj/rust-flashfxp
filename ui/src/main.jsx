import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { LanguageProvider } from './LanguageContext.jsx'
import './index.css'

// 桌面程序：屏蔽 WebView 默认右键菜单（后续替换为自定义上下文菜单）
window.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea, .fx-log')) return
  e.preventDefault()
})

// 把任何未捕获错误直接画到界面上，避免“白屏无信息”
function paintError(label, err) {
  try {
    const msg = (err && (err.message || err.reason?.message)) || String(err)
    const stack = (err && (err.stack || err.reason?.stack)) || ''
    console.error('[Rust Flash Ftp]', label, err)
    const d = document.createElement('pre')
    d.setAttribute('data-fx-error', '1')
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;color:#fff;background:#7f1d1d;padding:24px;margin:0;overflow:auto;white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace'
    d.textContent = `RUNTIME-ERROR (${label})\n\n${msg}\n\n${stack}`
    document.body.appendChild(d)
  } catch {}
}
window.addEventListener('error', (e) => paintError('error', e.error || e))
window.addEventListener('unhandledrejection', (e) => paintError('rejection', e.reason || e))

// 兜底 ErrorBoundary：覆盖渲染期/生命周期错误（module 级错误由上面的 try/catch 兜）
class FxErrorBoundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err } }
  componentDidCatch(err) { paintError('boundary', err) }
  render() {
    if (this.state.err) return null // paintError 已绘制
    return this.props.children
  }
}

try {
  createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <FxErrorBoundary>
        <LanguageProvider><App /></LanguageProvider>
      </FxErrorBoundary>
    </React.StrictMode>
  )
} catch (err) {
  paintError('mount', err)
}
