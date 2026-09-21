# DSH 会话事件契约（已核对权威定义）

> 本文件是 `dsh-work-icon` 读取 DSH 会话事件的**权威依据**。
> 所有条目均对照 `@deepseek-ai/*` 包内真实 `.d.ts` / 源码核对过，不是从别的插件推断的。
> 核对日期 2026-09-12。若 DSH 升级导致字段变化，重新核对本文件。

## 1. 权威定义在哪

| 内容 | 路径:行 |
|---|---|
| `SessionEventMap` / `SessionEvent` 信封 / `TurnEndReason` / `TodoItem` | `@deepseek-ai/dsh-session/lib/types/types.d.ts:180-457` |
| `session/event` 签名 + `ctx.sessions` 声明 | `@deepseek-ai/dsh-session/lib/types/index.d.ts:30, 66` |
| 合并后完整 `SessionEventMap`（含 `approval/*`、`session/title`） | `@deepseek-ai/dsh-commands/lib/typert.host.js:426` |
| `ApprovalOutcome` / `TokenUsage` / `LlmCallConfig` / `ToolMessageSource` | 同上 `:177-186, :286, :509` |
| `agent/status` / `AgentStatus` / `Agent.status` | `@deepseek-ai/dsh-agent/lib/types/runtime-types.d.ts:45, 70, 169` |
| `ctx.agents: AgentRegistry` | `@deepseek-ai/dsh-agent/lib/types/index.d.ts:28, 349, 363` |
| `EventOptions.global` | `cordis/lib/types/events.d.ts:88, 105` |
| 运行时事件构造与实参 | `@deepseek-ai/dsh-session/lib/index.js:1457-1463`（形状）、`:1468`（实参）、`:1766`（disposed） |
| 内置工具名 | `@deepseek-ai/dsh-tool-*/lib/index.js` |

包位置：`C:\Users\david\.dsh\profiles\web\node_modules\@deepseek-ai\`

## 2. 事件信封

运行时构造（`dsh-session/lib/index.js:1457-1463`）：

```js
{ type, seq, time, data, ...surfaceMetadata }
```

监听实参（`:1468`）：`callbackArgs = [session, event]` —— 即 `(session, event)`，**顺序是 session 在前**。

## 3. 事件与 data 形状（逐条已核对）

```ts
'turn/start':        { turn: number }
'step/start':        { turn, step }
'assistant/chunk':   { turn, step, chunk }
'assistant/message': { turn, step, message: AssistantMessage, usage?: TokenUsage, interrupted?: true }
'request/header':    { header: EpochHeader, reason: RequestHeaderReason }
'tool/call':         { turn, step, callId: CallId, name: string, arguments: string }
'tool/result':       { turn, step, message: ToolResultMessage, error?: { name, code }, meta?: JsonValue }
'user/message':      UserMessage               // source.kind === 'user'，无 callId
'todo/write':        { todos: TodoItem[] }
'turn/end':          { turn, reason: TurnEndReason }   // reason.kind
'approval/asked':    { id: ApprovalRequestId, toolName: string, callId?: CallId, reason?: string }
'approval/decided':  { id: ApprovalRequestId, outcome: ApprovalOutcome }
'session/title':     { title }                 // 会话标题的唯一来源
```

**`session/disposed` 不是 `session/event`**，它是独立订阅，实参只有 `(session)`（`index.js:1766`）。

## 4. 插件契约

- `export const inject = ['sessions']` —— 服务名就是 `sessions`（`Context.sessions: SessionStore`）✅
- `ctx.on('session/event', (session, event) => ...)` ✅ 参数顺序正确
- `ctx.on(..., { global: true })` ✅ 真实存在（`EventOptions.global`）
- `ctx.effect(() => teardown)` ✅ 正确用法

## 5. 工具调用怎么读

- 工具名：**`data.name`**（如 `bash` / `pwsh` / `read` / `write` / `edit` / `glob` / `grep` / `todo_write` / `ask_user_question` / `web_search` …）
- 参数：**`data.arguments` 是未解析的 JSON 字符串**，必须 `JSON.parse` 后再读字段
- bash 命令文本：`JSON.parse(data.arguments).command`
- 结果是否报错：**`data.message.content[0].isError`**
- 结果关联调用：`data.message.source.callId` 或 `data.message.content[].toolCallId`

## 6. 官方状态接口（比事件推断权威）

- `ctx.agents.get(id)` / `ctx.agents.list()` → `Agent`
- `Agent.status: 'idle' | 'running'`
- 事件 `agent/status` → `payload.agent` / `payload.status`

用它做粗粒度权威信号（running/idle），事件推断只负责细粒度（哪个工具、是否等待审批）。

## 7. ⚠️ 不存在、别去读的字段

| 错误路径 | 实际情况 |
|---|---|
| `data.message.usage` | ❌ — usage 在 **`data.usage`** |
| `usage.totalTokens` | ❌ — `TokenUsage` 只有 `inputTokens`/`outputTokens`/`cacheReadTokens?`/`cacheWriteTokens?`/`reasoningTokens?`，**没有 total**；总量自己加 |
| `data.args` / `data.input` | ❌ — 只有 `data.arguments`（JSON 字符串） |
| `data.toolName` | ❌ — 只有 `data.name` |
| `data.isError` | ❌ — 在 `data.message.content[0].isError` |
| `session.cwd` / `session.context.cwd` / `session.title` / `session.name` / `session.header.title` / `session.header.name` | ❌ — Session 只有 `surface` / `header` / `id` / `firstLiveSeq` / `events` / `seq`；工作目录读 **`session.header.cwd`**，标题读 **`session/title` 事件的 `data.title`** |

## 8. 注册方式（三处 + 重启，缺一不可）

**① 插件包 `package.json`**
```json
"exports": { ".": "./src/index.js", "./cordis.patch.yml": "./cordis.patch.yml" },
"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
```

**② 插件包 `cordis.patch.yml`**
```yaml
- insert:
    - id: dsh-work-icon
      name: dsh-work-icon
      config:
        enabled: true
```

**③ profile `C:\Users\david\.dsh\profiles\web\package.json`** —— 两处：`dependencies` 里加 `"dsh-work-icon": "file:C:/Users/david/.dsh/local-plugins/dsh-work-icon"`，`dsh.profile.bundles` 数组里加 `"dsh-work-icon"`。

**④** `dsh plugin --profile web install` → **重启 dsh web**。

依据：本机五个已装成功的本地插件（`dsh-stabilizer`、`meow-memory`、`dsh-boot-guard`、`dsh-better-sidebar`、`dsh-raw-html`）全部同构。注意 `cordis.patch.yml` 只能做 id 覆写 / insert，**名称必须是可被 Node 解析的包名**，不能直接挂本地路径。

## 9. 未确认项

- 注册片段基于 5 个同构插件的实测配置 + loader 语义推断，未逐行读 loader 实现
- `arguments` 的 JSON 结构只验证了 `bash`（`args.command`），`pwsh` / `str_replace_editor` 等未逐一核对 schema
- **未找到**独立的"等待审批"查询服务 —— 审批态只能由 `approval/asked|decided` 事件推断
