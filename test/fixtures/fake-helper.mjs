#!/usr/bin/env node
/**
 * 假的 "Python helper"：冒充窗口进程，只实现协议最小面。
 *  1) 先吐一串脏数据（非 JSON / 非法 kind / 版本不符 / 空行）—— 宿主必须全部忽略且不崩；
 *  2) 再发 ready；
 *  3) 之后把收到的每一行原样回显成一条 setting 消息，供测试断言双向通路。
 *
 * 自保护：Node 的测试运行器会把 test/ 目录下的所有 .js/.mjs 当测试文件跑一遍，
 * 所以没有 DSH_WORK_ICON_FAKE_HELPER=1 时立刻退出，绝不挂在 stdin 上。
 */
if (process.env.DSH_WORK_ICON_FAKE_HELPER !== '1') {
  process.stdout.write('dsh-work-icon fake helper: 未启用（需要 DSH_WORK_ICON_FAKE_HELPER=1）\n')
  process.exit(0)
}

process.stdin.setEncoding('utf8')

function send(object) {
  process.stdout.write(`${JSON.stringify(object)}\n`)
}

// 1) 脏数据
process.stdout.write('not json\n')
process.stdout.write('{"kind":"bogus"}\n')
process.stdout.write('{"protocolVersion":99,"kind":"state","state":"IDLE"}\n')
process.stdout.write('\n')
process.stdout.write('   \n')

// 2) 就绪
send({ protocolVersion: 1, kind: 'ready', timestamp: Date.now(), pid: process.pid })

// 3) 回显
let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim()) {
      let value
      try {
        value = JSON.parse(line)
      } catch {
        value = null
      }
      if (value !== null) send({ protocolVersion: 1, kind: 'setting', timestamp: Date.now(), key: 'echo', value })
    }
    index = buffer.indexOf('\n')
  }
})

process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
setTimeout(() => process.exit(0), 60000).unref?.()
