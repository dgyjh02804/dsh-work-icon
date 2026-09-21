# dsh-work-icon · 等离云核

给 DeepSeek Harness（DSH）做的**桌面工作状态悬浮图标**：常驻屏幕的科幻风格置顶窗，实时反映当前会话在做什么。

> **平台：仅 Windows。** 逐像素透明与圆外点击穿透走的是 Win32 窗口样式（`SetWindowLong`），`runtime/electron/` 下的 `win-exstyle.ps1` / `win-probe.ps1` / `win-state.ps1` / `focus-dsh.ps1` 也都是 Windows 专用。**macOS / Linux 没有适配，也没有验证过。**

## 它解决什么问题

跑长任务时，DSH 的真实状态（在想、在调工具、在等你批准、还是已经断了）只存在于那个网页界面里 —— 一切到别的窗口就完全看不见，只能反复切回去确认它到底还在不在干活。

这个图标把宿主的**事件流归约成一个常驻桌面的小窗**，让你**不切窗口就知道它现在什么状态**：在转 = 在想，换色 = 换了活动类型，进度环 = 计划推到哪了，一收一爆 = 这一轮结束了。

设计方向是「**中等密度 + 在跑数据**」—— 看起来在跑数据不靠堆元素，而靠微读数、材质与动效。

![等离云核：三角形核心 + 轨道进度环](docs/ring-proto-gen/shot-ring-v2-done.png)

> 上图取自 `docs/ring-proto-gen/` 的**设计稿渲染**（不是产品截图）。视觉规格冻结在 [`docs/SPEC-H2.md`](docs/SPEC-H2.md)，DSH 事件契约冻结在 [`docs/DSH-EVENT-CONTRACT.md`](docs/DSH-EVENT-CONTRACT.md)。

## 它是什么

一个 **Electron 原生置顶窗**（逐像素透明、圆外点击穿透、位置记忆），由 DSH 宿主插件零参数 spawn，常驻桌面。

**最小用法**：装好之后桌面右下角常驻一个小图标，就这些操作 ——

- **双击图标** ⇒ 展开 / 收起信息面板
- **右键图标** ⇒ 尺寸 · 透明度 · 流畅度 · 始终置顶 · 鼠标穿透 · 跟随子代理 · 配色设置 · 退出
- **拖动图标** ⇒ 换位置（松手即记住，下次还在原地）

其余不用管 —— 它自己跟着当前会话走，不需要你喂任何参数。它的能力：

- **七态**：`IDLE` / `THINKING` / `WORKING` / `WAITING` / `SUCCESS` / `ERROR` / `DISCONNECTED` —— 随主线程的真实工作状态实时变色
- **活动类型**：`searching` / `editing` / `testing` / `commanding`
- **进度环（ORBITAL）**：套在图标外面的轨道环，环上承载计划完成度
  - 没有计划 ⇒ **不画环**（不画 0%、不写"不适用"）
  - 多个对话 ⇒ 取**聚合总进度**
  - 计划回归 ⇒ **允许倒退，但要在悬浮层写明原因**
  - 完成瞬间 ⇒ **先收束、再爆散**
- **信息面板**（双击图标展开，或右键选显示模式）：会话 · 计划 · 主代理/子代理树 · 任务 · 花费 · 上下文占用 · 思考/工具文本
- **三档资源剖面**：`省电` / `标准` / `流畅`（省电档空闲时完全静止）
- **右键菜单**：尺寸 · 透明度 · 流畅度 · 始终置顶 · 鼠标穿透 · 跟随子代理 · 退出

## 数据从哪来

全部来自 DSH 自身的事件流，**不外发、不联网**：

| 数据 | 来源 |
|---|---|
| 工作状态 | `session/event`（`turn/start`、`step/start`、`assistant/chunk`、`tool/call`、`tool/result`、`approval/*`、`turn/end`、`todo/write`） |
| 计划进度 | `todo/tree` 叶节点 / `todo/write` 条目 |
| 花费 | 与 DSH 底栏同一本账（`dsh-bottom-info-bar` 的用量账本，只读） |
| 子代理 | `subagent/start` · `subagent/end` · 官方枚举 `listDescendants()` 补名字 |
| 思考/文本 | `reasoning-delta` 流式碎片 + 落定块 |

## 安装

### 0. 前置要求

| 要求 | 说明 |
|---|---|
| **Windows** | 见开头的平台声明 —— 只有 Windows 能跑 |
| **Node.js ≥ 22** | `package.json` 的 `engines` 是 `"node": ">=22"`，宿主侧（`src/`）在这上面跑 |
| **Electron 44.3.0** | `runtime/electron/node_modules/` **不入库**（380 MB / 562 文件），**必须自己装一次**，见下一步 |

### 1. 先装窗口侧依赖 —— **最容易漏的一步**

`runtime/electron/node_modules/` 被 `.gitignore` 挡住了 ⇒ **全新 clone 下来是没有 Electron 的**，跳过这步图标根本起不来：

```bash
cd runtime/electron
npm install                 # 首次会下载 Electron 44.3.0
```

- 网络慢可以换镜像：`npm install --registry https://registry.npmmirror.com`
- 自检：`runtime/electron/node_modules/electron/dist/electron.exe` 应存在（宿主找的就是它）

### 2. 挂进你正在跑的 profile

插件与你正在运行的 DSH profile 分离，用 `file:` 依赖挂进去：

```bash
dsh plugin --profile web add file:C:/path/to/dsh-work-icon
```

- `--profile web` 里的 `web` 是 **profile 名**，对应目录 `~/.dsh/profiles/web`（Windows 上即 `C:\Users\<你>\.dsh\profiles\web`）。
- **不知道自己的 profile 名**：看 `~/.dsh/profiles/` 下有哪些目录，**目录名就是 profile 名**；正在跑的那个通常是最近被写过的。

### 3. 让它成为 bundle

装完还要把这个包登记进 profile 的 composition，**改的是这个文件**：

```
~/.dsh/profiles/web/package.json        ← 里面的 dsh.profile.bundles 数组
```

把包名加进去：

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "dsh-work-icon"
      ]
    }
  }
}
```

> ⚠️ **已知坑**：用国内镜像（`registry.npmmirror.com`）时 `pnpm` 会因为 `allowBuilds` 返回非零，此时 `dsh plugin add` **不会自动登记 bundle** —— 那就是"手工往 `dsh.profile.bundles` 里加包名"的场景，**不代表装失败**。

### 4. 重启，并且刷新页面

重启 `dsh web` 之后，**还要刷新浏览器里的 Web 页面**（`Ctrl+R` / `F5`）。只重启不刷新，页面仍是旧的。

### 5. 怎么确认装成功了

- **桌面右下角**出现一个青绿色三角形小图标，外面套一圈轨道环
- 图标在转、颜色随会话状态变 ⇒ 宿主 → 窗口的数据通了
- **双击**能展开信息面板 ⇒ 跨侧 stdio 协议通了

图标没出现时按这个顺序查：① `runtime/electron/node_modules/electron/dist/electron.exe` 在不在（第 1 步）② `dsh.profile.bundles` 里有没有包名（第 3 步）③ 页面刷新过没有（第 4 步）。

### 首次运行注意

- 第一次拉起会新建一个 Electron 窗口，**可能要几秒**才渲染出来，不是没启动
- Electron 首次运行可能被**安全软件 / 防火墙拦截**（它会起本地进程）；被拦就放行
- 窗口默认**始终置顶且不抢焦点**（圆外点击穿透），不想要了右键选**退出**

### 卸载

```bash
dsh plugin --profile web remove dsh-work-icon
```

然后从 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里**删掉包名**，再重启 `dsh web`。

用户级配置**不在 profile 里**，而在 `~/.dsh/work-icon/`（`config.json` = 位置/尺寸/透明度等，`theme.json` = 配色），要一起清干净就手动删这个目录。

> 本插件自带 [`cordis.patch.yml`](cordis.patch.yml)，安装时会把宿主侧插件行插进 composition。

## 结构

```
src/                    宿主侧（Node + Cordis）—— 事件归约 + 进程桥 + 协议
  protocol.js             换行分隔 JSON 协议（唯一的跨侧真相源）
  reducer.js              7 态归约 + v2 字段（progress/metrics/subagents/sessions/context/todos/cost）
  bridge.js               子进程桥：spawn / 心跳 / 静默看门狗 / 事件循环滞后探针
  config.js               配置读写（只落用户改过的键）
  diag.js                 诊断留痕
runtime/electron/       窗口侧（Electron）—— 常驻置顶窗与全部渲染
  main.js                 窗口、几何、点击穿透、菜单、配置
  index.html              渲染层：图标 + 进度环 + 悬浮层 + 信息面板
  tests/                  窗口套件（`run-all.mjs` 一条命令跑全部 23 条）
docs/                   视觉规格 · 事件契约 · 参考对照表 · 各轮设计稿与动效原型
test/                   宿主侧单元测试
```

## 测试

```bash
npm test                                        # 宿主侧（node --test）
node runtime/electron/tests/run-all.mjs         # 窗口侧 23 条套件
```

窗口侧还有 3 条**真窗口**套件（性能 / DWM 合成 / 生产路径存活），默认不跑，要跑加 `--with-shown`：

```bash
node runtime/electron/tests/run-all.mjs --with-shown
```

窗口套件默认**离屏**运行（不弹窗、不抢焦点）；必须真窗口的验证单次 ≤20 秒、放屏幕角落、测完即清。

## License

[MIT](LICENSE)
