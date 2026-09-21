import test from 'node:test'
import assert from 'node:assert/strict'

import {
  TEXT_CAPS,
  TextRing,
  activityLineFor,
  clip,
  normalizeTodoStatus,
  oneLine,
  textSignature,
  todosDigest,
  todosPayload,
} from '../src/text.js'

test('oneLine：折叠所有空白成单行并裁剪（换行会把窗口撑高）', () => {
  assert.equal(oneLine('npm test'), 'npm test')
  assert.equal(oneLine('  a\n\nb\t c  '), 'a b c')
  assert.equal(oneLine(undefined), '')
  assert.equal(oneLine(null), '')
  assert.equal(oneLine(42), '42')
  // 裁剪后总长不超过 max
  const long = 'x'.repeat(100)
  assert.equal(oneLine(long, 10).length, 10)
  assert.equal(oneLine(long, 10).endsWith('…'), true)
})

test('clip：不折叠空白，只裁剪', () => {
  assert.equal(clip('abc', 10), 'abc')
  assert.equal(clip('abcdef', 4), 'abc…')
  assert.equal(clip('abcdef', 0), '')
  assert.equal(clip(undefined, 5), '')
})

test('TextRing：定长、只留尾部、append 不重建整串', () => {
  const ring = new TextRing(16)
  ring.append('aaaa')
  ring.append('bbbb')
  assert.equal(ring.length, 8)
  assert.equal(ring.tail(16), 'aaaabbbb')
  // 尾部截断
  assert.equal(ring.tail(3), 'bbb')
  // 超容量：从头部丢弃
  ring.append('c'.repeat(20))
  assert.equal(ring.length, 16)
  assert.equal(ring.tail(16), 'c'.repeat(16))
  // set / reset
  ring.set('hello world')
  assert.equal(ring.tail(16), 'hello world')
  ring.reset()
  assert.equal(ring.length, 0)
  assert.equal(ring.tail(16), '')
  // 空追加是 no-op（实测增量里有 0 长度）
  ring.append('')
  assert.equal(ring.length, 0)
})

test('TextRing：容量边界（tail 超过容量时给全部）', () => {
  const ring = new TextRing(4)
  ring.append('abcdefgh')
  assert.equal(ring.length, 4)
  assert.equal(ring.tail(100), 'efgh')
})

test('activityLineFor：各工具取"最该显示的那一个参数"', () => {
  assert.equal(activityLineFor('pwsh', '{"command":"npm test"}'), '正在执行 pwsh: npm test')
  assert.equal(activityLineFor('Read', '{"file_path":"C:\\\\a\\\\b.js"}'), '正在执行 Read: C:\\a\\b.js')
  assert.equal(activityLineFor('grep', '{"pattern":"foo"}'), '正在执行 grep: foo')
  assert.equal(activityLineFor('task', '{"description":"调研花费链路"}'), '正在执行 task: 调研花费链路')
  assert.equal(activityLineFor('browser_open', '{"url":"https://example.com"}'), '正在执行 browser_open: https://example.com')
  // 已知字段顺序优先（read 优先 file_path 而不是 path）
  assert.equal(activityLineFor('read', '{"path":"p1","file_path":"p2"}'), '正在执行 read: p2')
})

test('activityLineFor：≤60 字符，超长截断', () => {
  const line = activityLineFor('pwsh', JSON.stringify({ command: 'x'.repeat(200) }))
  assert.ok(line.length <= TEXT_CAPS.activityChars, `实际 ${line.length} 字符`)
  assert.ok(line.endsWith('…'))
  assert.ok(line.startsWith('正在执行 pwsh: '))
})

test('activityLineFor：解析失败/空参数/怪类型都降级，绝不抛', () => {
  // 非法 JSON（流式截断）：当纯文本用
  assert.equal(activityLineFor('pwsh', '{"command":"npm te'), '正在执行 pwsh: {"command":"npm te')
  // 空参数
  assert.equal(activityLineFor('pwsh', ''), '正在执行 pwsh')
  assert.equal(activityLineFor('pwsh', undefined), '正在执行 pwsh')
  assert.equal(activityLineFor('pwsh', null), '正在执行 pwsh')
  // 非对象（数字/数组）
  assert.equal(activityLineFor('pwsh', '[]'), '正在执行 pwsh')
  assert.equal(activityLineFor('pwsh', '123'), '正在执行 pwsh')
  // 对象里没有可用字符串字段
  assert.equal(activityLineFor('pwsh', '{"timeout":1000}'), '正在执行 pwsh')
  // 已经是对象（未来适配器可能先解析好）
  assert.equal(activityLineFor('pwsh', { command: 'ls -la' }), '正在执行 pwsh: ls -la')
  // 多行命令只取第一行
  assert.equal(activityLineFor('pwsh', '{"command":"line1\\nline2"}'), '正在执行 pwsh: line1')
  // 数字字段也能用
  assert.equal(activityLineFor('read', '{"file_path":123}'), '正在执行 read: 123')
  // 工具名缺失
  assert.equal(activityLineFor(undefined, '{"command":"x"}'), '正在执行 tool: x')
})

test('normalizeTodoStatus：三种生命周期，别名与垃圾值都收敛', () => {
  assert.equal(normalizeTodoStatus('pending'), 'pending')
  assert.equal(normalizeTodoStatus('in_progress'), 'in_progress')
  assert.equal(normalizeTodoStatus('in-progress'), 'in_progress')
  assert.equal(normalizeTodoStatus('inProgress'), 'inprogress' === 'inprogress' ? 'in_progress' : 'pending')
  assert.equal(normalizeTodoStatus('completed'), 'completed')
  assert.equal(normalizeTodoStatus('done'), 'completed')
  assert.equal(normalizeTodoStatus(''), 'pending')
  assert.equal(normalizeTodoStatus(undefined), 'pending')
  assert.equal(normalizeTodoStatus('随便什么'), 'pending')
})

test('todosPayload：≤12 条、每条 ≤60 字符、超出附 more', () => {
  const todos = Array.from({ length: 20 }, (_, index) => ({
    content: `任务 ${index + 1} ${'x'.repeat(80)}`,
    status: index === 0 ? 'in_progress' : (index < 5 ? 'completed' : 'pending'),
  }))
  const payload = todosPayload(todos)
  assert.equal(payload.items.length, TEXT_CAPS.todoItems)
  assert.equal(payload.more, 20 - TEXT_CAPS.todoItems)
  for (const item of payload.items) {
    assert.ok(item.content.length <= TEXT_CAPS.todoContentChars)
    assert.ok(['pending', 'in_progress', 'completed'].includes(item.status))
  }
  // 顺序保持原样（有语义，不按状态重排）
  assert.ok(payload.items[0].content.startsWith('任务 1'))
  assert.equal(payload.items[0].status, 'in_progress')
  assert.equal(payload.items[1].status, 'completed')
})

test('todosPayload：空/非数组/缺 content 都安全', () => {
  assert.deepEqual(todosPayload(undefined), { items: [], more: 0 })
  assert.deepEqual(todosPayload([]), { items: [], more: 0 })
  assert.deepEqual(todosPayload('x'), { items: [], more: 0 })
  assert.deepEqual(todosPayload([null, { status: 'pending' }]), { items: [], more: 0 })
  // more 只统计"被截掉的数量"，被跳过的空条目不算
  assert.deepEqual(todosPayload([{ content: 'a', status: 'done' }]), { items: [{ content: 'a', status: 'completed' }], more: 0 })
})

test('todosDigest / textSignature：指纹只反映可见内容', () => {
  assert.equal(todosDigest(undefined), '')
  assert.equal(todosDigest({ items: [] }), '')
  const a = todosPayload([{ content: '甲', status: 'pending' }])
  const b = todosPayload([{ content: '乙', status: 'pending' }])
  assert.notEqual(todosDigest(a), todosDigest(b))
  assert.equal(todosDigest(a), todosDigest(todosPayload([{ content: '甲', status: 'pending' }])))

  assert.equal(textSignature(undefined), '')
  assert.notEqual(
    textSignature({ activityText: 'a', thoughtTail: '', bodyTail: '' }),
    textSignature({ activityText: 'b', thoughtTail: '', bodyTail: '' }),
  )
  assert.notEqual(
    textSignature({ activityText: 'a', thoughtTail: 'x', bodyTail: '' }),
    textSignature({ activityText: 'a', thoughtTail: 'y', bodyTail: '' }),
  )
})
