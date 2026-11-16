import React, { useState } from 'react'
import { Ico } from '../winicons.jsx'
import { humanSize, fmtTime } from '../api.js'

const MARK_TXT = { same: '·', only: '＋', diff: '▲' }

export default function FilePane({
  pane, title, entries, selected, marks, address, connected, diskFree, host, sort,
  onNavigate, onRefresh, onSelect, onActivate, onAction, onAddressGo, onHome,
  onContextMenu, onDropTransfer,
}) {
  const [dragOver, setDragOver] = useState(false)
  const files = entries.filter(e => !e.isDir).length
  const dirs = entries.filter(e => e.isDir).length
  const total = entries.reduce((s, e) => s + (e.size || 0), 0)
  const isLocal = pane === 'local'

  // 栏间拖放：本地 → 远程 = 上传；远程 → 本地 = 下载
  const handleDrop = (ev) => {
    ev.preventDefault()
    setDragOver(false)
    let payload = null
    try { payload = JSON.parse(ev.dataTransfer.getData('application/x-fx-drag')) } catch {}
    if (!payload || payload.pane === pane || !connected) return
    const direction = pane === 'remote' ? 'upload' : 'download'
    onDropTransfer && onDropTransfer(direction, payload.name, payload.isDir)
  }

  const rowMenu = (e, i) => {
    const target = entries[i]
    onSelect(i)
    onContextMenu && onContextMenu(e, [
      { label: isLocal ? '传输（上传到远程）' : '传输（下载到本地）', disabled: !connected, act: () => onAction('transfer', target) },
      { label: '传送为…', disabled: true },
      { sep: true },
      { label: '重命名…', act: () => onAction('rename', target) },
      { label: '删除', key: 'Del', act: () => onAction('delete', target) },
      { sep: true },
      { label: '新建目录…', key: 'F7', act: () => onAction('mkdir') },
      { label: '刷新', key: 'F5', act: onRefresh },
      { sep: true },
      { label: '与对侧比较', disabled: !connected, act: () => onAction('compare') },
      { label: '清除比较标记', act: () => onAction('clear-compare') },
      { sep: true },
      { label: '复制路径', act: () => navigator.clipboard?.writeText(`${address || ''}/${entries[i]?.name || ''}`) },
      { label: '属性…', disabled: true },
    ], i)
  }

  const bgMenu = (e) => {
    onContextMenu && onContextMenu(e, [
      { label: '刷新', key: 'F5', act: onRefresh },
      { label: '上级目录', act: onNavigate },
      { label: isLocal ? '主目录' : '根目录', act: onHome },
      { sep: true },
      { label: '新建目录…', key: 'F7', act: () => onAction('mkdir') },
      { label: '与对侧比较', disabled: !connected, act: () => onAction('compare') },
      { label: '清除比较标记', act: () => onAction('clear-compare') },
      { sep: true },
      { label: '按名称排序', act: () => onAction('sort-name') },
      { label: '按大小排序', act: () => onAction('sort-size') },
      { label: '按时间排序', act: () => onAction('sort-time') },
    ])
  }

  const th = (key, label, cls = '') => (
    <th className={`${cls} ${sort?.key === key ? 'fx-sorted' : ''} ${sort?.key === key && sort?.desc ? 'desc' : ''}`}
        onClick={() => onAction(`sort-${key}`)}>{label}</th>
  )

  return (
    <div
      className="fx-pane"
      style={{ outline: dragOver ? '2px dotted #316ac5' : undefined, outlineOffset: -3 }}
      onDragOver={(ev) => {
        if (!connected) return
        ev.preventDefault()
        ev.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* 文件列表（ListView 报表） */}
      <div className="fx-list-wrap fx-scroll" onContextMenu={bgMenu}>
        <table className="fx-list listview">
          <colgroup>
            <col />
            <col style={{ width: isLocal ? 66 : 62 }} />
            <col style={{ width: isLocal ? 138 : 132 }} />
            {!isLocal && <col style={{ width: 84 }} />}
          </colgroup>
          <thead>
            <tr>
              {th('name', '名称')}
              {th('size', '大小', 'fx-th-right')}
              {th('time', '修改时间')}
              {!isLocal && <th>属性</th>}
            </tr>
          </thead>
          <tbody>
            {/* 原版固定首行：上级目录 */}
            <tr className="fx-row-up" onDoubleClick={onNavigate} onClick={() => onSelect(null)}>
              <td>
                <div className="fx-cell">
                  <span className="fx-cell-icon"><Ico name="up" size={16} /></span>
                  <span className="fx-cell-name">上级目录</span>
                </div>
              </td>
              <td /><td />{!isLocal && <td />}
            </tr>
            {entries.map((e, i) => (
              <tr
                key={e.name}
                draggable
                className={`${selected === i ? 'fx-selected' : ''} ${marks && marks[e.name] ? `fx-mark-${marks[e.name]}` : ''}`}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData('application/x-fx-drag', JSON.stringify({ pane, name: e.name, isDir: e.isDir }))
                  ev.dataTransfer.setData('text/plain', e.name)
                  ev.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onSelect(i)}
                onDoubleClick={() => onActivate(i)}
                onContextMenu={(ev) => rowMenu(ev, i)}
              >
                <td title={e.name}>
                  <div className="fx-cell">
                    <span className="fx-cell-icon">
                      <Ico name={e.isDir ? 'folder' : 'file'} size={16} />
                    </span>
                    <span className="fx-cell-name">{e.name}</span>
                    {marks && marks[e.name] && <span className="fx-mark">{MARK_TXT[marks[e.name]]}</span>}
                  </div>
                </td>
                <td className="fx-num">{e.isDir ? '' : humanSize(e.size)}</td>
                <td>{fmtTime(e.mtime)}</td>
                {!isLocal && <td className="fx-perm">{e.perms ? (e.isDir ? 'd' : '-') + e.perms : ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 栏底统计条（两行） */}
      <div className={`fx-stat ${isLocal ? 'local' : 'remote'}`}>
        <div className="fx-stat-line">
          {files} 个文件, {dirs} 个文件夹, 共计 {files + dirs} 项 ({total ? humanSize(total) : '0 字节'}
          {isLocal && diskFree ? ` / ${humanSize(diskFree)} 可用` : ''})
        </div>
        <div className="fx-stat-sub">{isLocal ? '本地浏览器' : (host || '')}</div>
      </div>
    </div>
  )
}
