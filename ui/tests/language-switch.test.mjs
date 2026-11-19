import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
import * as i18n from '../src/i18n.js'
import * as quickConnect from '../src/quick-connect.js'

const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const { code } = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', format: 'esm', jsx: 'transform' })
const states = []
let cursor = 0
let newSessions = 0
const deleted = []
const listings = []
let openContextMenu
let editorSave
const effects = []
const windowTitles = []
const context = vm.createContext({ localStorage: { getItem: () => null }, window: {}, document: {}, setTimeout, clearTimeout })
const module = new vm.SourceTextModule(code, { context })
const stub = () => null
const react = { ...React, useState: initial => {
  const index = cursor++
  if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
  return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
}, useRef: initial => ({ current: initial }), useMemo: fn => fn(), useEffect: (fn, deps) => effects.push({ fn, deps }) }
await module.link(async name => {
  const exports = name === 'react' ? { ...react, default: react }
    : name.includes('i18n') ? i18n
    : name.includes('quick-connect') ? quickConnect
    : name.includes('LanguageContext') ? { useLanguage: () => ({ language: i18n.getLocale(), setLanguage: i18n.setCurrentLocale }) }
    : name.endsWith('/api.js') ? { api: { sites: async () => [{ id: 1, name: 'Saved Site', host: 'actual.test' }], onFileEditorSave: async handler => { editorSave = handler; return stub }, setWindowTitle: async title => { windowTitles.push(title) }, newSession: async () => { newSessions++ }, deleteLocal: async paths => deleted.push(...paths), deleteRemote: async paths => deleted.push(...paths), localList: async path => listings.push(['local', path]), remoteList: async path => listings.push(['remote', path]) }, init: stub, onEvent: stub, remoteJoin: (base, name) => `${base}/${name}`, remoteParent: stub, humanSize: String }
    : name.includes('winicons') ? { Ico: stub, FxIconDefs: stub, AppLogo: stub }
    : name.includes('win32') ? Object.fromEntries(['WinMenuBar','WinButton','WinInput','WinCheck','WinDialog','WinFieldset','WinToolButton','WinContextMenu','IconTip'].map(k => [k,stub]).concat([['useWinContextMenu', () => ({ openMenu: (_event, items) => { openContextMenu = items } })]]))
    : { default: stub }
  return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key,value] of Object.entries(exports)) this.setExport(key,value) }, { context })
})
await module.evaluate()
function render() { cursor = 0; return module.namespace.default() }
function all(node) {
  if (!node || typeof node !== 'object') return []
  return [node, ...React.Children.toArray(node.props?.children).flatMap(all)]
}
test('language switch preserves existing connected session and queue state and translates menus', async () => {
  i18n.setCurrentLocale('zh-CN')
  render()
  states[0] = true // Existing connection, independent of the language context.
  states[1] = { name: '中文站点', host: 'example.test', port: 21 }
  states[18] = [{ id: 4, direction: 'upload', local: '/tmp/中文.txt', remote: '/中文.txt', size: 1024, transferred: 512, status: 'active' }]
  states[19] = [{ text: '[10:00:00] 旧日志保持中文', level: 'info' }]
  const before = [...states]
  const chineseMenus = all(render()).find(n => n.props?.menus)?.props.menus
  const languageMenu = chineseMenus[2].items.find(item => item.items)
  assert.deepEqual(Array.from(languageMenu.items, item => item.label), ['简体中文', 'English'])
  assert.equal(languageMenu.items[0].checked, true)
  languageMenu.items[1].act()
  const tree = render()
  assert.deepEqual(states, before)
  const menus = all(tree).find(n => n.props?.menus)?.props.menus
  assert.equal(menus[0].name, 'Session(E)')
  assert.equal(menus[2].items[0].label, 'Language')
  assert.equal(menus[2].items[0].items[1].checked, true)
  assert.equal(menus[0].items[0].label, 'New Session')
  assert.equal(menus[0].items[0].key, 'F12')
  await menus[0].items[0].act()
  assert.equal(newSessions, 1)
  assert.ok(all(tree).some(n => React.Children.toArray(n.props?.children).some(c => typeof c === 'string' && c.includes('中文站点'))))
  i18n.setCurrentLocale('zh-CN')
})

for (const pane of ['local', 'remote']) {
  test(`${pane}: locale reordering keeps deletion targeted at the selected filename`, async () => {
    i18n.setCurrentLocale('zh-CN')
    const entries = ['中.txt', '阿.txt', 'a.txt', 'z.txt'].map(name => ({ name, isDir: false, size: 1 }))
    states[pane === 'local' ? 3 : 7] = '/test'
    states[pane === 'local' ? 4 : 8] = entries
    let filePane = all(render()).find(n => n.props?.pane === pane)
    filePane.props.onSelect(filePane.props.entries.findIndex(e => e.name === '阿.txt'))
    render()
    i18n.setCurrentLocale('en')
    filePane = all(render()).find(n => n.props?.pane === pane)
    assert.deepEqual(Array.from(filePane.props.selectedNames), ['阿.txt'])
    const count = deleted.length
    const confirmation = () => all(render()).find(n => n.props?.open && n.props.title === i18n.t('delete'))
    const confirmationButton = label => all(confirmation().props.footer).find(n => n.props?.children === i18n.t(label))
    filePane.props.onAction('delete')
    assert.equal(confirmation().props.children, i18n.t('delete_value', ['阿.txt']))
    assert.equal(deleted.length, count)
    confirmationButton('cancel').props.onClick()
    assert.equal(confirmation(), undefined)
    assert.equal(deleted.length, count)

    const clicked = filePane.props.entries.find(e => e.name === 'z.txt')
    filePane.props.onAction('delete', clicked)
    assert.equal(confirmation().props.children, i18n.t('delete_value', ['z.txt']))
    confirmationButton('delete').props.onClick()
    await Promise.resolve()
    assert.deepEqual(deleted.slice(count), ['/test/z.txt'])
    filePane = all(render()).find(n => n.props?.pane === pane)
    const indexOf = name => filePane.props.entries.findIndex(e => e.name === name)
    filePane.props.onSelect(indexOf('a.txt'))
    filePane.props.onSelect(indexOf('z.txt'), { shiftKey: true })
    filePane.props.onSelect(indexOf('阿.txt'), { metaKey: true })
    filePane = all(render()).find(n => n.props?.pane === pane)
    assert.deepEqual(Array.from(filePane.props.selectedNames), ['a.txt', 'z.txt', '阿.txt'])
    filePane.props.onAction('delete', filePane.props.entries[indexOf('z.txt')])
    assert.equal(confirmation().props.children, i18n.t('delete_items_value', [3]))
    confirmationButton('delete').props.onClick()
    await Promise.resolve()
    assert.deepEqual(deleted.slice(count + 1), ['/test/a.txt', '/test/z.txt', '/test/阿.txt'])

    for (const key of [{ key: 'Delete' }, { key: 'Backspace', metaKey: true }, null]) {
      filePane.props.onSelect(indexOf('a.txt'))
      filePane.props.onSelect(indexOf('z.txt'), { ctrlKey: true })
      const listeners = new Map()
      context.document.addEventListener = (type, listener) => listeners.set(type, listener)
      context.document.removeEventListener = type => listeners.delete(type)
      effects.length = 0
      const tree = render()
      const cleanup = effects.find(effect => effect.fn.toString().includes('addEventListener("keydown"'))?.fn()
      try {
        let prevented = false
        if (key) {
          listeners.get('keydown')({ ...key, target: {}, preventDefault: () => { prevented = true } })
          assert.equal(prevented, true)
        } else {
          const menus = all(tree).find(node => node.props?.menus).props.menus
          menus.find(menu => menu.name === i18n.t('directory_d')).items.find(item => item.key === 'Del').act()
        }
        assert.equal(confirmation().props.children, i18n.t('delete_items_value', [2]))
        const beforeDelete = deleted.length
        confirmationButton('delete').props.onClick()
        await Promise.resolve()
        assert.deepEqual(deleted.slice(beforeDelete), ['/test/a.txt', '/test/z.txt'])
      } finally {
        cleanup?.()
      }
    }
    i18n.setCurrentLocale('zh-CN')
  })
}


test('window title follows connected station changes and resets on disconnect', async () => {
  async function update(connected, site) {
    states[0] = connected
    states[1] = site
    effects.length = 0
    render()
    // Run the connection-dependent rendered effect, with the same inputs React observes.
    for (const effect of effects) {
      if (effect.deps?.length === 2 && effect.deps[0] === connected && effect.deps[1] === site) effect.fn()
    }
    await Promise.resolve()
    assert.equal(context.document.title, windowTitles.at(-1))
    return windowTitles.at(-1)
  }
  const station = { name: '生产服务器', host: 'prod.example', port: 22 }
  assert.equal(await update(false, station), 'Rust Flash Ftp')
  assert.equal(await update(true, station), '生产服务器 — Rust Flash Ftp')
  assert.equal(await update(true, { name: '备份服务器', host: 'backup.example', port: 22 }), '备份服务器 — Rust Flash Ftp')
  assert.equal(await update(true, { host: 'quick.example', port: 2121 }), 'quick.example:2121 — Rust Flash Ftp')
  assert.equal(await update(false, station), 'Rust Flash Ftp')
})

test('Directory menu refreshes both current paths and F5 works in the address field', () => {
  states[3] = '/test/local'
  states[7] = '/test/remote'
  const listeners = new Map()
  context.document.addEventListener = (type, listener) => listeners.set(type, listener)
  context.document.removeEventListener = type => listeners.delete(type)
  effects.length = 0
  const tree = render()
  const menus = all(tree).find(node => node.props?.menus).props.menus
  const directory = menus.find(menu => menu.name === i18n.t('directory_d'))
  const expected = [['local', '/test/local'], ['remote', '/test/remote']]
  listings.length = 0
  directory.items.find(item => item.key === 'F5').act()
  assert.deepEqual(listings, expected)
  listings.length = 0
  const cleanup = effects.find(effect => effect.fn.toString().includes('addEventListener("keydown"')).fn()
  try {
    listeners.get('keydown')({ key: 'F5', target: { tagName: 'INPUT' }, preventDefault() {} })
    assert.deepEqual(listings, expected)
  } finally {
    cleanup()
  }
})

test('typing in the remote list selects a case-insensitive name prefix and scrolls it into view', () => {
  states[7] = '/test'
  states[8] = [{ name: 'Alpha', isDir: true }, { name: 'Archive', isDir: true }]
  const listeners = new Map()
  context.document.addEventListener = (type, listener) => listeners.set(type, listener)
  context.document.removeEventListener = type => listeners.delete(type)
  const remotePane = () => all(render()).find(node => node.props?.pane === 'remote')
  remotePane().props.onSelect(0)
  effects.length = 0
  render()
  const cleanup = effects.find(effect => effect.fn.toString().includes('addEventListener("keydown"')).fn()
  const scrolled = []
  const list = {
    dataset: { fileList: 'remote' },
    querySelectorAll: () => ['Alpha', 'Archive'].map(name => ({
      scrollIntoView: () => scrolled.push(name),
    })),
  }
  const press = key => listeners.get('keydown')({
    key, target: { closest: () => list }, preventDefault() {},
  })
  try {
    press('A')
    press('r')
    assert.deepEqual(Array.from(remotePane().props.selectedNames), ['Archive'])
    assert.equal(scrolled.at(-1), 'Archive')
  } finally {
    cleanup()
  }
})

test('log context menu follows the application language and scopes copying to the log', async () => {
  const log = {}
  const selectedNode = {}
  log.contains = node => node === selectedNode
  let rangeTarget
  const range = { selectNodeContents: node => { rangeTarget = node } }
  const selection = {
    anchorNode: selectedNode, focusNode: selectedNode, toString: () => 'FTP log text',
    removeAllRanges() { this.range = null },
    addRange(value) { this.range = value },
  }
  context.document.getSelection = () => selection
  context.document.createRange = () => range
  let copied
  context.navigator = { clipboard: { writeText: async text => { copied = text } } }
  states[19] = [{ text: 'FTP log text', level: 'info' }]
  try {
    for (const [locale, labels] of [['zh-CN', ['复制', '全选', '清空日志']], ['en', ['Copy', 'Select All', 'Clear Log']]]) {
      i18n.setCurrentLocale(locale)
      const logPanel = all(render()).find(node => node.props?.className === 'fx-log fx-scroll')
      logPanel.props.onContextMenu({ currentTarget: log })
      assert.deepEqual(Array.from(openContextMenu.filter(item => !item.sep), item => item.label), labels)
      await openContextMenu[0].act()
      assert.equal(copied, 'FTP log text')
      openContextMenu[1].act()
      assert.equal(rangeTarget, log)
      assert.equal(selection.range, range)
    }
    selection.focusNode = {}
    const logPanel = all(render()).find(node => node.props?.className === 'fx-log fx-scroll')
    logPanel.props.onContextMenu({ currentTarget: log })
    assert.equal(openContextMenu[0].disabled, true)
    const clearLog = openContextMenu.find(item => item.label === i18n.t('clear_log'))
    assert.equal(clearLog.disabled, false)
    clearLog.act()
    assert.equal(states[19].length, 0)
  } finally {
    i18n.setCurrentLocale('zh-CN')
  }
})

test('editor upload events log start, success, and failure with the site and file path', async () => {
  states[19] = []
  states[0] = true
  states[7] = '/test/remote'
  effects.length = 0
  render()
  const cleanup = effects.find(effect => effect.fn.toString().includes('onFileEditorSave')).fn()
  try {
    const source = { remote: ['Test FTP', '/test/remote/edit.txt'], directory: '/test/remote' }
    await editorSave({ ...source, status: 'started' })
    await editorSave({ ...source, status: 'saved' })
    await editorSave({ ...source, status: 'failed', error: 'permission denied' })
    const log = all(render()).filter(node => node.props?.level)
    assert.deepEqual(log.slice(-3).map(node => node.props.level), ['command', 'success', 'error'])
    for (const row of log.slice(-3)) {
      assert.match(row.props.text, /Test FTP.*\/test\/remote\/edit\.txt/)
    }
    assert.match(log.at(-1).props.text, /permission denied/)
  } finally {
    cleanup()
  }
})

test('session menu, connect dropdown, and F8 open the same Quick Connect dialog', async () => {
  const dialog = tree => all(tree).find(node => node.props?.onRemoveHistory)
  const tree = render()
  const menu = all(tree).find(node => node.props?.menus).props.menus
  menu[0].items.find(item => item.key === 'F8').act()
  assert.ok(dialog(render()).props.initial)
  dialog(render()).props.onClose()

  const toolbar = all(render()).find(node => node.props?.title === i18n.t('connect_quick_connect_site'))
  await toolbar.props.onClick()
  const dropdown = all(render()).find(node => node.props?.className === 'fx-menu-popup fx-connect-menu')
  const siteRow = all(dropdown).find(node => node.type === 'button' &&
    all(node).some(label => label.props?.children === 'Saved Site'))
  assert.ok(siteRow)
  assert.equal(all(siteRow).some(label => label.props?.children === 'actual.test'), false)
  const quick = all(dropdown).find(node => node.type === 'button' &&
    all(node).some(label => label.props?.children === i18n.t('quick_connect')))
  quick.props.onClick()
  assert.ok(dialog(render()).props.initial)
  dialog(render()).props.onClose()

  const listeners = new Map()
  context.document.addEventListener = (type, listener) => listeners.set(type, listener)
  context.document.removeEventListener = type => listeners.delete(type)
  effects.length = 0
  render()
  const cleanup = effects.find(effect => effect.fn.toString().includes('addEventListener("keydown"')).fn()
  try {
    listeners.get('keydown')({ key: 'F8', target: { tagName: 'INPUT' }, preventDefault() {} })
    assert.ok(dialog(render()).props.initial)
    dialog(render()).props.onClose()
  } finally {
    cleanup()
  }
})
