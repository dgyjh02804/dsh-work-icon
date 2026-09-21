/**
 * 取证 2：真实会话日志里 usage 从哪条路径来？（多帧 zstd：DSH 日志是分帧追加的）
 *   - `assistant/chunk` + chunk.type==='usage' 有多少条？
 *   - 其中多少 (turn, step) **之后**还有 assistant/message 的 usage（→ 重复计数风险）？
 *   - 多少 (turn, step) 只有 chunk（→ 当前实现整条丢失）？丢了多少 token？
 * 只读，不改任何东西。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { join } from 'node:path'

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** 多帧解码：按 zstd magic 切帧逐帧解。 */
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
    } catch { /* 边界猜错就跳过 */ }
  }
  return Buffer.concat(parts).toString('utf8')
}

const home = process.env.DSH_HOME || join(process.env.USERPROFILE ?? '', '.dsh')
const root = join(home, 'sessions')
const files = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (entry.name === 'session.jsonl.zstd') files.push({ path, size: statSync(path).size })
  }
}
walk(root)
files.sort((a, b) => b.size - a.size)
console.log(`共 ${files.length} 个会话日志；取最大的 6 个分析。\n`)

for (const file of files.slice(0, 6)) {
  let text
  try {
    text = decodeAll(readFileSync(file.path))
  } catch (error) {
    console.log(`${file.path}：解码失败 ${error.message}`)
    continue
  }
  const chunkByStep = new Map()
  const messageSteps = new Set()
  let chunkCount = 0
  let messageUsageCount = 0
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"') || line.length > 20000) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    const data = event?.data ?? {}
    const key = `${data.turn}:${data.step}`
    if (event.type === 'assistant/chunk' && data?.chunk?.type === 'usage' && data.chunk.usage) {
      chunkCount++
      chunkByStep.set(key, data.chunk.usage)
    } else if (event.type === 'assistant/message' && data?.usage) {
      messageUsageCount++
      messageSteps.add(key)
    }
  }
  const onlyChunk = [...chunkByStep.keys()].filter((key) => !messageSteps.has(key))
  const sum = (keys, field) => keys.reduce((total, key) => total + Number(chunkByStep.get(key)?.[field] ?? 0), 0)
  const name = file.path.split(/[\\/]/u).slice(-3, -1).join('/')
  console.log(`${name}   (压缩 ${(file.size / 1e6).toFixed(1)} MB → 文本 ${(text.length / 1e6).toFixed(1)} MB)`)
  console.log(`  usage chunk: ${chunkCount} 条 | assistant/message 带 usage: ${messageUsageCount} 条`)
  console.log(`  两者都有同一 (turn,step)（重复计数风险）: ${[...chunkByStep.keys()].filter((k) => messageSteps.has(k)).length} 个`)
  console.log(`  只有 chunk、没有终值（当前实现整条丢失）: ${onlyChunk.length} 个`)
  console.log(`  → 当前少算：prompt 侧 ${sum(onlyChunk, 'inputTokens')} + cacheRead ${sum(onlyChunk, 'cacheReadTokens')}，output ${sum(onlyChunk, 'outputTokens')}`)
  console.log(`  （全部 chunk 的 prompt 侧合计 ${sum([...chunkByStep.keys()], 'inputTokens')}，output 合计 ${sum([...chunkByStep.keys()], 'outputTokens')}）\n`)
}
void MAGIC
