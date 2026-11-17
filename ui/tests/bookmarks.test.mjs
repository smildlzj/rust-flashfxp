import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'

async function setup(props = {}) {
  const calls = [], states = [], effects = []; let cursor = 0, notify
  const react = { ...React, useState(initial) { const i = cursor++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value }] }, useEffect(fn) { const i = cursor++; if (!(i in states)) { states[i] = true; effects.push(fn) } } }
  const api = { onBrowsingChanged: async handler => { notify = handler; return () => {} }, bookmarks: async id => { calls.push(['list', id]); return [{ id: 3, caption: 'Logs', remotePath: '/logs', localPath: '', syncBrowsing: 'default' }] }, saveBookmark: async (...args) => calls.push(['save', ...args]), deleteBookmark: async (...args) => calls.push(['delete', ...args]), pickFolder: async () => '/picked' }
  const source = await readFile(new URL('../src/components/BookmarkManager.jsx', import.meta.url), 'utf8')
  const { code } = await transformWithEsbuild(source, 'BookmarkManager.jsx', { loader: 'jsx', format: 'esm', jsx: 'transform' })
  const context = vm.createContext({}), mod = new vm.SourceTextModule(code, { context })
  await mod.link(async name => {
    const exports = name === 'react' ? { ...react, default: react } : name.includes('api') ? { api } : name.includes('i18n') ? { t: k => k } : Object.fromEntries(['WinButton','WinInput','WinCombo','WinDialog'].map(k => [k, k]))
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [k,v] of Object.entries(exports)) this.setExport(k,v) }, { context })
  })
  await mod.evaluate()
  const render = () => { cursor = 0; return mod.namespace.BookmarkPanel({ siteId: 42, ...props }) }
  render(); for (const effect of effects.splice(0)) await effect(); await new Promise(resolve => setImmediate(resolve))
  return { calls, render, notify: async kind => { notify(kind); await new Promise(resolve => setImmediate(resolve)) } }
}
const all = n => !n || typeof n !== 'object' ? [] : [n, ...React.Children.toArray(n.props?.children).flatMap(all)]
const content = n => typeof n === 'string' ? n : React.Children.toArray(n?.props?.children).map(content).join('')
const button = (tree, text) => all(tree).find(n => n.type === 'WinButton' && content(n) === text)
const field = (tree, id) => all(tree).find(n => n.props?.id === id)

test('opening and canceling edits never writes bookmarks; list is scoped to selected saved site', async () => {
  const { calls, render } = await setup()
  assert.deepEqual(calls, [['list',42]])
  button(render(), 'bookmark_new').props.onClick()
  field(render(), 'bookmark-caption').props.onChange({ target: { value: 'Canceled' } })
  button(render(), 'cancel').props.onClick()
  assert.equal(calls.length, 1)
})

test('new bookmark saves caption, paths, synchronization mode and selected site', async () => {
  const { calls, render } = await setup({ localPath: '/local', remotePath: '/remote' })
  button(render(), 'bookmark_new').props.onClick()
  field(render(), 'bookmark-caption').props.onChange({ target: { value: '  Work  ' } })
  field(render(), 'bookmark-sync').props.onChange('enabled')
  await button(render(), 'save').props.onClick()
  const save = calls.find(c => c[0] === 'save')
  assert.deepEqual(JSON.parse(JSON.stringify(save)), ['save', { id: 0, caption: 'Work', localPath: '/local', remotePath: '/remote', syncBrowsing: 'enabled' },42])
})

test('invalid empty paths do not write, edit preserves id, delete requires confirmation', async () => {
  const { calls, render } = await setup()
  button(render(), 'bookmark_new').props.onClick()
  field(render(), 'bookmark-caption').props.onChange({ target: { value: 'Empty' } })
  await button(render(), 'save').props.onClick()
  assert.equal(calls.some(c => c[0] === 'save'), false)
  button(render(), 'cancel').props.onClick()
  all(render()).find(n => n.type === 'button' && content(n).includes('Logs')).props.onClick()
  button(render(), 'bookmark_edit').props.onClick()
  await button(render(), 'save').props.onClick()
  assert.equal(calls.find(c => c[0] === 'save')[1].id,3)
  button(render(), 'bookmark_delete').props.onClick()
  assert.equal(calls.some(c => c[0] === 'delete'), false)
  await button(render(), 'bookmark_confirm_delete').props.onClick()
  assert.deepEqual(calls.find(c => c[0] === 'delete'), ['delete',3,42])
})

test('local browse fills the draft and caption validation keeps editor open', async () => {
  const { calls, render } = await setup()
  button(render(), 'bookmark_new').props.onClick()
  await button(render(), 'browse').props.onClick()
  assert.equal(field(render(), 'bookmark-local').props.value, '/picked')
  await button(render(), 'save').props.onClick()
  assert.equal(calls.some(c => c[0] === 'save'), false)
  assert.ok(all(render()).find(n => n.props?.role === 'alert' && content(n) === 'Error: bookmark_caption_required'))
  assert.ok(field(render(), 'bookmark-caption'))
})


test('bookmark broadcasts refresh list without discarding an unsaved draft', async () => {
  const { calls, render, notify } = await setup()
  button(render(), 'bookmark_new').props.onClick()
  field(render(), 'bookmark-caption').props.onChange({ target: { value: 'Unsaved' } })
  await notify('highlights')
  assert.equal(calls.length, 1)
  await notify('bookmarks')
  assert.equal(calls.length, 2)
  assert.equal(field(render(), 'bookmark-caption').props.value, 'Unsaved')
})
