/**
 * 宿主侧敏感性复核（临时副本里做，**绝不碰共享的 src/**）。
 *
 * 上一轮我直接在 src/protocol.js 上改+还原，撞上了另一个 agent 的并发写入，
 * 把文件写坏了（已修复）。这里改成：把 src/ 与测试复制到临时目录，
 * 在副本上改名，跑副本的测试，验证"改个名字必须变红"。
 *
 * 两个宿主侧用例：
 *   (e) 能力名改了（Capability.PROGRESS 的值 'progress' → 'plan'）→ 字段/能力 1:1 断言必须红
 *   (f) 字段名改了（reducer 里 message.progress → message.plan）→ 同上必须红
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const tmp = join(process.env.TEMP ?? '/tmp', 'dsh-work-icon-ps-sens')
const env = {
  ...process.env,
  DSH_WORK_ICON_WINDOW_MAIN: join(root, 'runtime', 'electron', 'main.js'),
  DSH_WORK_ICON_WINDOW_HTML: join(root, 'runtime', 'electron', 'index.html'),
}

function prepare() {
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(join(tmp, 'test'), { recursive: true })
  cpSync(join(root, 'src'), join(tmp, 'src'), { recursive: true })
  cpSync(join(root, 'test', 'protocol-shape.test.js'), join(tmp, 'test', 'protocol-shape.test.js'))
}

function runCopy() {
  try {
    const out = execFileSync(process.execPath, ['--test', 'test/protocol-shape.test.js'], {
      cwd: tmp,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ''}${error.stderr ?? ''}` }
  }
}

function summarize(result) {
  const fail = /^ℹ fail (\d+)$/mu.exec(result.out)?.[1] ?? '?'
  const message = /AssertionError[^\n]*/u.exec(result.out)?.[0]?.replace(/^AssertionError[^:]*:\s*/u, '') ?? '(无断言消息)'
  return { fail, message: message.slice(0, 110) }
}

const cases = [
  {
    name: '宿主能力名改了：Capability.PROGRESS = "plan"',
    file: 'src/protocol.js',
    from: "PROGRESS: 'progress'",
    to: "PROGRESS: 'plan'",
  },
  {
    name: '宿主字段名改了：reducer 里 message.progress = ...',
    file: 'src/reducer.js',
    from: 'message.progress = record.progress',
    to: 'message.plan = record.progress',
  },
]

prepare()
const baseline = summarize(runCopy())
console.log(`基线（未改动的副本）：fail=${baseline.fail}  code=${runCopy().code}`)

for (const item of cases) {
  prepare()
  const path = join(tmp, item.file)
  const source = readFileSync(path, 'utf8')
  const doctored = source.replace(item.from, item.to)
  if (doctored === source) {
    console.log(`⚠️ 用例「${item.name}」没找到替换目标（${item.from}），无法验证 —— 不算通过`)
    continue
  }
  writeFileSync(path, doctored, 'utf8')
  const result = runCopy()
  const info = summarize(result)
  console.log(`\n模拟：${item.name}`)
  console.log(`  fail=${info.fail}  exit=${result.code}`)
  console.log(`  红在哪：${info.message}`)
}

// 收尾：副本删掉；共享的 src/ 一行都没动过
rmSync(tmp, { recursive: true, force: true })
console.log('\n临时副本已删除；共享 src/ 全程未被修改')
