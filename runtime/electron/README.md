# dsh-work-icon · Electron 原生窗口运行时（H2「等离云核」）

> 事实来源：`docs/SPEC-H2.md`（第 2/3/4 节视觉、第 5 节协议、第 6 节交互、第 7 节落盘、第 8 节验收、第 9 节实现坑）
> 视觉基准：历史原型 `hybrid.html` 的 `<symbol id="base-h2">`、`halo()` 粒子几何、`.st-*` CSS 变量（该文件未随仓库搬迁）
> 起点：Electron spike 原型（透明/置顶/拖动/位置记忆已跑通），未推倒重来 —— 其 **Python 版源码已随仓库保存于 `spike/`**，Electron 版原型未搬迁

一个进程 = 一个原生置顶透明窗 + 一个渲染页；宿主通过 **stdin/stdout 换行分隔 JSON** 驱动它。

---

## 1. 宿主集成（Node 侧照改这一段）

### 1.1 照抄这三行就行（已真跑验证）

```js
spawn(
  '<插件包根>\\runtime\\electron\\node_modules\\electron\\dist\\electron.exe',   // command：见 1.2 的解析方式
  ['runtime/electron'],                                                          // args：传目录，Electron 读该目录 package.json 的 main
  { cwd: '<插件包根>', stdio: ['pipe', 'pipe', 'pipe'] }                          // cwd：插件包根（含 runtime/ 与 src/ 的那一层）
)
```

| 项 | 值 |
|---|---|
| `helper.command` | **`node_modules\electron\dist\electron.exe` 的绝对路径**（见 1.2，别用 `.cmd` 垫片） |
| `helper.args` | `["runtime/electron"]`（传目录，不是 main.js；Electron 会读该目录的 `package.json.main`） |
| `helper.cwd` | **插件包根目录**（即含 `runtime/` 与 `src/` 的那一层） |
| stdio | 必须 `pipe`（stdin/stdout 都要）；**不要设 `ELECTRON_RUN_AS_NODE`** |
| 退出 | 宿主 kill 子进程或关掉 stdin 管道即可，窗口会自己退出；窗口崩了宿主不受影响 |

> ✅ **逐字真跑过**（`node tests/spawn-spec.mjs`，全绿）：从 `cwd=<插件包根>` 用 `args=["runtime/electron"]` 起子进程 →
> 收到 `ready`（子进程 pid 与 `ready.pid` 一致）→ 发 `state WORKING` 生效 → 发 `shutdown` 后自行退出、**退出码 0**、
> stdout 只有协议 JSON。**三种 command 写法都实测**，结论见 1.2。

### 1.2 `command` 到底写哪个？（实测结论）

| 写法 | 结果 | 建议 |
|---|---|---|
| `<包根>\runtime\electron\node_modules\electron\dist\electron.exe`（绝对路径） | ✅ ready + exit 0，无警告 | **用这个** |
| `...\node_modules\.bin\electron.cmd` + `{ shell: true }` | ✅ 可用，但 Node 报 `DEP0190`（shell 参数不转义，有注入风险） | 备选 |
| `...\node_modules\.bin\electron.cmd`（不带 `shell`） | ❌ **Node 直接抛 `EINVAL`**（Node ≥18 拒绝执行 `.cmd`/`.bat`） | 别用 |
| 开发期复用 spike 的 electron.exe | ⚠️ **已废弃（2026-09-13）** —— 那条依赖安装已获批准删除，不要再照抄 | 用 1.1 的仓库自带那份 |

### 1.3 生产环境安装（一次）

```powershell
cd <插件包根>\runtime\electron
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install --registry https://registry.npmmirror.com --no-audit --no-fund
# ⚠ 若装完没有 dist\electron.exe，说明 postinstall 没跑（npm 有时会跳过），手动补一次：
node node_modules\electron\install.js
Test-Path node_modules\electron\dist\electron.exe   # 必须为 True
```

> 本机实测：`npm install` 28 秒装完包体，但 **`dist\electron.exe` 需要手动跑一次 `install.js` 才落盘**（跑完立即有）。
> 宿主侧集成前请先 `Test-Path` 确认一次，否则会出现"进程起来了但立刻退出"的假故障。

```jsonc
// config.json —— helper 段（生产）
{
  "helper": {
    "command": "<插件包根>\\runtime\\electron\\node_modules\\electron\\dist\\electron.exe",
    "args": ["runtime/electron"],
    "cwd": "<插件包根>"
  }
}
```

```jsonc
// 开发期：直接用仓库自带的那份，不用另外找一份 electron（原先"复用 spike"的写法已废弃）
{
  "helper": {
    "command": "C:\\Users\\david\\.dsh\\local-plugins\\dsh-work-icon\\runtime\\electron\\node_modules\\electron\\dist\\electron.exe",
    "args": ["runtime/electron"],
    "cwd": "C:\\Users\\david\\.dsh\\local-plugins\\dsh-work-icon"
  }
}
```

> ⚠ **Electron 启动需要可用的用户目录**：若宿主把 `USERPROFILE` 指到不存在的目录，Electron 会**静默起不来**
> （无 stdout 也无 stderr）——本机实测踩到过，集成时别改 `USERPROFILE` 到空目录。

### 1.4 不要污染宿主的 `node --test`

`node --test` 的默认匹配含 `**/test/**/*.?(c|m)js`，会**递归吃到**插件里的端到端脚本并真的去 spawn Electron。
本运行时已把脚本移出该模式：**端到端脚本在 `runtime/electron/tests/`（复数）**，`runtime/electron/test/` 下只剩
证据图片与隔离区，**没有任何 .js/.mjs/.cjs**；从插件包根裸跑 `node --test` 已实测**不再触碰** `runtime/electron`。
本插件自己的入口是 `npm test`（= `node tests/run-all.mjs`），与宿主的 `test/*.test.js` 互不干扰。


命令行参数（可选，全部有默认值）：`--scale 96|140|200`、`--ratio <窗口/图标比，默认 1.5>`、`--state <七态之一>`、
`--log <路径>`、`--home <目录覆盖>`、`--window-timeout <ms>`（默认 15000）、`--hidden`（不显示窗口）。

> 真窗口会话有硬约束：`--exit-after` 超过 20 秒会被**自动钳制到 20 秒并打 WARN**；可见会话没给 `--exit-after` 时自动加 20 秒兜底；
> 退出前一律先 `hide()` 再 `destroy()`；`--dwm-phase` 不带 `--dwm-pos` 时窗口强制落在屏幕右下角。

### 协议（SPEC 第 5 节，逐字段实现）

* 启动后立刻向 stdout 发 `{"protocolVersion":1,"kind":"ready","timestamp":…,"pid":…}`
* 收 `state`：`{state, activity?, task?, session?, progress?, elapsedMs?, tokens?}`（`tokens={input,output,total}`）
* 收 `pulse`：`{state, activity?}` —— 只续命，不改变正在显示的状态（除非窗口处于 DISCONNECTED，此时按 pulse 恢复）
* 收 `config`：`{scale, opacity, alwaysOnTop, clickThrough, position, fps, includeSubagents?}`
* 收 `shutdown`：优雅退出（退出码 0）
* 发 `setting`：`{key, value}`，key 用宿主白名单命名 —— `window.scale` / `window.opacity` /
  `window.alwaysOnTop` / `window.clickThrough` / `window.position` / `window.fps`，
  以及**插件级**的扁平键 `includeSubagents`（对应宿主 `SETTABLE_TOP_LEVEL_KEYS`）
* 发 `closed`：`{reason}` —— 用户从右键菜单选了"退出"（`menu-exit`）或渲染进程崩了（`renderer-gone:*`）
* **无法解析的行**：记日志 + 忽略，不崩不阻塞；**空行**静默忽略
* **15 秒**收不到任何消息 → 自行转 DISCONNECTED（独立兜底，与宿主显式发 DISCONNECTED 不冲突）
* ⚠ **SUCCESS 的 2.5s 回落由宿主负责**：窗口只播一次性动画（白光闪 + 扩散环），**不自行改状态机**

### 落盘

* 配置 `%USERPROFILE%\.dsh\work-icon\config.json` —— **原子写**（同目录临时文件 + fsync + rename），
  且保留磁盘上已有的其它字段（只改 `window.*`，不会把宿主写的 `enabled/helper/...` 抹掉）
* 日志 `%USERPROFILE%\.dsh\work-icon\helper.log` —— 超 1MB 归档成 `.1` 再重开
* stdout **只**用于协议；所有日志走 stderr + 日志文件

---

## 1.4 流畅度（帧率）—— 可配置 + 运行时实时生效

**默认 standard：IDLE 15fps / THINKING 30 / WAITING 30 / WORKING 60**（用户反馈「空闲 4fps 太顿」，已从 4fps 提上来）。
DISCONNECTED 永远完全停表；SUCCESS/ERROR 是一次性动效，播完即停。

三档预设（**右键菜单 →「流畅度」** 可切；点了会发 `setting {key:'window.fps'}` 给宿主持久化，并立即本地生效）：

| 预设 | IDLE | THINKING | WAITING | WORKING | 用途 |
|---|---|---|---|---|---|
| `saver`（省电） | 4 | 15 | 15 | 30 | 想省电时 |
| `standard`（标准） | **15** | 30 | 30 | 60 | **默认** |
| `smooth`（流畅） | 30 | 60 | 60 | 120（跟满刷新率） | 观感优先 |

配置键：`config.json` 的 `window.fps`，三种写法都支持：
``jsonc
{ "window": { "fps": "smooth" } }                                  // 预设名
{ "window": { "fps": { "power": "smooth" } } }                     // 等价写法
{ "window": { "fps": { "idle": 10, "working": 45 } } }             // 自定义（缺的字段取 standard）
``
**宿主可在运行时用 `config` 消息实时改，不需要重启窗口**：
``jsonc
{ "kind": "config", "fps": "smooth" }                     // 或 { "fps": { "idle": 10, "working": 45 } }
``
主进程收到后立刻把预算下发给渲染层（渲染层日志会打一行 `fps-config -> {...}` 确认），非法值会被忽略并记日志，不会崩也不会重置成默认。`config` 消息**不落盘**（持久化由宿主负责）；只有用户点菜单才走 `setting` 回传宿主持久化。
命令行等价开关：`--fps saver|standard|smooth` 或 `--fps json --fps-json '{"idle":10}'`（测试用）。

**实测 CPU（140px 真窗口，进程树 TotalProcessorTime 增量 ÷ 单核，20 逻辑核）**：

| 档位/状态 | 实测 | SPEC §8 目标 |
|---|---|---|
| 标准档 IDLE（15fps） | **8.75%**（同一运行内两次采样一致；跨运行区间 **6.5%–10.9%**） | < 10% 单核 —— **多数样本达标，但有一次 10.94% 超标**（如实报告，未粉饰） |
| **省电档 IDLE（4fps）** | **2.50% / 3.75%** | < 10% ✅ 有充足余量 |
| 标准档 WORKING（60fps） | **11.2%–29.4%**（跨运行波动大） | < 35% ✅ |
| 工作态重绘速率 | 55–60 次/秒 | 验收第 3 条 ≥55fps ✅ |
| 空闲态重绘速率 | 14–15 次/秒（standard）/ 约 4 次/秒（saver） | —— |

> 想要稳过 <10% 就把菜单切到「省电」（2.5–3.8%）；想要更顺就切「流畅」（CPU 会上去，用户已表态观感优先）。

---
## 1.5 会话生命周期（生产 vs 测试）—— 读这一节能避免一场生产事故

**生产会话 = 宿主启动的那一个**：`args=['runtime/electron']`、`cwd=<包根>`、**不带任何 flag**。
规则：**生产会话永不自行退出**，一直活到 `shutdown` 消息或父进程 stdin EOF。

**测试会话 = 命令行里出现任一显式测试标记**（`--hidden` / `--shot*` / `--dwm-phase` / `--wfp-probe` /
`--exstyle-probe` / `--hit-test` / `--trans-test` / `--test-drag` / `--test-setting` / `--fps-log` /
`--exit-after` / `--print-plan` … 完整清单见 `main.js` 的 `TEST_MARKERS`，也可用 `--test-session` 显式声明）。
规则：**可见的测试会话若没给 `--exit-after`，会被加 20 秒兜底退出**（保护用户屏幕，SPEC 第 10 节第 5 条）；
`--exit-after` 超过 20 秒一律钳制到 20 秒。

> ⚠️ **血的教训（2026-09-12 生产事故）**：上一版用"没传 `--exit-after` 就当测试会话"来兜底，
> 于是生产的空参数启动被加了 20 秒自杀定时器 → **图标亮 20 秒消失**，且按 SPEC §10.3 宿主不会重启它 → 永久消失。
> **判断"是不是测试"只能靠显式标记，绝不靠"有没有参数"。** 修改这段逻辑后必须跑 `node tests/lifecycle.mjs`。

干跑取证（不创建窗口、不显示任何东西）：
`powershell
`='1'` 后再启动，会打印一行 `PLAN {...}`（含 `exitAfterSec` / `autoExitTimer` /
`isTestSession` / `testMarker`）然后立即退出。这是"生产参数下到底会不会自杀"最直接的证据。
`

---
## 1.6 右键菜单项一览（含用户最近的两个改动）

| 菜单项 | 类型 | 作用 | 回传宿主 |
|---|---|---|---|
| 尺寸 | radio 96/140/200 px | 图标直径 | `window.scale` |
| 透明度 | radio 60/80/100% | 整体不透明度 | `window.opacity` |
| **流畅度** | radio 省电/标准/流畅 | 动画帧率三档（4/15·15/30·30/120） | `window.fps` |
| 始终置顶 | checkbox | 保持最上层 | `window.alwaysOnTop` |
| 鼠标穿透（圆外） | checkbox | 圆外是否穿透到下层窗口 | `window.clickThrough` |
| **跟随子代理** | checkbox | **默认关闭**。开启后宿主在归约时会统计子会话状态（过滤逻辑在宿主侧，窗口只显示勾选态） | `includeSubagents`（**扁平键**，插件级配置，见下） |
| 退出 | 普通项 | 关掉图标窗口 | 发 `closed {reason:'menu-exit'}` |

> ❌ **「开机自启」已删除（设计失误，2026-09-12）**：这个图标是 **DSH 的子进程**——DSH 不起，就没有宿主去 spawn 它，
> 它自己起来只会显示 DISCONNECTED。所以那个开关**逻辑上不成立**，还会写注册表（有副作用无收益）。
> **图标生命周期跟随 DSH：DSH 起来它就在，DSH 关掉它就退出；不需要、也不提供开机自启。**
> 宿主编译后的白名单里也已同步移除 `window.autostart`（`DROPPED_WINDOW_KEYS`），旧配置里的残留会被丢掉。

**`includeSubagents` 是单一真相源（持久化权在宿主，键在顶层，不在 `window.*`）**：
窗口侧**只**在内存里保留一份用于显示勾选态，**绝不写进 `runtime` 自己的 `config.json`**
（否则宿主下次保存会抹掉 `window.includeSubagents`，两边漂移）。真值来源只有两个：
① 启动时读 config.json 的**顶层** `includeSubagents`（缺失即 `false`）；
② 运行时宿主回发的 `config`。发 `setting` 永远用扁平键 `includeSubagents`。
`跟随子代理` 的两种下发写法窗口都认（宿主回发 `config` 即可，无需重启窗口）：
``jsonc
{ "kind": "config", "includeSubagents": true }
{ "kind": "config", "window": { "includeSubagents": true } }
``

---
## 1.7 实例隔离与清理纪律（生产事故 2026-09-12 的加固，改测试前必读）

**事故**：测试收尾的清理写成 `Name='electron.exe' AND CommandLine LIKE '*dsh-work-icon*'` ——
生产图标的命令行里恰好含 `...\dsh-work-icon\runtime\electron`，于是**用户正在用的图标被测试强杀**，
日志"戛然而止、无优雅退出记录"（不是 shutdown、也不是 EOF），且 SPEC §10.3 规定宿主不重启 → 图标永久消失。

**现在的三条纪律**：
1. **绝不按进程名通杀**：禁止 `Get-Process electron | Stop-Process -Force`、禁止 `Stop-Process -Name electron`、
   禁止只按仓库路径模糊匹配。清理只认下面两类**本轮独有**标记。
2. **清理判据**（`tests/harness.mjs` 的 `killStrayElectron`）：
   ① 本轮 `spawn` 过的 PID（带时间戳防复用）；② 命令行里含**本轮临时 home / `test\out` 路径**的进程
   （Chromium 会把 `--user-data-dir` 传给 GPU/渲染/工具子进程，所以父子都能覆盖）。
   生产实例的 home 是 `%USERPROFILE%\.dsh\work-icon`，两条都命不中 → **不会被误杀**。
3. **userData 按 HOME 隔离**：`main.js` 里 `app.setPath('userData', path.join(HOME,'userdata'))`。
   生产是 `~\.dsh\work-icon\userdata`，测试每个用例是临时目录 —— 顺带与 `%APPDATA%\Electron` /
   `dsh-ark-core-*` 等其它 Electron 应用彻底分开 profile 命名空间。
   **本运行时没有 `requestSingleInstanceLock()`**：多实例共存是允许的（生产一个、测试一个互不干扰）。
   （旧的 `%APPDATA%\dsh-work-icon-runtime-electron` 已成为历史目录，可删。）

**守门测试**：`node tests/production-survival.mjs` —— 起一个**生产式实例**（零 flag、home 在测试树之外、长活），
然后跑**完整测试套件**，最后断言它**仍然存活且仍在响应**。改动任何清理/生命周期相关代码后必须跑它。
（它约 3 分钟，因为它内部会跑一整轮套件，所以不进默认套件。）

---
## 1.8 交互模型：悬停 / 单击 / 拖动 / 双击（2026-09-12 定稿）

| 操作 | 行为 |
|---|---|
| **鼠标悬停** | 显示**轻量面板**（图标下那行 状态 + token）—— 原有行为不变 |
| **单击（无移动）** | **什么都不做**（只在 ERROR 态发一条 work-icon.clearError 确认） |
| **单击 + 移动** | **拖动悬浮窗**（原有行为不变，位置记忆仍然只由真拖动写入） |
| **双击** | **开关完整面板**（440×340 / 底板 α0.78） |
| 右键 | 菜单（不变） |

> 💡 **为什么开关用双击而不是单击**（用户原话）：**在可拖动元素上，单击本身就是有歧义的**——
> 它既可能是"点一下"，也可能是"拖动的起点"。所以把**单击完整地留给拖动**，开关类操作交给双击。
> 这条也解释了为什么"单击聚焦 DSH"这个旧行为被**取消**了：它和拖动起点争抢同一个手势。

**双击判据**（index.html 里的一处常量区，改这里必须同步改 	ests/panel-toggle.mjs）：
- 一次「点击」= 按下到抬起**累计位移 ≤ 4px** 且**时长 < 500ms**；
- 两次「点击」间隔 **≤ 350ms** → 双击；> 350ms → 两次独立单击（**不**切面板）；
- **一旦累计位移 > 4px（真拖动）立刻清空双击计时** ⇒ 拖完不会被算成双击的前半段；
- 拖动语义与改动前逐字一致：任何非零位移都立刻 dragBy（不设死区），抬起时位移 > 4px 才 dragEnd（**只有它写位置记忆**）。

**完整面板**：默认**关闭**、**不持久化**（重启后不会莫名多出一个大面板）；与轻量面板**互斥**（大面板开着时悬停不出轻量面板）；
展开/收起用 **120ms 淡入淡出 + 高度直接切换**，**不做逐帧 setBounds 动画**（透明窗口 resize 会撕裂并引发 SVG 重排）。
展开时窗口 210×210 → **440×525**，**图标屏幕位置一动不动**（只向下、左右对称加宽）。

⚠️ **α 0.78 的代价（实测，用户已知情接受）**：**浅色壁纸下明细行 3.5:1、微标签 3.3:1，低于 WCAG AA 4.5:1**；
深色/蓝调壁纸下全绿（主文 11.1 / 明细 5.7 / 微标签 5.3）。α 是**一处常量** PANEL_ALPHA（main.js），
将来做成右键可调的 `window.panelAlpha`。

---
## 2. 怎么跑 / 怎么测

```powershell
$EL = "<插件包根>\runtime\electron\node_modules\electron\dist\electron.exe"   # 或 spike 里那个

# 手动看一眼（会显示真窗口）
& $EL <插件包根>\runtime\electron --state WORKING

# 常用开关（都有默认值）
#   --scale 96|140|200     图标直径
#   --ratio 1.5            窗口/图标比例（默认 1.5；也可写进 config.json 的 window.ratio，范围 1.0–2.5）
#   --state <七态之一>      --log <路径>      --home <目录覆盖>      --window-timeout <ms>
#   --hidden               不显示窗口（所有离屏测试都用它）

# 全部测试（**默认 100% 离屏**：不显示窗口、不移动光标、不合成任何输入）
cd <插件包根>\runtime\electron
node tests/run-all.mjs
node tests/run-all.mjs --with-shown     # 额外跑真窗口会话（性能/置顶；单次 ≤20s、右下角；**跑前需获准**）
```

| 脚本 | 覆盖 | 是否显示真窗口 |
|---|---|---|
| `tests/production-survival.mjs` | **生产实例存活回归**：生产式实例 + 整轮套件跑完仍存活（复现并锁死 2026-09-12 误杀事故） | 含一个常驻窗口（右下角），**单独跑** |
| `tests/menu-settings.mjs` | **菜单项回归**：跟随子代理默认 false / 扁平 setting / config 实时改勾选态不重启；开机自启全链路已清除 | 全程隐藏 |
| `tests/fps-config.mjs` | **帧率配置 + config 实时生效**：启动预设、config 改档后同一进程立即采用、菜单路径发出 `setting` 并落盘、非法值被忽略 | 全程隐藏 |
| `tests/lifecycle.mjs` | **会话生命周期回归**：生产参数（argv 无测试标记）不得有任何自动退出；测试标记下仍兜底 20s（干跑取证，不创建窗口） | 全程隐藏 |
| `tests/shots.mjs` | 七态 × 3 种底 离屏导出 PNG | 全程隐藏（`show:false` + `capturePage`） |
| `tests/compare-golden.mjs` | 与 `golden/refs/ref-*-240-dark.png` 像素比对 + 透明通道自洽性 | 隐藏 |
| `tests/rotation.mjs` | **旋转缺陷取证**：核心是否恒定不动 + 轴心是否在视框中心（0/90/180/270 四个冻结相位） | 隐藏 |
| `tests/passthrough.mjs` | **点击穿透（纯离屏）**：`setIgnoreMouseEvents` 切换后的 `WS_EX_TRANSPARENT`/`WS_EX_LAYERED` 读回 + 命中几何分界（圆内拦截 / 圆外穿透，分界 = 直径/2） | 全程隐藏 |
| `tests/protocol.mjs` | ready/state/pulse/config/setting/shutdown、坏 JSON、空行、未知 kind、15s 静默转 DISCONNECTED、退出码、stdout 纯净 | 隐藏 |
| `tests/position.mjs` | 拖动（内部 `--test-drag` 路径）→ 落盘 → 重启恢复（±2px）+ 越界夹取 | 隐藏 |
| `tests/transitions.mjs` | 300ms 交叉淡入（抓切换途中帧，证明是插值不是硬切） | 隐藏 |
| `tests/spawn-spec.mjs` | 逐字照抄本 README 的 spawn 规格真跑（command/args/cwd + ready/state/shutdown） | 隐藏 |
| `tests/perf.mjs` | CPU / 内存 / 帧率（**CPU 必须真窗口测**才有意义 + 隐藏口径的内存） | 真窗口 ~13.5 秒（仅 `--with-shown`，需获准） |
| `tests/wfp.mjs` | 真窗口 WindowFromPoint 命中取证（默认套件**不含**，需获准单独跑） | 真窗口 ~5 秒 |
| `tests/dwm.mjs` | 真机合成 / 置顶位 / 不抢焦点（**只读取证**） | 真窗口 ~15–17 秒（仅 `--with-shown`，需获准） |
| `tests/fps-cpu.mjs` | 帧率档位 CPU 对照（standard vs saver，各两次采样） | 真窗口 ~28 秒（单独跑，需获准） |
| `tests/production-session.mjs` | **生产路径存活确认**：宿主式无参数启动，19.5s 内不得退出 | 真窗口 19.5 秒（仅 `--with-shown`，需获准） |

### 取专用调试开关（只影响抓图，不影响产品路径）

```
--spin <度>     冻结相位：把动画停在该角度再抓图（旋转轴心取证的客观手段）
--hide a,b,c    临时隐藏指定层（如 cloud/seg/plate），用来把被测层从盘状粒子云里隔离出来
--shot <盒子>   离屏抓图盒子边长（配 --out、--bg dark|white|none、--state）
```

### 明确不做的事（SPEC 第 10 节红线）

* **零真实输入合成**：全树无 `SetCursorPos` / `mouse_event` / `SendInput` / `keybd_event` / `SendKeys` / `pyautogui` / AutoHotkey。
  曾产出的三个脚本（`mouse-drag.ps1` / `mouse-click.ps1` / `probe-dpi.ps1`）连同 `cursor-probe.js` 都已隔离到
  `test/_QUARANTINE-real-input/`，**不得恢复**。拖动验证走内部 `--test-drag`（与真实拖动同一条代码路径）。
* **零保活 / 零自动重启**：运行时不监听自己的崩溃、不重启、不重试。`setInterval` 只有三处用途——
  ① 40ms 光标命中轮询（点击穿透）；② 4s 重新顶回置顶 z 序；③ 指标日志。
  15s 无消息 → `DISCONNECTED` 是 SPEC 第 5 节要求的**UI 状态兜底**，不是进程看门狗。
* **真窗口能少则少**：单次 ≤20 秒、放屏幕右侧/角落、测完立即退出并清理进程（测试末尾都会 `killStrayElectron()`）。


---

## 2.5 窗口尺寸规则（SPEC 第 1 节 v2，实测依据）

**窗口边长 = 图标直径 × 1.5（图标占窗口宽度 66.7%），图标在窗口内居中。**

依据：另一个验证者实测 —— Electron 在 140px 下即使 SVG 占窗口 82%，光晕（drop-shadow）**仍被窗口边界裁切**
（`outer_frame_max_alpha=4`，边缘出现非透明像素 = 硬切痕迹）；调到 **66% 时外框 alpha=0**，
全透明占比从 11.6% 升到 28.8%。边距就是给光晕留的容身之处，**给不够小尺寸下就有肉眼可见的硬切**。

比例可覆盖（用户可能调图标大小）：CLI `--ratio <1.0–2.5>`，或 config.json 里写 `window.ratio`，默认 1.5。
140px 实测：窗口 **210×210**（`tests/dwm.mjs` 里断言了这个值）。
`--shot` 断章抓图模式例外：盒子 = 请求尺寸、pad=0（与黄金样本同一约定），否则像素比对对不上。

---
## 3. 视觉（七态，逐项照抄 SPEC 第 3、4 节）

层：L1 底盘 r=97（径向渐变 `#050809` 86%→50%→0，默认开） / L2 刻度环 r=94 dasharray `1.5 7` /
L3 等离子云（球面投影 y×0.94，深→浅排序） / L4 分段环 r=60 dasharray `40 16 8 16` 圆头 /
L5 内细环 r=48 / L6 核心辉光 r=44 高斯模糊 11 / L7 核心（三角 + r=12 圆）。

| 状态 | c1 | c2 | glow | core | 粒子数 | 半径带 | 角速度 |
|---|---|---|---|---|---|---|---|
| IDLE | `#3d7688` | `#1b3b47` | rgba(80,190,220,.20) | .13 | 36 | 80–96 | 60s/圈（6Hz 步进） |
| THINKING | `#38e8ff` | `#176c85` | rgba(56,232,255,.55) | .42 | 62 | 76–94 | 24s/圈 |
| WORKING | `#5cffd0` | `#128f78` | rgba(92,255,208,.62) | 1.00 | 98 | 72–92 | 6s/圈 |
| WAITING | `#ffb340` | `#a35a08` | rgba(255,179,64,.62) | .55 | 52 | 80–97 | 18s/圈 |
| SUCCESS | `#8dffae` | `#1f9b5a` | rgba(141,255,174,.55) | 1.00 | 98 | 72–92 | 静止 |
| ERROR | `#ff4d6d` | `#8e0f2a` | rgba(255,77,109,.62) | .70 | 98 | 72–92 | 静止 |
| DISCONNECTED | `#5a636e` | `#2b3138` | rgba(140,150,160,.16) | .20 | 36 | 80–96 | 静止 |

* 切换一律 **300ms 交叉淡入**（双层 opacity + 粒子按序号错峰揭示 = 粒子数线性插值，不跳数）
* SUCCESS：一次性白光闪 + r 34→96 扩散环（1.2s），状态回落交给宿主
* ERROR：核心左右抖动 3 次（每次 ±2px / 80ms），之后停在该态
* WAITING：1.9s 呼吸脉冲，辉光模糊 6px↔20px 档
* 悬停：整体放大 1.06 + 显示状态文字（含 activity / task / tokens 总量）

### 旋转作用域（SPEC 第 2 节 L7，已按用户现场反馈修过）

**只有 L3 等离子云与 L4 分段环旋转；L7 核心（三角 + 中心圆）永不参与旋转**——"核心恒定不变形"是 H2 的定义性特征。

轴心由 CSS **唯一定义**：`.cloud,.seg{transform-box:view-box;transform-origin:50% 50%;will-change:transform}`，
旋转值写成 centre-less 的 `style.transform='rotate(Xdeg)'`。
**绝不能**同时用 SVG `transform` 属性写 `rotate(a 100 100)` —— 该属性等同 CSS `transform`，会与 `transform-origin`
叠加成双重轴心（实测等效轴心从 (100,100) 漂到 (200,200)，表现就是"绕图标最下面转"）。

客观证据（`node tests/rotation.mjs`，全离屏冻结相位）：
* 核心区（r≤46）在 0/90/180/270 四个相位下**最大通道差 0**（逐像素一致）；
* 底盘/刻度环/内环/辉光（避开分段环带）同样**最大通道差 0**；
* 只保留分段环时，环带加权平均半径摆动 **0.012 用户单位**、最外亮像素半径摆动 **0.099**——
  轴心若偏离中心 D，这两个量会按 ±D 量级摆动（D=100 时摆动约 200）。

### SPEC 未给的三态粒子参数 / 两处实现取舍（都写在这里，避免以后被当成 bug）

1. `SUCCESS / ERROR / DISCONNECTED` 的粒子参数 SPEC 第 3 节没给：与**黄金样本实现保持一致** ——
   SUCCESS/ERROR 用 WORKING 的几何（98 颗 / 72–92）；DISCONNECTED 用 IDLE 的几何（36 颗 / 80–96）。
   角速度按更新后的 SPEC 第 3 节：SUCCESS 2s/圈（庆祝加速，随一次性动效结束）、ERROR 0（冻结）。
2. WAITING 的 core 与 THINKING 的 core 呼吸区间取 `[core×0.82, core×1]` / `[core×0.94, core×1]`（与黄金样本一致）。
3. ERROR 的抖动施加在**核心组**上，不整窗抖（SPEC 只说了"左右抖动 3 次"，未指定作用对象）。
4. 粒子分布**保持 disk（球面投影）版**——用户已就 A/B 拍板选 disk，黄金样本 23 张参考图就是 disk 版。


---

## 4. 性能（SPEC 第 8 节第 4 款，本机 20 逻辑核 / 2880×1800 / scaleFactor 2.0）

**测量尺寸：图标直径 140px（scale=140，窗口 210×210 DIP = 直径 × 1.5）**
口径：真窗口（屏幕右下角，单次 13.5–17 秒）用进程树 TotalProcessorTime 增量 ÷ 单核。
**隐藏/离屏窗口的 CPU 不代表真实开销**（Chromium 不为不可见窗口合成，隐藏时≈0），所以 CPU 一律真窗口测。
帧率单独起一次会话测（要开 rAF 计数循环，本身会抬高 CPU），不与 CPU 测量混测。

| 项 | 目标（SPEC 第 8 节第 4 款） | 实测（多次采样） | 结论 |
|---|---|---|---|
| 空闲 IDLE 单核 CPU | < 10% | **0.00% / 2.34% / 3.39% / 4.69% / 5.47%** | 达标（优化前 20.6%–30%） |
| 工作 WORKING 单核 CPU | < 35% | **20.05%–27.34%**（60fps 档；120fps 档 34.38%） | 达标 |
| 空闲态实际重绘 | 4–10fps 足够表达慢呼吸 | **约 4 次/秒**（drvUpdates 实测 7–8 次/2s） | 达标 |
| 工作态重绘 | 验收第 3 条 ≥55fps | **56–60 次/秒**（drvUpdates 实测 112–121 次/2s） | 达标 |
| 内存 | **不设硬指标**（用户 2026-09-12 明确） | 最好 276MB | 见下 |

### 资源占用实测小结（五个方案；日志在 test/out/perf/）

内存双口径（app.getAppMetrics() + 进程树 WorkingSet，隐藏窗口，4 进程全在）：

| 配置 | Browser | GPU | Utility | Renderer | 合计 | 有效性 |
|---|---|---|---|---|---|---|
| 默认（硬件加速开） | 98.3MB | 127.0MB | 47.3MB | 76.4MB | **349.0MB** | baseline |
| **--no-gpu** | 95.2MB | 54.6MB | 47.4MB | 78.8MB | **276.0MB** | 唯一有效，−73MB |
| --js-flags=--max-old-space-size=64 | 98.1MB | 126.6MB | 47.4MB | 76.0MB | **348.2MB** | 无效（−0.8MB，噪声内） |
| --no-gpu + js-flags 64 | 94.9MB | 54.5MB | 47.4MB | 79.1MB | **275.9MB** | 与仅 --no-gpu 相同 |
| --single-process | — | — | — | — | 进程数仍为 4 | 无效（Electron 忽略该开关） |

**结论**：内存压到 276MB 就到头（= 预算 80MB 的 3.45 倍）。省掉整个 GPU 进程也只降到 276MB——
Browser(95)+Utility(47)+Renderer(79) 的进程基线本身已 221MB。**这是 Electron 路线的固有代价，不是没优化。**

### 已经落地的省电优化（用户要求保留）

**空闲态不再挂任何无限 CSS 动画**——CSS 无限动画会让 Chromium 合成器按显示器刷新率（本机 120Hz）持续产帧，
这正是空闲 CPU 压在 30% 单核下不来的主因。现在改成 JS 逐帧驱动 + 按状态给帧率预算：

| 状态 | 驱动方式 | 帧率预算 | 说明 |
|---|---|---|---|
| IDLE | setTimeout 链 | **4 fps** | 两次更新之间没有待处理帧，合成器彻底空闲 |
| THINKING / WAITING | setTimeout 链 | 15 fps | 呼吸/环绕够顺，仍不占满刷新率 |
| WORKING | rAF 链 | 跟显示器刷新率 | 保证工作态流畅（本机 120fps，CPU 仍只 10–16% 单核） |
| SUCCESS / ERROR | rAF 链 | 一次性 1.2s / 0.48s，播完即停 | —— |
| DISCONNECTED | **完全停表** | 0 | 稳态零重绘 |

另外：.cloud/.seg 加 will-change:transform 让旋转只走合成器（静态层不跟着每帧重画）；
一次只有一个 .layer 可见（其余 visibility:hidden）；粒子/环只动 transform 不重排；
状态不需动时**直接停掉渲染循环**（不排 rAF、不留 setTimeout）。

> 帧率自报里的 rAF 计数是显示器刷新率、不是重绘次数；真正重绘次数看同一行的 drvUpdates（每 2s 上报一次）。

---
## 5. 实现要点（都是本机实测踩出来的，写下来免得再踩）

1. **Windows 上 Electron 主进程的 `process.stdin` 在父进程管道下会立刻 end（假 EOF）** —— 不能用。
   直接 `fs.readSync(0)` / `fs.createReadStream({fd:0})` 能读到数据，但它在线程池里挂着一个未完成的读，
   **`process.exit()` 之后进程不会退出**（退出码也拿不到 0）。
   最终方案：`new net.Socket({fd:0, readable:true, writable:false})` —— 能读、能干净退出（实测 exit=0，无残留进程）。
   （现场证据：`tests/probe-electron-stdin.js`）
2. **透明 ≠ 鼠标穿透**：`WS_EX_TRANSPARENT` 必须由 `setIgnoreMouseEvents` 显式开关。
   实测 exstyle：穿透开 `0x08280028`（TRANSPARENT=yes / LAYERED=yes），穿透关 `0x08200008`（TRANSPARENT=no / LAYERED=no）。
3. **命中判定必须在同一个坐标系里做**：本机 2880×1800 物理 / 1440×900 逻辑（scaleFactor 2.0）。
   Electron 的窗口 bounds 与 `screen.getCursorScreenPoint()` 是逻辑坐标；而从 Electron 里 spawn 的
   PowerShell（不同 DPI 感知上下文）用的又是另一套 —— 混用就会"算出来在里面、点下去在别处"。
   做真机鼠标测试前先标定（`probe-dpi.ps1`）。
4. **置顶要保持**：别的置顶窗口一旦被激活（例如"点击图标 → 聚焦 DSH"把浏览器拉起来）会排到同层 z 序更上面，
   把图标压住。所以每 2.5s 重新 `setAlwaysOnTop(false/true,'screen-saver') + moveTop()` 顶回去。
5. **`WindowFromPoint` 会跳过 `WS_EX_TRANSPARENT` 的窗口** —— 这正好让它成为"透明区域是否吃鼠标"
   最直接的客观证据，而且不需要移动光标（本机有别的进程在抢光标，真实鼠标自动化不可复现）。
6. **冻结模式下不要给旋转元素挂恒等 transform**：`rotate(0)` 与"无 transform"的光栅化会差一个次像素，
   在虚线环上会放大成 1%+ 的假差异。冻结抓图时直接 `animation: none`。
7. **不要对 `filter: url(#...)` 做 CSS 关键帧动画**：同一 SVG 根下**其它层**会被带偏到另一个次像素光栅相位
   （实测让 ERROR/SUCCESS 的假差异从 0.07% 涨到 1.5%/1.8%）。WAITING 的呼吸改成"两颗预算好模糊的辉光交叉淡化"。
8. **核心透明度动画要挂在核心的子元素上**：挂在 `.core` 组上会与子元素自带的 `opacity` 相乘（core²）。
9. **索引/直接启动时 stdin 不是管道**：不能把 EOF 当"父进程死了"，否则一启动就自杀（已按 `fstat.isFIFO()` 区分）。
10. 渲染层拿不到 preload 桥时（用普通浏览器打开做像素比对）要退化成空实现；
    但**不能回写 `window.dsh`**（contextBridge 暴露的属性是只读的，回写会让整页白屏）。

---

## 6. 与黄金样本的像素比对

`node tests/compare-golden.mjs`（阈值 16、允许 2%、240px 盒子 @dpr2 = 480×480）：

| 状态 | dark 底差异 | alpha 底（仅参考） |
|---|---|---|
| IDLE | **0.000%** | 61.1% |
| THINKING | **0.055%** | 93.4% |
| WORKING | **0.064%** | 92.5% |
| WAITING | **0.046%** | 93.8% |
| SUCCESS | **0.367%** | 90.5% |
| ERROR | **0.068%** | 92.5% |
| DISCONNECTED | **0.000%** | 27.8% |

* dark 底全部通过（最大 0.367%，平均 0.086%）。
* **alpha 底那一列不能当判定用**：黄金样本的 alpha 图与它自己的 dark 图**不自洽** ——
  把 `ref-*-240-alpha.png` 按预乘合成到 `#111111` 上，与 `ref-*-240-dark.png` 差 22%–45%
  （只有 IDLE/OFF 两态自洽）。本实现的 alpha/dark 一对是 **0.000%** 自洽的（7 态全 0）。
  复现：`node tests/compare-golden.mjs` 的第 2 节，或 `node tests/selfcheck.mjs <alpha> <dark>`。
  这条建议反馈给黄金样本作者：`omitBackground` 那条截图路径把外发光画重了。
