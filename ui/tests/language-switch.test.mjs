import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
import * as i18n from '../src/i18n.js'

const source = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
const { code } = await transformWithEsbuild(source, 'App.jsx', { loader: 'jsx', format: 'esm', jsx: 'transform' })
const states = []
let cursor = 0
let newSessions = 0
const deleted = []
const effects = []
const windowTitles = []
const context = vm.createContext({ localStorage: { getItem: () => null }, window: { confirm: () => true }, document: {}, setTimeout, clearTimeout })
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
    : name.includes('LanguageContext') ? { useLanguage: () => ({ language: i18n.getLocale(), setLanguage: i18n.setCurrentLocale }) }
    : name.endsWith('/api.js') ? { api: { setWindowTitle: async title => { windowTitles.push(title) }, newSession: async () => { newSessions++ }, deleteLocal: async paths => deleted.push(...paths), deleteRemote: async paths => deleted.push(...paths), localList: stub, remoteList: stub }, init: stub, onEvent: stub, remoteJoin: (base, name) => `${base}/${name}`, remoteParent: stub, humanSize: String }
    : name.includes('winicons') ? { Ico: stub, FxIconDefs: stub, AppLogo: stub }
    : name.includes('win32') ? Object.fromEntries(['WinMenuBar','WinButton','WinInput','WinCheck','WinDialog','WinFieldset','WinToolButton','WinContextMenu','IconTip'].map(k => [k,stub]).concat([['useWinContextMenu', () => ({})]]))
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
    assert.equal(filePane.props.entries[filePane.props.selected]?.name, '阿.txt')
    const count = deleted.length
    filePane.props.onAction('delete')
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(deleted.slice(count), ['/test/阿.txt'])
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
