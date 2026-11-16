import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { WinButton, WinInput, WinCombo, WinFieldset, WinDialog } from '../win32.jsx'

export default function RelayDialog({ open, onOpenChange, currentSite, remoteDir, onStart }) {
  const [sites, setSites] = useState([])
  const [srcSiteId, setSrcSiteId] = useState('')
  const [srcPath, setSrcPath] = useState('/')

  useEffect(() => { if (open) api.sites().then(setSites).catch(() => {}) }, [open])

  const ready = srcSiteId !== '' && srcPath.trim() && currentSite
  const close = () => onOpenChange(false)

  const start = () => {
    const site = sites.find(s => s.id === Number(srcSiteId))
    if (!site) return
    onStart({ site, path: srcPath.trim() })
  }

  return (
    <WinDialog open={open} title="站点互传" width={470} onClose={close}
      footer={<>
        <WinButton variant="outline" onClick={close}>取消</WinButton>
        <WinButton onClick={start} disabled={!ready}>开始互传</WinButton>
      </>}>
      <WinFieldset legend="源站点">
        <div className="fx-form-grid">
          <label>站点:</label>
          <WinCombo value={srcSiteId} onChange={setSrcSiteId}
                    options={[{ value: '', label: '（选择站点）' },
                      ...sites.map(s => ({ value: String(s.id), label: `${s.name} (${s.host}:${s.port})` }))]} />
          <label>源路径:</label>
          <WinInput value={srcPath} onChange={(e) => setSrcPath(e.target.value)} placeholder="/tmp" />
        </div>
      </WinFieldset>
      <WinFieldset legend="目标站点">
        <div className="fx-form-grid">
          <label>站点:</label>
          <div className="fx-hint" style={{ color: '#000' }}>{currentSite ? `${currentSite.host}:${currentSite.port}` : '（未连接）'}</div>
          <label>目标路径:</label>
          <div className="fx-hint" style={{ color: '#000' }}>{remoteDir || '/'}</div>
        </div>
      </WinFieldset>
      <div className="fx-hint">
        数据在内存中从源站点直转目标站点（8×256KB 缓冲流水线），不落盘。目录将递归复制。
      </div>
    </WinDialog>
  )
}
