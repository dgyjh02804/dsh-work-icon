#!/usr/bin/env node
/**
 * 第二个假 helper：同样冒充窗口进程，但把"收到了什么"写进 DSH_WORK_ICON_FAKE_LOG，
 * 让插件级集成测试可以直接观察宿主到底往窗口发了什么（不需要真的窗口）。
 *
 * 启动后：写日志 → 发 ready → 立刻回传一条 setting（模拟用户在右键菜单里改尺寸）。
 * 自保护：没有 DSH_WORK_ICON_FAKE_HELPER=1 就立刻退出（测试运行器会把它当测试文件跑）。
 */
import { appendFileSync } from 'node:fs'

const logFile = process.env.DSH_WORK_ICON_FAKE_LOG

if (process.env.DSH_WORK_ICON_FAKE_HELPER !== '1' || !logFile) {
  process.stdout.write('dsh-work-icon fake helper (log): 未启用\n')
  process.exit(0)
}

function write(entry) {
  try {
    appendFileSync(logFile, `${JSON.stringify({ ...entry, at: Date.now() })}\n`, 'utf8')
  } catch {
    // 日志写不进去也不能让假 helper 崩掉
  }
}

write({ event: 'started', pid: process.pid })
/**
 * 协议 v2：窗口用 `ready.capabilities` 声明自己认识哪些扩展。
 * 默认**不发**（= 老窗口 v1 行为，用于兼容性测试）；设 DSH_WORK_ICON_FAKE_CAPABILITIES=todos,cost,text 才发。
 */
const protocolVersion = Number(process.env.DSH_WORK_ICON_FAKE_PROTOCOL_VERSION ?? (process.env.DSH_WORK_ICON_FAKE_CAPABILITIES ? 2 : 1))
const capabilities = process.env.DSH_WORK_ICON_FAKE_CAPABILITIES
  ? process.env.DSH_WORK_ICON_FAKE_CAPABILITIES.split(',').map((item) => item.trim()).filter(Boolean)
  : undefined
process.stdout.write(`${JSON.stringify({
  protocolVersion,
  kind: 'ready',
  timestamp: Date.now(),
  pid: process.pid,
  ...(capabilities ? { capabilities } : {}),
})}\n`)
// 模拟用户在窗口右键菜单里改设置（默认改直径，可用环境变量换成别的键，便于测 includeSubagents）
const settingKey = process.env.DSH_WORK_ICON_FAKE_SETTING_KEY || 'scale'
const rawValue = process.env.DSH_WORK_ICON_FAKE_SETTING_VALUE
let settingValue = 200
if (rawValue !== undefined) {
  try {
    settingValue = JSON.parse(rawValue)
  } catch {
    settingValue = rawValue
  }
}
const sendSetting = () => {
  process.stdout.write(`${JSON.stringify({
    protocolVersion: 1,
    kind: 'setting',
    timestamp: Date.now(),
    key: settingKey,
    value: settingValue,
  })}\n`)
}
// 默认立刻发（老行为）；设了延迟就先等着，方便测"错误先发生、确认后到达"。
const settingDelay = Number(process.env.DSH_WORK_ICON_FAKE_SETTING_DELAY_MS ?? 0)
if (Number.isFinite(settingDelay) && settingDelay > 0) setTimeout(sendSetting, settingDelay).unref?.()
else sendSetting()

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (line.trim()) {
      try {
        write({ event: 'received', message: JSON.parse(line) })
      } catch {
        write({ event: 'garbage', line })
      }
    }
    index = buffer.indexOf('\n')
  }
})

process.stdin.on('end', () => process.exit(0))
process.on('SIGTERM', () => process.exit(0))
process.on('SIGINT', () => process.exit(0))
setTimeout(() => process.exit(0), 60000).unref?.()
