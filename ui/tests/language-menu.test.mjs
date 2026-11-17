import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
const source = await readFile(new URL('../src/win32.jsx', import.meta.url), 'utf8')
const { code } = await transformWithEsbuild(source, 'win32.jsx', { loader: 'jsx', format: 'esm', jsx: 'transform' })
const state = []; let cursor = 0
const react = { ...React, useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = value }] }, useRef: () => ({ current: null }), useEffect: () => {} }
const context = vm.createContext({})
const module = new vm.SourceTextModule(code, { context })
await module.link(async name => {
  const exports = name === 'react' ? { ...react, default: react } : name === 'react-dom' ? { createPortal: () => {} }
    : name === 'cn' ? { cn: () => '' } : Object.fromEntries(['ChevronDown','Button','Input','Checkbox','Dialog','DialogContent','DialogHeader','DialogTitle','DialogFooter','Ico'].map(key => [key, () => null]))
  return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key,value] of Object.entries(exports)) this.setExport(key,value) }, { context })
})
await module.evaluate()
function all(node) { return !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(all)] }
function text(node) { return typeof node === 'string' ? node : React.Children.toArray(node?.props?.children).map(text).join('') }
test('Options Language submenu opens by click and keyboard and selects checked language', () => {
  let language = 'zh-CN'
  const render = () => {
    cursor = 0
    return module.namespace.WinMenuBar({ menus: [{ name: 'Options', items: [{ label: 'Language', items: ['简体中文', 'English'].map((label,i) => ({ label, checked: language === (i ? 'en' : 'zh-CN'), act: () => { language = i ? 'en' : 'zh-CN' } })) }] }] })
  }
  all(render()).find(n => n.type === 'button').props.onClick()
  let parent = all(render()).find(n => n.type === 'button' && text(n).includes('Language'))
  assert.equal(parent.props['aria-haspopup'], 'menu')
  parent.props.onClick()
  let tree = render()
  let english = all(tree).find(n => n.type === 'button' && text(n).includes('English'))
  assert.ok(english)
  assert.equal(english.props.role, 'menuitemradio')
  assert.equal(english.props['aria-checked'], false)
  english.props.onClick()
  assert.equal(language, 'en')
  all(render()).find(n => n.type === 'button').props.onClick()
  parent = all(render()).find(n => n.type === 'button' && text(n).includes('Language'))
  parent.props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, stopPropagation() {} })
  tree = render()
  english = all(tree).find(n => n.type === 'button' && text(n).includes('English'))
  assert.equal(english.props['aria-checked'], true)
})
