import { t } from '../i18n.js'
import React, { useEffect, useState } from 'react'
import { Ico } from '../winicons.jsx'
import { WinButton, WinInput, WinCheck, WinTabs, WinFieldset, WinDialog } from '../win32.jsx'

/* 选项 > 参数选择：原版 FlashFXP 的主设置对话框。
   所有设置都真实持久化到 uiPref，并在「应用」时同步到当前会话。 */
export default function OptionsDialog({ open, onOpenChange, uiPref, setters, currentLocalDir }) {
  const [tab, setTab] = useState('general')
  const [p, setP] = useState({
    defaultLocalDir: '',
    startupQuickbar: true,
    startupHeaderbar: true,
    startupTree: true,
    startupBottom: true,
    confirmDelete: true,
  })
  useEffect(() => {
    if (!open) return
    setP({
      defaultLocalDir: uiPref.get('defaultLocalDir', ''),
      startupQuickbar: uiPref.get('startupQuickbar', true),
      startupHeaderbar: uiPref.get('startupHeaderbar', true),
      startupTree: uiPref.get('startupTree', true),
      startupBottom: uiPref.get('startupBottom', true),
      confirmDelete: uiPref.get('confirmDelete', true),
    })
  }, [open])

  const set = (k, v) => setP(s => ({ ...s, [k]: v }))
  const close = () => onOpenChange(false)

  const apply = () => {
    uiPref.set('defaultLocalDir', p.defaultLocalDir.trim())
    uiPref.set('startupQuickbar', p.startupQuickbar)
    uiPref.set('startupHeaderbar', p.startupHeaderbar)
    uiPref.set('startupTree', p.startupTree)
    uiPref.set('startupBottom', p.startupBottom)
    uiPref.set('confirmDelete', p.confirmDelete)
    // 立即对当前会话生效，避免「改了要重启才看得到」
    setters.setShowQuick(p.startupQuickbar)
    setters.setShowHeader(p.startupHeaderbar)
    setters.setShowTree(p.startupTree)
    setters.setShowBottom(p.startupBottom)
    close()
  }

  const general = () => (
    <>
      <WinFieldset legend={t("local_browser")}>
        <div className="fx-form-grid">
          <label>{t("default_local_directory")}</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <WinInput value={p.defaultLocalDir}
                      placeholder={t("leave_blank_to_use_the_home_directory")}
                      onChange={(e) => set('defaultLocalDir', e.target.value)} />
            <WinButton compact onClick={() => set('defaultLocalDir', currentLocalDir)}>{t("use_current")}</WinButton>
          </div>
        </div>
      </WinFieldset>
      <WinFieldset legend={t("startup_layout")}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
          <WinCheck checked={p.startupQuickbar} onChange={(v) => set('startupQuickbar', v)} label={t("show_quick_connect_bar_at_startup")} />
          <WinCheck checked={p.startupHeaderbar} onChange={(v) => set('startupHeaderbar', v)} label={t("show_header_status_bar_at_startup")} />
          <WinCheck checked={p.startupTree} onChange={(v) => set('startupTree', v)} label={t("show_directory_tree_at_startup")} />
          <WinCheck checked={p.startupBottom} onChange={(v) => set('startupBottom', v)} label={t("show_queue_and_log_windows_at_startup")} />
        </div>
      </WinFieldset>
    </>
  )

  const transfer = () => (
    <WinFieldset legend={t("file_operation_confirmation")}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
        <WinCheck checked={p.confirmDelete} onChange={(v) => set('confirmDelete', v)} label={t("confirm_before_deleting_files_folders")} />
      </div>
    </WinFieldset>
  )

  return (
    <WinDialog open={open} title={t("preferences_2")} width={560} height={420} icon="app" onClose={close}
      footer={<>
        <WinButton variant="outline" onClick={close}>{t("cancel")}</WinButton>
        <WinButton onClick={apply} disabled={false}>{t("ok_o")}</WinButton>
      </>}>
      <WinTabs value={tab} onChange={setTab} tabs={[
        { value: 'general', label: t("general") },
        { value: 'transfer', label: t("transfers") },
      ]} />
      <div className="fx-tab-content" style={{ minHeight: 300 }}>
        {tab === 'general' ? general() : transfer()}
      </div>
      <div className="fx-hint" style={{ marginTop: 8 }}> {t("changes_to_the_startup_layout_apply_immediately_and_are_saved_for_the_next_launch")} </div>
    </WinDialog>
  )
}
