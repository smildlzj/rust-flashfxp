import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Ico } from './winicons.jsx'

/* 轻量 tooltip：fixed 浮层，样式对齐 shadcn（前景色底 / 背景色字）。
   不依赖 base-ui Tooltip（在该 WebView 中 render-prop 事件未生效）。 */
function FxTip({ title, side = 'bottom', disabled, children }) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const ref = useRef(null)
  const timer = useRef(null)

  const open = () => {
    if (!title) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const cx = r.left + r.width / 2
      setPos(side === 'top' ? { x: cx, y: r.top } : { x: cx, y: r.bottom })
      setShow(true)
    }, 350)
  }
  const close = () => { clearTimeout(timer.current); setShow(false) }
  useEffect(() => () => clearTimeout(timer.current), [])

  const child = React.cloneElement(children, {
    ref: (node) => {
      ref.current = node
      const cr = children.ref
      if (typeof cr === 'function') cr(node)
      else if (cr && typeof cr === 'object') cr.current = node
    },
    onMouseEnter: open,
    onMouseLeave: close,
    onFocus: open,
    onBlur: close,
  })

  return (
    <>
      {child}
      {show && createPortal(
        <div
          className="fx-tip"
          style={{
            position: 'fixed', left: pos.x, top: pos.y,
            transform: side === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
          }}
          role="tooltip"
        >
          {title}
        </div>,
        document.body
      )}
    </>
  )
}

/* ===================== 基础控件（shadcn 封装） ===================== */

export function WinButton({ children, className = '', compact, iconOnly, pressed, variant, size, ...rest }) {
  return (
    <Button
      variant={variant || 'default'}
      size={iconOnly ? 'icon' : compact ? 'sm' : (size || 'default')}
      aria-pressed={pressed || undefined}
      className={cn(pressed && 'bg-accent text-accent-foreground', className)}
      {...rest}
    >{children}</Button>
  )
}

export function WinInput({ className = '', ...rest }) {
  return <Input className={className} {...rest} />
}

export function WinCheck({ checked, onChange, label, disabled }) {
  return (
    <label className="flex items-center gap-2 text-sm leading-none select-none cursor-pointer">
      <Checkbox checked={checked} onCheckedChange={(v) => !disabled && onChange(!!v)} disabled={disabled} />
      {label != null && <span>{label}</span>}
    </label>
  )
}

export function WinFieldset({ legend, children, className = '' }) {
  return (
    <fieldset className={cn('rounded-lg border border-border p-3', className)}>
      {legend && <legend className="px-1.5 text-xs font-medium text-muted-foreground">{legend}</legend>}
      {children}
    </fieldset>
  )
}

export function WinCombo({ value, onChange, options, className = '', small, ...rest }) {
  return (
    <span className={cn('fx-combo', small && 'small', className)}>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
        {options.map((o) => <option key={String(o.value)} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="fx-combo-chevron" size={14} aria-hidden="true" />
    </span>
  )
}

export function WinTabs({ tabs, value, onChange }) {
  return (
    <div className="fx-tabs">
      {tabs.map((t) => (
        <button key={t.value} type="button" className={`fx-tab-pane ${value === t.value ? 'fx-active' : ''}`}
                onClick={() => onChange(t.value)}>{t.label}</button>
      ))}
    </div>
  )
}

export function WinDialog({ open, title, width = 640, height, fixedHeight = false, onClose, children, footer, icon = 'app', contentClassName = '' }) {
  if (!open) return null
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose && onClose() }}>
      <DialogContent
        style={{ width, maxWidth: '95vw', height: fixedHeight && height ? `min(${height}px, 90vh)` : undefined, maxHeight: height ? `min(${height}px, 90vh)` : '85vh' }}
        className="flex flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="m-0 shrink-0 border-b border-border px-4 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            {icon && <Ico name={icon} size={16} className="text-muted-foreground" />}
            <span>{title}</span>
          </DialogTitle>
        </DialogHeader>
        <div className={cn('min-h-0 flex-1 overflow-auto px-4 py-3', contentClassName)}>{children}</div>
        {footer && (
          <DialogFooter className="m-0 shrink-0 border-t border-border bg-background px-4 py-3">
            {footer}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ===================== 菜单栏（保持数据驱动，外观由 .fx-* CSS 控制） ===================== */

export function WinMenuBar({ menus }) {
  const [open, setOpen] = useState(null)
  const [submenu, setSubmenu] = useState(null)
  const ref = useRef(null)
  const close = () => { setOpen(null); setSubmenu(null) }
  useEffect(() => {
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) close() }
    const onKey = e => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('fx-close-menus', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fx-close-menus', close)
    }
  }, [])
  const navigate = (event, path) => {
    if (event.key === 'ArrowLeft' && path) {
      event.preventDefault(); event.stopPropagation()
      setSubmenu(null)
      event.currentTarget.parentElement.querySelector(':scope > button')?.focus()
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')]
      .filter(button => button.closest('[role="menu"]') === event.currentTarget)
    const index = buttons.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus()
  }
  const renderItems = (items, path = '') => items.map((item, index) => {
    const key = `${path}/${index}`
    if (item.sep) return <div role="separator" className="fx-menu-sep" key={key} />
    const expanded = submenu === key
    const button = <button type="button" className="fx-menu-row" disabled={!!item.disabled}
      role={item.checked !== undefined ? 'menuitemradio' : 'menuitem'}
      aria-checked={item.checked !== undefined ? !!item.checked : undefined}
      aria-haspopup={item.items ? 'menu' : undefined}
      aria-expanded={item.items ? expanded : undefined}
      autoFocus={index === 0}
      onMouseEnter={() => { if (item.items) setSubmenu(key); else if (!path) setSubmenu(null) }}
      onKeyDown={event => {
        if (item.items && event.key === 'ArrowRight') {
          event.preventDefault(); event.stopPropagation(); setSubmenu(key)
        }
      }}
      onClick={() => {
        if (item.items) setSubmenu(key)
        else { close(); item.act?.() }
      }}>
      <span className="fx-menu-check">{item.checked ? '✓' : ''}</span>
      <span className="fx-menu-label">{typeof item.label === 'function' ? item.label() : item.label}</span>
      {item.key && <span className="fx-menu-key">{item.key}</span>}
      {item.items && <span aria-hidden="true">›</span>}
    </button>
    return <div key={key} className="fx-menu-item" role="none">
      {button}
      {item.items && expanded && <div role="menu" aria-label={item.label}
        className="fx-menu-popup fx-menu-submenu" onKeyDown={event => navigate(event, key)}>
        {renderItems(item.items, key)}
      </div>}
    </div>
  })
  return <div className="fx-menubar" ref={ref} role="menubar">
    {menus.map((menu, index) => <div key={index} style={{ position: 'relative' }}>
      <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === index}
        className={`fx-menu-top ${open === index ? 'fx-open' : ''}`}
        onClick={() => { setSubmenu(null); setOpen(open === index ? null : index) }}
        onMouseEnter={() => { if (open !== null && open !== index) { setSubmenu(null); setOpen(index) } }}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(index) } }}>
        {menu.name}
      </button>
      {open === index && <div role="menu" aria-label={menu.name} className="fx-menu-popup"
        onKeyDown={event => navigate(event, '')}>{renderItems(menu.items)}</div>}
    </div>)}
  </div>
}

/* ===================== 右键菜单 ===================== */

export function useWinContextMenu() {
  const [menu, setMenu] = useState(null)
  const openMenu = (e, items, rowIndex) => {
    e.preventDefault()
    e.stopPropagation()
    const x = Math.min(e.clientX, window.innerWidth - 190)
    const y = Math.min(e.clientY, window.innerHeight - 30 - items.length * 22)
    setMenu({ x: Math.max(2, x), y: Math.max(2, y), items, rowIndex })
  }
  const closeMenu = () => setMenu(null)
  useEffect(() => {
    if (!menu) return
    const onDown = () => closeMenu()
    const onKey = (e) => { if (e.key === 'Escape') closeMenu() }
    const onForceClose = () => closeMenu()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('fx-close-menus', onForceClose)
    window.addEventListener('blur', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fx-close-menus', onForceClose)
      window.removeEventListener('blur', onDown)
    }
  }, [menu])
  return { menu, openMenu, closeMenu }
}

export function WinContextMenu({ menu, onClose }) {
  if (!menu) return null
  return (
    <div className="fx-ctx" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
      {menu.items.map((it, i) => it.sep
        ? <div className="fx-menu-sep" key={i} />
        : (
          <button key={i} className="fx-menu-row" disabled={!!it.disabled}
                  onClick={() => { onClose(); it.act && it.act() }}>
            <span className="fx-menu-check">{it.checked ? '✓' : ''}</span>
            <span className="fx-menu-label">{it.label}</span>
            {it.key && <span className="fx-menu-key">{it.key}</span>}
          </button>
        ))}
    </div>
  )
}

/* ===================== 工具栏按钮 ===================== */

export function WinToolButton({ icon, size = 24, title, disabled, pressed, big, onClick, className = '' }) {
  const btn = (
    <Button
      variant={pressed ? 'secondary' : 'ghost'}
      size={big ? 'icon-lg' : 'icon'}
      title={title}
      disabled={disabled}
      aria-pressed={pressed || undefined}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      className={className}
    >
      <Ico name={icon} size={big ? 20 : 18} />
    </Button>
  )
  if (!title) return btn
  return <FxTip title={title} side="bottom">{btn}</FxTip>
}

/* 给任意图标元素（原生 button 等）加 tooltip。 */
export function IconTip({ title, side = 'bottom', children }) {
  if (!title) return children
  return <FxTip title={title} side={side}>{children}</FxTip>
}

export default WinDialog
