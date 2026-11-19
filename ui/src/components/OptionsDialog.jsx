import { errorMessage, t } from '../i18n.js'
import { api } from '../api.js'
import { validateHighlightMask } from '../highlights.js'
import React, { useEffect, useState } from 'react'
import { Ico } from '../winicons.jsx'
import { WinButton, WinInput, WinCheck, WinCombo, WinTabs, WinFieldset, WinDialog } from '../win32.jsx'

/* 选项 > 参数选择：原版 FlashFXP 的主设置对话框。
   所有设置都真实持久化到 uiPref，并在「应用」时同步到当前会话。 */
export default function OptionsDialog({ open, onOpenChange, uiPref, setters, currentLocalDir }) {
  const [tab, setTab] = useState('general')
  const [picking, setPicking] = useState(false)
  const [pickerError, setPickerError] = useState('')
  const [p, setP] = useState({
    defaultLocalDir: '',
    startupQuickbar: true,
    startupHeaderbar: true,
    startupTree: true,
    startupBottom: true,
    confirmDelete: true,
    remoteEditOnSave: 'prompt',
    showActiveEditsOnOpen: true,
    rememberEditHistory: false,
    fileAssociations: [],
  })
  useEffect(() => {
    if (!open) return
    setPickerError('')
    setP({
      defaultLocalDir: uiPref.get('defaultLocalDir', ''),
      startupQuickbar: uiPref.get('startupQuickbar', true),
      startupHeaderbar: uiPref.get('startupHeaderbar', true),
      startupTree: uiPref.get('startupTree', true),
      startupBottom: uiPref.get('startupBottom', true),
      confirmDelete: uiPref.get('confirmDelete', true),
      remoteEditOnSave: uiPref.get('remoteEditOnSave', 'prompt'),
      showActiveEditsOnOpen: uiPref.get('showActiveEditsOnOpen', true),
      rememberEditHistory: uiPref.get('rememberEditHistory', false),
      fileAssociations: uiPref.get('fileAssociations', []),
    })
  }, [open])

  const set = (k, v) => setP(s => ({ ...s, [k]: v }))
  const close = () => onOpenChange(false)

  const invalidAssociation = p.fileAssociations.some(rule => validateHighlightMask(rule.pattern.trim()))

  const apply = () => {
    if (invalidAssociation || picking) return
    if (uiPref.set('fileAssociations', p.fileAssociations.map(rule => ({ ...rule, pattern: rule.pattern.trim() }))) === false) {
      setPickerError(t('file_edit_association_save_failed'))
      setTab('viewEdit')
      return
    }
    uiPref.set('defaultLocalDir', p.defaultLocalDir.trim())
    uiPref.set('startupQuickbar', p.startupQuickbar)
    uiPref.set('startupHeaderbar', p.startupHeaderbar)
    uiPref.set('startupTree', p.startupTree)
    uiPref.set('startupBottom', p.startupBottom)
    uiPref.set('confirmDelete', p.confirmDelete)
    uiPref.set('remoteEditOnSave', p.remoteEditOnSave)
    uiPref.set('showActiveEditsOnOpen', p.showActiveEditsOnOpen)
    uiPref.set('rememberEditHistory', p.rememberEditHistory)
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

  const savePolicies = [
    { value: 'manual', label: t('file_edit_manual_upload') },
    { value: 'prompt', label: t('file_edit_prompt_upload') },
    { value: 'upload', label: t('file_edit_auto_upload') },
  ]
  const updateAssociation = (index, patch) => setP(current => ({
    ...current,
    fileAssociations: current.fileAssociations.map((rule, i) => i === index ? { ...rule, ...patch } : rule),
  }))
  const browseAssociation = async (index, action) => {
    setPicking(true)
    setPickerError('')
    try {
      const path = await api.pickAssociatedApp()
      if (path) updateAssociation(index, { [action]: path })
    } catch (problem) {
      setPickerError(errorMessage(problem))
    } finally {
      setPicking(false)
    }
  }
  const associationApplication = (index, action, value, label, placeholder) => (
    <div className="flex items-center gap-2">
      <WinInput className="min-w-0 flex-1" readOnly aria-label={t(label)} placeholder={t(placeholder)}
        value={value} title={value || undefined} />
      <WinButton compact variant="outline" disabled={picking} aria-label={t('browse') + ' ' + t(label)}
        onClick={() => browseAssociation(index, action)}>{t('browse')}</WinButton>
      <WinButton compact variant="outline" disabled={picking || !value} aria-label={t('clear_program') + ' ' + t(label)}
        onClick={() => updateAssociation(index, { [action]: '' })}>{t('clear_program')}</WinButton>
    </div>
  )
  const viewEdit = () => (
    <>
      <WinFieldset legend={t('file_edit_remote_save')}>
        <WinCombo aria-label={t('file_edit_remote_save')} options={savePolicies}
          value={p.remoteEditOnSave} onChange={value => set('remoteEditOnSave', value)} />
        <div className="mt-2 flex flex-col gap-2">
          <WinCheck checked={p.showActiveEditsOnOpen} label={t('show_active_edits_on_open')}
            onChange={value => set('showActiveEditsOnOpen', value)} />
          <WinCheck checked={p.rememberEditHistory} label={t('remember_edit_history')}
            onChange={value => set('rememberEditHistory', value)} />
        </div>
      </WinFieldset>
      <WinFieldset legend={t('file_edit_associations')}>
        <div className="flex flex-col gap-2">
          <p className="fx-hint">{t('file_edit_association_hint')}</p>
          {pickerError && <p role="alert" className="text-destructive">{pickerError}</p>}
          {p.fileAssociations.map((rule, index) => (
            <div key={index} className="flex flex-col gap-1 rounded border border-border p-2">
              <WinInput aria-label={t('file_edit_pattern')} placeholder="*.txt" value={rule.pattern}
                onChange={event => updateAssociation(index, { pattern: event.target.value })} />
              {validateHighlightMask(rule.pattern.trim()) && <p role="alert" className="text-destructive">
                {t(validateHighlightMask(rule.pattern.trim()))}
              </p>}
              {associationApplication(index, 'view', rule.view, 'view_file', 'file_edit_viewer_path')}
              {associationApplication(index, 'edit', rule.edit, 'edit_file', 'file_edit_editor_path')}
              <WinCombo aria-label={t('file_edit_remote_save')} value={rule.policy || ''}
                options={[{ value: '', label: t('file_edit_global_policy') }, ...savePolicies]}
                onChange={value => updateAssociation(index, { policy: value })} />
              <WinButton compact variant="outline" disabled={picking} onClick={() => set('fileAssociations', p.fileAssociations.filter((_, i) => i !== index))}>
                {t('delete')}
              </WinButton>
            </div>
          ))}
          <WinButton compact variant="outline" onClick={() => set('fileAssociations',
            [...p.fileAssociations, { pattern: '*', view: '', edit: '', policy: '' }])}>
            {t('file_edit_add_association')}
          </WinButton>
        </div>
      </WinFieldset>
    </>
  )

  return (
    <WinDialog open={open} title={t("preferences_2")} width={760} height={620} fixedHeight icon="app" onClose={close}
      footer={<>
        <WinButton variant="outline" onClick={close}>{t("cancel")}</WinButton>
        <WinButton onClick={apply} disabled={invalidAssociation || picking}>{t("ok_o")}</WinButton>
      </>}>
      <WinTabs value={tab} onChange={setTab} tabs={[
        { value: 'general', label: t("general") },
        { value: 'transfer', label: t("transfers") },
        { value: 'viewEdit', label: t('file_edit_preferences') },
      ]} />
      <div className="fx-tab-content" style={{ minHeight: 300 }}>
        {tab === 'general' ? general() : tab === 'transfer' ? transfer() : viewEdit()}
      </div>
      <div className="fx-hint" style={{ marginTop: 8 }}> {t("changes_to_the_startup_layout_apply_immediately_and_are_saved_for_the_next_launch")} </div>
    </WinDialog>
  )
}
