import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// 桌面程序：屏蔽 WebView 默认右键菜单（后续替换为自定义上下文菜单）
window.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea')) return
  e.preventDefault()
})

window.addEventListener('error', (e) => {
  const d = document.createElement('pre')
  d.style.cssText = 'position:fixed;top:40px;left:20px;z-index:99999;color:#fff;background:#c00;padding:12px;max-width:90vw;white-space:pre-wrap;font:12px monospace'
  d.textContent = 'RUNTIME-ERROR: ' + (e.error?.stack || e.message)
  document.body.appendChild(d)
})
window.addEventListener('unhandledrejection', (e) => {
  const d = document.createElement('pre')
  d.style.cssText = 'position:fixed;top:40px;left:20px;z-index:99999;color:#fff;background:#a00;padding:12px;max-width:90vw;white-space:pre-wrap;font:12px monospace'
  d.textContent = 'REJECTION: ' + String(e.reason?.stack || e.reason)
  document.body.appendChild(d)
})

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
