import { t, getLocale, formatNumber } from '../i18n.js'
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
      { label: isLocal ? t("transfer_upload_to_remote") : t("transfer_download_to_local"), disabled: !connected, act: () => onAction('transfer', target) },
      { sep: true },
      { label: t("rename_2"), act: () => onAction('rename', target) },
      { label: t("delete"), key: 'Del', act: () => onAction('delete', target) },
      { sep: true },
      { label: t("new_folder"), key: 'F7', act: () => onAction('mkdir') },
      { label: t("refresh"), key: 'F5', act: onRefresh },
      { sep: true },
      { label: t("compare_with_other_pane"), disabled: !connected, act: () => onAction('compare') },
      { label: t("clear_comparison_marks"), act: () => onAction('clear-compare') },
      { sep: true },
      { label: t("copy_path"), act: () => navigator.clipboard?.writeText(`${address || ''}/${entries[i]?.name || ''}`) },
    ], i)
  }

  const bgMenu = (e) => {
    onContextMenu && onContextMenu(e, [
      { label: t("refresh"), key: 'F5', act: onRefresh },
      { label: t("parent_directory"), act: onNavigate },
      { label: isLocal ? t("home_directory") : t("root_directory"), act: onHome },
      { sep: true },
      { label: t("new_folder"), key: 'F7', act: () => onAction('mkdir') },
      { label: t("compare_with_other_pane"), disabled: !connected, act: () => onAction('compare') },
      { label: t("clear_comparison_marks"), act: () => onAction('clear-compare') },
      { sep: true },
      { label: t("sort_by_name"), act: () => onAction('sort-name') },
      { label: t("sort_by_size"), act: () => onAction('sort-size') },
      { label: t("sort_by_time"), act: () => onAction('sort-time') },
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
            <col style={{ width: getLocale() === 'en' ? 175 : isLocal ? 138 : 132 }} />
            {!isLocal && <col style={{ width: 84 }} />}
          </colgroup>
          <thead>
            <tr>
              {th('name', t("name"))}
              {th('size', t("size"), 'fx-th-right')}
              {th('time', t("modified"))}
              {!isLocal && <th>{t("attributes")}</th>}
            </tr>
          </thead>
          <tbody>
            {/* 原版固定首行：上级目录 */}
            <tr className="fx-row-up" onDoubleClick={onNavigate} onClick={() => onSelect(null)}>
              <td>
                <div className="fx-cell">
                  <span className="fx-cell-icon"><Ico name="up" size={16} /></span>
                  <span className="fx-cell-name">{t("parent_directory")}</span>
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
          {formatNumber(files)} {t("files")} {formatNumber(dirs)} {t("folders_total")} {formatNumber(files + dirs)} {t("items")}{total ? humanSize(total) : t("0_bytes")}
          {isLocal && diskFree ? t("value_free", [humanSize(diskFree)]) : ''})
        </div>
        <div className="fx-stat-sub">{isLocal ? t("local_browser") : (host || '')}</div>
      </div>
    </div>
  )
}
