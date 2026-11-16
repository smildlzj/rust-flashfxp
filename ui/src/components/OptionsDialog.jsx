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
      <WinFieldset legend="本地浏览器">
        <div className="fx-form-grid">
          <label>默认本地目录:</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <WinInput value={p.defaultLocalDir}
                      placeholder="留空则使用用户主目录"
                      onChange={(e) => set('defaultLocalDir', e.target.value)} />
            <WinButton compact onClick={() => set('defaultLocalDir', currentLocalDir)}>使用当前</WinButton>
          </div>
        </div>
      </WinFieldset>
      <WinFieldset legend="启动布局">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
          <WinCheck checked={p.startupQuickbar} onChange={(v) => set('startupQuickbar', v)} label="启动时显示快速连接栏" />
          <WinCheck checked={p.startupHeaderbar} onChange={(v) => set('startupHeaderbar', v)} label="启动时显示头部状态栏" />
          <WinCheck checked={p.startupTree} onChange={(v) => set('startupTree', v)} label="启动时显示目录树" />
          <WinCheck checked={p.startupBottom} onChange={(v) => set('startupBottom', v)} label="启动时显示队列与日志窗口" />
        </div>
      </WinFieldset>
    </>
  )

  const transfer = () => (
    <WinFieldset legend="文件操作确认">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px' }}>
        <WinCheck checked={p.confirmDelete} onChange={(v) => set('confirmDelete', v)} label="删除文件 / 目录前询问确认" />
      </div>
    </WinFieldset>
  )

  return (
    <WinDialog open={open} title="参数选择" width={560} height={420} icon="app" onClose={close}
      footer={<>
        <WinButton variant="outline" onClick={close}>取消</WinButton>
        <WinButton onClick={apply} disabled={false}>确定(O)</WinButton>
      </>}>
      <WinTabs value={tab} onChange={setTab} tabs={[
        { value: 'general', label: '常规' },
        { value: 'transfer', label: '传输' },
      ]} />
      <div className="fx-tab-content" style={{ height: 300 }}>
        {tab === 'general' ? general() : transfer()}
      </div>
      <div className="fx-hint" style={{ marginTop: 8 }}>
        提示：修改「启动布局」会立即影响当前窗口并保存到下次启动。
      </div>
    </WinDialog>
  )
}
