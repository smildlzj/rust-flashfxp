import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import * as highlights from '../src/highlights.js'
import * as i18n from '../src/i18n.js'
import { transformWithEsbuild } from 'vite'

const source = await readFile(new URL('../src/components/FilePane.jsx', import.meta.url), 'utf8')
const { code } = await transformWithEsbuild(source, 'FilePane.jsx', { loader: 'jsx', format: 'esm', jsx: 'transform' })
const context = vm.createContext({})
const module = new vm.SourceTextModule(code, { context })
await module.link(async name => {
  const exports = name === 'react'
    ? { default: React, useState: initial => [initial, () => {}] }
    : name.includes('highlights') ? highlights
    : name.includes('i18n') ? i18n
    : name.includes('winicons') ? { Ico: () => null }
    : { humanSize: String, fmtTime: String }
  return new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  }, { context })
})
await module.evaluate()
const FilePane = module.namespace.default

function findRow(node) {
  if (!node || typeof node !== 'object') return null
  if (node.type === 'tr' && React.Children.toArray(node.props.children).some(child => child?.props?.title === 'B.txt')) return node
  for (const child of React.Children.toArray(node.props?.children)) {
    const found = findRow(child)
    if (found) return found
  }
  return null
}

for (const pane of ['local', 'remote']) {
  for (const selected of [0, null]) {
    for (const action of ['delete', 'rename', 'transfer']) {
      test(`${pane}: ${action} targets right-clicked B when old selection is ${selected}`, () => {
        const entries = [{ name: 'A.txt', isDir: false }, { name: 'B.txt', isDir: false }]
        let menu
        let called
        const element = FilePane({
          pane, entries, selectedNames: new Set(selected == null ? [] : [entries[selected].name]), address: '/root', connected: true,
          onSelect: () => {}, // React selection has not rerendered the saved menu callback yet.
          onContextMenu: (_event, items) => { menu = items },
          onAction: (...args) => { called = args },
        })
        findRow(element).props.onContextMenu({})
        const item = menu.find(item => action === 'delete' ? item.label === '删除'
          : action === 'rename' ? item.label === '重命名…' : item.label?.startsWith('传输（'))
        item.act()
        assert.equal(called[0], action)
        assert.equal(called[1], entries[1])
      })
    }
  }
}

test('remote file row Refresh invokes the pane refresh handler', () => {
  let menu
  let refreshed = 0
  const element = FilePane({
    pane: 'remote', entries: [{ name: 'B.txt' }], selectedNames: new Set(),
    onSelect: () => {},
    onContextMenu: (_event, items) => { menu = items },
    onRefresh: () => { refreshed++ },
  })
  findRow(element).props.onContextMenu({})
  menu.find(item => item.key === 'F5').act()
  assert.equal(refreshed, 1)
})

test('remote file menu exposes View and Edit, with shortcuts', () => {
  let menu
  const element = FilePane({
    pane: 'remote', entries: [{ name: 'B.txt' }], selectedNames: new Set(),
    connected: true, onSelect: () => {},
    onContextMenu: (_event, items) => { menu = items },
  })
  findRow(element).props.onContextMenu({})
  assert.deepEqual(Array.from(menu.filter(item => ['Ctrl+V', 'Ctrl+E'].includes(item.key)), item => item.label),
    ['查看文件', '编辑文件'])
})
