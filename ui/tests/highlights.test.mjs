import test from 'node:test'
import assert from 'node:assert/strict'
import { matchesHighlightMask as match, validateHighlightMask as validate, highlightColor } from '../src/highlights.js'

test('FlashFXP documented examples and whole-name case insensitive matching', () => {
  for (const [mask, name, expected] of [['[a-z0-9_]bc?*c','abcabc',true],['hello*','hello world',true],['*world','world hello',false],['?ello world','jhello world',false],['*.TXT','文档.txt',true],['?','😀',true],['a.b','axb',false],['(a|b)+','(a|b)+',true]]) assert.equal(match(name,mask),expected,`${mask}: ${name}`)
})
test('sets, excluded sets and escaped special characters', () => {
  assert.equal(match('B7.txt','[a-c][^a-z].txt'),true)
  assert.equal(match('ba.txt','[a-c][^a-z].txt'),false)
  for (const character of ['\\','-','[',']','?','*']) assert.equal(match(character,`\\${character}`),true)
  assert.equal(match('-', '[a\\-z]'),true)
  assert.equal(match('b', '[a\\-z]'),false)
})
test('invalid masks are rejected safely and adversarial stars do not backtrack', () => {
  for (const mask of ['', '[', '[]','[^]','[z-a]','abc\\']) { assert.ok(validate(mask)); assert.equal(match('abc',mask),false) }
  assert.equal(validate('*.txt'),null)
  assert.equal(match('a'.repeat(1000), '*a'.repeat(100)+'b'),false)
})
test('ordered first matching rule wins, invalid masks and colors ignored', () => {
  const rules = [{mask:'[',color:'#000000'}, {mask:'*',color:'red'}, {mask:'*.txt',color:'#123456'}, {mask:'*',color:'#abcdef'}]
  assert.equal(highlightColor('A.TXT',rules),'#123456')
  assert.equal(highlightColor('a.bin',rules),'#abcdef')
  assert.equal(highlightColor('a',[]),undefined)
})
