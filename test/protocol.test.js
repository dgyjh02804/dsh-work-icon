import test from 'node:test'
import assert from 'node:assert/strict'

import {
  LineDecoder,
  MessageKind,
  PROTOCOL_VERSION,
  WorkState,
  createMessage,
  encodeMessage,
  isActivity,
  isWorkState,
  parseMessage,
  validateMessage,
} from '../src/protocol.js'

test('createMessage：打上 protocolVersion=2 与 timestamp，payload 展开在顶层', () => {
  const message = createMessage(MessageKind.STATE, { state: WorkState.WORKING, activity: 'editing' })
  assert.equal(message.protocolVersion, PROTOCOL_VERSION)
  assert.equal(PROTOCOL_VERSION, 2)
  assert.equal(message.kind, 'state')
  assert.equal(message.state, 'WORKING')
  assert.equal(message.activity, 'editing')
  assert.ok(Number.isFinite(message.timestamp) && message.timestamp > 0)
})

test('createMessage：未知 kind 直接抛 TypeError（编码期错误早炸）', () => {
  assert.throws(() => createMessage('bogus'), TypeError)
  assert.throws(() => createMessage(undefined), TypeError)
})

test('createMessage：payload 不能篡改 protocolVersion / kind', () => {
  const message = createMessage(MessageKind.STATE, { state: WorkState.IDLE, kind: 'shutdown', protocolVersion: 99 })
  assert.equal(message.kind, 'state')
  assert.equal(message.protocolVersion, PROTOCOL_VERSION)
})

test('encodeMessage：一行，以 \\n 结尾，且能被 parseMessage 还原', () => {
  const message = createMessage(MessageKind.PULSE, { state: WorkState.THINKING })
  const line = encodeMessage(message)
  assert.ok(line.endsWith('\n'))
  assert.equal(line.trimEnd().split('\n').length, 1)
  assert.deepEqual(parseMessage(line), message)
})

test('encodeMessage：校验不通过的消息拒绝上线（state 非法 / 版本不符）', () => {
  assert.throws(() => encodeMessage({ protocolVersion: 1, kind: 'state', state: 'BUSY' }), TypeError)
  // v2 是本版协议；v1 仍被接受（老窗口）；未来版本与未知值一律拒绝。
  assert.equal(encodeMessage({ protocolVersion: 2, kind: 'state', state: 'IDLE' }).endsWith('\n'), true)
  assert.equal(encodeMessage({ protocolVersion: 1, kind: 'state', state: 'IDLE' }).endsWith('\n'), true)
  assert.throws(() => encodeMessage({ protocolVersion: 3, kind: 'state', state: 'IDLE' }), TypeError)
  assert.throws(() => encodeMessage({ protocolVersion: 0, kind: 'state', state: 'IDLE' }), TypeError)
  assert.throws(() => encodeMessage({ protocolVersion: 1, kind: 'state' }), TypeError)
})

test('validateMessage：只读校验，合法/非法各走一边', () => {
  assert.equal(validateMessage(createMessage(MessageKind.READY, { pid: 123 })).ok, true)
  assert.equal(validateMessage({ protocolVersion: 1, kind: 'bogus' }).ok, false)
  assert.equal(validateMessage({ protocolVersion: 1, kind: 'setting', key: '' }).ok, false)
  assert.equal(validateMessage({ protocolVersion: 1, kind: 'state', state: 'IDLE', activity: 'thinking' }).ok, false)
  assert.equal(validateMessage(null).ok, false)
  assert.equal(validateMessage([]).ok, false)
  // 方向校验：宿主不该"收到"一条 state
  assert.equal(validateMessage({ protocolVersion: 1, kind: 'state', state: 'IDLE' }, { direction: 'window-to-host' }).ok, false)
})

test('parseMessage：脏输入一律返回 null，绝不抛异常', () => {
  const dirty = [
    'not json',
    '{"kind":"bogus"}',
    '{"protocolVersion":99,"kind":"state","state":"IDLE"}',
    '{"protocolVersion":1,"kind":"state"}',
    '{"protocolVersion":1,"kind":"state","state":"BUSY"}',
    '[]',
    'null',
    '42',
    '"a string"',
    '',
    '   ',
    '\r\n',
    '\uFEFF',
    '{"protocolVersion":1,"kind":"setting","key":null}',
  ]
  for (const line of dirty) {
    assert.equal(parseMessage(line), null, `应被忽略：${JSON.stringify(line)}`)
  }
  assert.equal(parseMessage(undefined), null)
  assert.equal(parseMessage(12345), null)
  // 后续正常行仍然能处理
  const good = parseMessage('\uFEFF{"protocolVersion":1,"kind":"ready","pid":7}\r\n')
  assert.equal(good.kind, 'ready')
  assert.equal(good.pid, 7)
})

test('parseMessage：空行不计数、非空脏行计数（LineDecoder 统计）', () => {
  const decoder = new LineDecoder()
  const messages = decoder.push('not json\n\n{"kind":"bogus"}\n   \n{"protocolVersion":1,"kind":"ready","pid":1}\n')
  assert.equal(messages.length, 1)
  assert.equal(messages[0].kind, 'ready')
  assert.equal(decoder.invalidLines, 2) // 'not json' 与 '{"kind":"bogus"}'
  assert.equal(decoder.receivedLines, 3) // 空行/纯空白行不算
})

test('LineDecoder：跨 chunk 的半行会被拼回去', () => {
  const decoder = new LineDecoder()
  assert.deepEqual(decoder.push('{"protocolVersion":1,"kind":"st'), [])
  assert.deepEqual(decoder.push('ate","state":"IDLE"}\n'), [
    { protocolVersion: 1, kind: 'state', state: 'IDLE' },
  ])
  // 一次 chunk 里多行
  const many = decoder.push('{"protocolVersion":1,"kind":"pulse","state":"IDLE"}\n{"protocolVersion":1,"kind":"closed","reason":"user"}\n')
  assert.equal(many.length, 2)
  assert.equal(many[1].reason, 'user')
})

test('LineDecoder：超长无换行的数据被丢弃并计数，不会 OOM', () => {
  const decoder = new LineDecoder({ maxLineLength: 32 })
  decoder.push('x'.repeat(100))
  assert.equal(decoder.droppedOversize, 1)
  assert.equal(decoder.buffer, '')
  // 丢弃之后仍然能正常解析后续行
  assert.equal(decoder.push('{"protocolVersion":1,"kind":"ready","pid":2}\n').length, 1)
})

test('枚举守卫：isWorkState / isActivity 只认 SPEC 第 5 节的取值', () => {
  for (const state of Object.values(WorkState)) assert.equal(isWorkState(state), true)
  assert.equal(isWorkState('THINK'), false) // 第 4 节的中文标签不是上线路的值
  for (const activity of ['searching', 'editing', 'testing', 'commanding']) assert.equal(isActivity(activity), true)
  assert.equal(isActivity('using-tool'), false)
})
