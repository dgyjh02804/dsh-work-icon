/**
 * 取证 3：同一 (turn, step) 上，chunk 样本与 assistant/message 终值**是否相同**？
 * 这决定"替换 vs 相加"在数值上到底差多少。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'

function decodeAll(buffer) {
  const offsets = []
  for (let i = 0; i + 4 <= buffer.length; i++) {
    if (buffer[i] === 0x28 && buffer[i + 1] === 0xb5 && buffer[i + 2] === 0x2f && buffer[i + 3] === 0xfd) offsets.push(i)
  }
  const parts = []
  for (let i = 0; i < offsets.length; i++) {
    const end = i + 1 < offsets.length ? offsets[i + 1] : buffer.length
    try {
      parts.push(zstdDecompressSync(buffer.subarray(offsets[i], end)))
    } catch { /* 跳过 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

const home = process.env.DSH_HOME || join(process.env.USERPROFILE ?? '', '.dsh')
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name === 'session.jsonl.zstd') files.push({ path, size: statSync(path).size })
  }
}
walk(join(home, 'sessions'))
files.sort((a, b) => b.size - a.size)

const key = (usage) => [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens ?? 0, usage.cacheWriteTokens ?? 0].join('/')
let same = 0
let different = 0
let messageBigger = 0
let chunkBigger = 0
const examples = []
let stepsTotal = 0

for (const file of files.slice(0, 4)) {
  const text = decodeAll(readFileSync(file.path))
  const chunks = new Map()
  const messages = []
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"') || line.length > 20000) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const data = event?.data ?? {}
    if (event.type === 'assistant/chunk' && data?.chunk?.type === 'usage' && data.chunk.usage) {
      chunks.set(`${data.turn}:${data.step}`, data.chunk.usage)
    } else if (event.type === 'assistant/message' && data?.usage) {
      messages.push({ step: `${data.turn}:${data.step}`, usage: data.usage })
    }
  }
  for (const item of messages) {
    const chunk = chunks.get(item.step)
    if (!chunk) continue
    stepsTotal++
    if (key(chunk) === key(item.usage)) same++
    else {
      different++
      const sum = (usage) => Number(usage.inputTokens ?? 0) + Number(usage.outputTokens ?? 0)
      if (sum(item.usage) > sum(chunk)) messageBigger++
      else chunkBigger++
      if (examples.length < 6) {
        examples.push(`  step ${item.step}: chunk=${key(chunk)}  终值=${key(item.usage)}`)
      }
    }
  }
}

console.log(`比较了 ${stepsTotal} 个"chunk 与终值都有"的 (turn,step)（前 4 大会话）`)
console.log(`  两侧数字完全相同: ${same}`)
console.log(`  两侧数字不同: ${different}  （其中终值更大 ${messageBigger}，chunk 更大 ${chunkBigger}）`)
if (examples.length > 0) {
  console.log('  不同的例子（input/output/cacheRead/cacheWrite）：')
  for (const line of examples) console.log(line)
}
