import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { transformWithEsbuild } from 'vite'
import * as highlights from '../src/highlights.js'

async function harness(file, api = {}) {
  let states = [], cursor = 0, effects = [], dependencies = [], cleanups = [], tree
  const context = vm.createContext({})
  const source = await readFile(new URL(`../src/components/${file}.jsx`, import.meta.url), 'utf8')
  const {code} = await transformWithEsbuild(source,file+'.jsx',{loader:'jsx',format:'esm',jsx:'transform'})
  const module = new vm.SourceTextModule(code,{context})
  const hooks = {default:React,useRef(initial) { const i=cursor++; if (!(i in states)) states[i]={current:initial}; return states[i] },useState(initial) { const i=cursor++; if (!(i in states)) states[i]=initial; return [states[i],v=>{states[i]=typeof v==='function'?v(states[i]):v}] },useEffect(fn,deps) { const i=cursor++; if (!dependencies[i] || deps.some((v,n)=>v!==dependencies[i][n])) { dependencies[i]=deps; effects.push(()=>{cleanups[i]?.();cleanups[i]=fn()}) } }}
  await module.link(async name=>{
    const values = name==='react'?hooks:name.includes('highlights')?highlights:name.includes('i18n')?{t:id=>id,errorMessage:String,getLocale:()=> 'en',formatNumber:String}:name.includes('api')?{api:{onBrowsingChanged:async()=>()=>{},...api},humanSize:String,fmtTime:String}:name.includes('win32')?Object.fromEntries(['WinDialog','WinTabs','WinButton','WinInput'].map(k=>[k,k])):{Ico:()=>null}
    return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values)) this.setExport(k,v)},{context})
  })
  await module.evaluate()
  const render = async props=>{ cursor=0;tree=module.namespace.default(props); const pending=effects;effects=[];pending.forEach(fn=>fn());await new Promise(resolve=>setImmediate(resolve));cursor=0;tree=module.namespace.default(props);return tree }
  return {render}
}
function nodes(node) { if(!node || typeof node!=='object') return [];return [node,...React.Children.toArray(node.props?.children).flatMap(nodes),...React.Children.toArray(node.props?.footer).flatMap(nodes)] }
const find=(tree,label)=>nodes(tree).find(n=>n.props?.['aria-label']===label || n.props?.children===label)

test('filename colors include directories while selection and comparison stay intact',async()=>{
  const {render}=await harness('FilePane')
  for(const pane of ['local','remote']) {
    const tree=await render({pane,entries:[{name:'docs.txt',isDir:true},{name:'a.txt'}],selectedNames:new Set(['a.txt']),marks:{'docs.txt':'diff'},highlightRules:[{mask:'*.txt',color:'#123456'}]})
    const names=nodes(tree).filter(n=>n.props?.className==='fx-cell-name')
    assert.equal(names.find(n=>n.props.children==='docs.txt').props.style.color,'#123456')
    assert.equal(names.find(n=>n.props.children==='a.txt').props.style.color,undefined)
    assert.ok(nodes(tree).some(n=>n.props?.className?.includes('fx-mark-diff')))
    assert.ok(nodes(tree).some(n=>n.props?.className?.includes('fx-selected')))
  }
})
test('highlight edits and reordering stay draft until Apply; Cancel discards later edits',async()=>{
  const saves=[],closed=[];let changed=0
  let stored=[{id:1,mask:'*.txt',color:'#123456',position:0},{id:2,mask:'*',color:'#654321',position:1}]
  const {render}=await harness('FiltersDialog',{highlights:async()=>stored,saveHighlights:async rules=>{saves.push(JSON.parse(JSON.stringify(rules)));stored=rules.map((r,i)=>({...r,id:r.id||i+1}));return stored}})
  let props={open:true,onOpenChange:v=>closed.push(v),onChanged:()=>changed++}
  let tree=await render(props)
  find(tree,'highlight_mask 1').props.onChange({target:{value:'*.md'}})
  tree=await render(props)
  find(tree,'highlight_move_down 1').props.onClick()
  tree=await render(props)
  assert.equal(saves.length,0)
  await find(tree,'apply').props.onClick()
  tree=await render(props)
  assert.equal(saves[0][1].mask,'*.md');assert.equal(saves[0][1].position,1);assert.equal(changed,1);assert.equal(closed.length,0)
  find(tree,'highlight_mask 1').props.onChange({target:{value:'*.bin'}})
  tree=await render(props);find(tree,'cancel').props.onClick()
  assert.equal(saves.length,1);assert.deepEqual(closed,[false])
})
test('invalid mask blocks saving; delete and add are draft changes',async()=>{
  let saves=0;const {render}=await harness('FiltersDialog',{highlights:async()=>[{id:1,mask:'*',color:'#123456',position:0}],saveHighlights:async()=>{saves++}})
  const props={open:true,onOpenChange:()=>{},onChanged:()=>{}}
  let tree=await render(props)
  find(tree,'highlight_mask 1').props.onChange({target:{value:'['}})
  tree=await render(props)
  assert.equal(find(tree,'apply').props.disabled,true)
  assert.ok(find(tree,'highlight_mask_invalid'))
  find(tree,'highlight_delete 1').props.onClick();tree=await render(props)
  find(tree,'highlight_add').props.onClick();tree=await render(props)
  assert.equal(nodes(tree).filter(n=>n.props?.['aria-label']==='highlight_mask 1').length,1)
  assert.equal(saves,0)
})

test('clean highlight dialog reloads other-window changes and saves the refreshed baseline',async()=>{
  let notify, disposed=0, stored=[{id:1,mask:'*.txt',color:'#123456',position:0}], expected
  const {render}=await harness('FiltersDialog',{highlights:async()=>stored,onBrowsingChanged:async cb=>{notify=cb;return()=>disposed++},saveHighlights:async(rules,baseline)=>{expected=baseline;return rules}})
  const props={open:true,onOpenChange:()=>{}}
  let tree=await render(props)
  stored=[{id:1,mask:'*.md',color:'#123456',position:0}]
  await notify('highlights');tree=await render(props)
  assert.equal(find(tree,'highlight_mask 1').props.value,'*.md')
  await find(tree,'ok_o').props.onClick()
  assert.equal(expected[0].mask,'*.md')
  await render({...props,open:false});assert.equal(disposed,1)
})
test('dirty highlight draft survives external changes and blocks a stale save with a conflict message',async()=>{
  let notify,saves=0,stored=[{id:1,mask:'*.txt',color:'#123456',position:0}]
  const {render}=await harness('FiltersDialog',{highlights:async()=>stored,onBrowsingChanged:async cb=>{notify=cb;return()=>{}},saveHighlights:async()=>{saves++}})
  const props={open:true,onOpenChange:()=>{}}
  let tree=await render(props)
  find(tree,'highlight_mask 1').props.onChange({target:{value:'*.mine'}})
  tree=await render(props);stored=[{id:1,mask:'*.other',color:'#123456',position:0}]
  await notify('highlights');tree=await render(props)
  assert.equal(find(tree,'highlight_mask 1').props.value,'*.mine')
  assert.ok(find(tree,'highlight_external_conflict'))
  assert.equal(find(tree,'apply').props.disabled,true)
  await find(tree,'apply').props.onClick();assert.equal(saves,0)
})

test('own save broadcasts preserve drafts during Apply and the next Apply uses assigned IDs',async()=>{
  let notify, baseline, stored=[{id:1,mask:'*',color:'#123456',position:0}]
  const {render}=await harness('FiltersDialog',{highlights:async()=>stored,onBrowsingChanged:async cb=>{notify=cb;return()=>{}},saveHighlights:async(rules,expected)=>{
    baseline=expected;await notify('highlights');stored=rules.map((rule,i)=>({...rule,id:rule.id||i+1}));return stored
  }})
  const props={open:true,onOpenChange:()=>{}}
  let tree=await render(props);find(tree,'highlight_add').props.onClick();tree=await render(props)
  await find(tree,'apply').props.onClick();tree=await render(props)
  assert.equal(find(tree,'highlight_external_conflict'),undefined)
  assert.equal(baseline.length,1)
  find(tree,'highlight_mask 2').props.onChange({target:{value:'*.txt'}});tree=await render(props)
  await find(tree,'apply').props.onClick()
  assert.equal(baseline[1].id,2)
})
