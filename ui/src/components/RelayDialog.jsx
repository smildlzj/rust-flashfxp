import { t } from '../i18n.js'
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
    <WinDialog open={open} title={t("site_to_site_transfer")} width={470} onClose={close}
      footer={<>
        <WinButton variant="outline" onClick={close}>{t("cancel")}</WinButton>
        <WinButton onClick={start} disabled={!ready}>{t("start_transfer")}</WinButton>
      </>}>
      <WinFieldset legend={t("source_site")}>
        <div className="fx-form-grid">
          <label>{t("site")}</label>
          <WinCombo value={srcSiteId} onChange={setSrcSiteId}
                    options={[{ value: '', label: t("select_a_site") },
                      ...sites.map(s => ({ value: String(s.id), label: `${s.name} (${s.host}:${s.port})` }))]} />
          <label>{t("source_path")}</label>
          <WinInput value={srcPath} onChange={(e) => setSrcPath(e.target.value)} placeholder="/tmp" />
        </div>
      </WinFieldset>
      <WinFieldset legend={t("destination_site")}>
        <div className="fx-form-grid">
          <label>{t("site")}</label>
          <div className="fx-hint" style={{ color: '#000' }}>{currentSite ? `${currentSite.host}:${currentSite.port}` : t("not_connected")}</div>
          <label>{t("destination_path")}</label>
          <div className="fx-hint" style={{ color: '#000' }}>{remoteDir || '/'}</div>
        </div>
      </WinFieldset>
      <div className="fx-hint"> {t("data_streams_through_memory_from_the_source_to_the_destination_8_256kb_pipeline_without_writing_to_disk_folders_are_copied_recursively")} </div>
    </WinDialog>
  )
}
