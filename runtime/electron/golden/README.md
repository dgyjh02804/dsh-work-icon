# H2「等离云核」黄金样本 · 使用说明

> 事实来源：`dsh-work-icon/docs/SPEC-H2.md`（第 2/3/4 节）+ `hybrid.html` 的 `<symbol id="base-h2">` 与 `halo()`。
> 颜色 / 半径 / 粒子数逐项照抄，未做任何"优化"。**不要改颜色改几何去让比对通过——改的是实现，不是样本。**

## 文件职责

| 文件 | 职责 |
|---|---|
| `h2-golden.html` | 单状态、可参数化的渲染页（唯一真相）。`?state=&size=&bg=&t=&glow=&plate=&fx=` |
| `h2-demo.html` | 七态并排 + 自动循环的动效演示页（人看用），通过 iframe 复用 `h2-golden.html` |
| `h2render.mjs` | 渲染底座：本地静态服务 + Playwright(msedge) + deviceScaleFactor 控制 |
| `render-refs.mjs` | 一键重跑 `refs/` 全部参考图（含选帧，抗光栅化抖动） |
| `compare-lib.mjs` | 比对内核（像素差、8×8 网格、热力图、alpha 掩膜） |
| `compare.mjs` | 命令行比对工具（自动化入口，退出码 0/1/2） |
| `selftest.mjs` | 自证：比对工具本身是否可信（29 条断言） |
| `reap.mjs` | 收尾清理：杀掉遗留的 Playwright 无头浏览器进程（不碰用户自己的浏览器） |
| `refs/` | 23 张黄金样本 PNG + `manifest.json`（sha256 清单） |
| `tmp/` | 探针与诊断脚本（保留证据用，可随时删） |

## 硬约束：一律 headless

- `h2render.mjs` 里浏览器只用 `chromium.launch({ channel:'msedge', headless: true })`。
  代码里有硬闸门 `assertHeadless()`：**只有**显式设置环境变量 `H2_ALLOW_HEADFUL=1` 才会开可见窗口，
  且会打印醒目警告。**需要真实 GPU 合成等 headless 做不到的事，先问用户，不要自己开这个开关。**
- 每轮测试收尾都要 `node reap.mjs`（`render-refs.mjs` / `selftest.mjs` 已内建自动调用并打印结果）。
- `reap.mjs` 的杀进程特征：命令行含 `--remote-debugging-pipe` 或 `--headless`。
  **不要**用 `--user-data-dir` 当特征——用户自己的 Edge 也有它，会误杀用户的浏览器。
- 已知踩过的坑：用 `spawnSync` 把多行脚本直接喂给 `powershell -Command`，内层引号会被吞，
  `-Filter "... OR ..."` 解析失败会导致收割器**静默地什么都没查**、误报"干净"。
  必须写成临时 `.ps1` 用 `-File` 执行（`reap.mjs` 已如此实现，并在失败时退出码 2 而不是谎报干净）。

## h2-golden.html 参数

| 参数 | 取值 | 说明 |
|---|---|---|
| `state` | IDLE / THINK / WORK / WAIT / OK / ERR / OFF | SPEC 第 4 节七态 |
| `size` | CSS px（默认 240） | 页面尺寸 = 图标尺寸；**物理像素 = size × deviceScaleFactor** |
| `bg` | `none` / `dark`(#111111) / `white`(#ffffff) | `none` = 页面完全透明（导 alpha 用） |
| `t` | 秒（默认 0） | 动画相位。**所有动效都由它决定，与页面加载时刻无关** → 可复现的前提 |
| `glow` | `1`（默认）/ `0` | `0` 关掉状态外发光（`filter: drop-shadow`） |
| `plate` | `1`（默认）/ `0` | `0` 关掉 L1 能量底盘（用于白底对比实验） |
| `fx` | `1`（默认）/ `0` | `0` 关掉 OK 爆闪/扩散环、ERR 抖动、WAIT 呼吸 |

## 比对怎么用

```bash
# 基本（像素阈值 16，允许差异占比 2%）
node compare.mjs refs/ref-WORK-240-dark.png <你的抓图>.png

# 参考图有透明、待测图是原生窗口抓图（无 alpha）—— 自动只比不透明区
node compare.mjs refs/ref-WORK-240-alpha.png shot.png --alpha

# 更干净：无视 alpha<16 的边缘像素（合成器噪声区）
node compare.mjs refs/ref-WORK-240-alpha.png shot.png --alpha --tolerance 16

# 收紧/放宽判定
node compare.mjs refs/ref-WORK-240-dark.png shot.png --max-diff 1.5
```

退出码：`0` 通过 / `1` 超阈值 / `2` 参数或输入错误（不会崩栈）。

### 阈值建议（本机实测依据）

| 场景 | 建议 |
|---|---|
| 原生窗口抓图 vs 深底参考图（同尺寸、同 dpr） | `--max-diff 2`（默认）；颜色/几何错位会到 15–20% |
| 抓图尺寸或 dpr 不一致（会被自动缩放） | `--max-diff 4`——缩放本身就带 6.8% 假差异 |
| alpha 参考图 vs 无 alpha 抓图 | 必须加 `--alpha`，否则透明区会被算成 100% 差异 |
| 只验收"状态对不对" | WORK vs WAIT 实测差 19.7%，WORK vs IDLE 差 22.3%——`--max-diff 5` 即可判定 |

**已知坑**：偶发（约 1/20 次）浏览器会渲染出一帧"外圈低 alpha 带整体差 1–2/255"的
离群帧，占比可达 3%（6800px/230400，半径 229–275px 那圈，即 r≈97 底盘边缘）。
它落在"低 alpha 边缘"上，用 `--alpha --tolerance 16` 可以完全排除；
不带容差时请把 `--max-diff` 放宽到 4，或重抓一张。

## 复现参考图

```bash
node render-refs.mjs                # 5 次连渲取多数派帧
node render-refs.mjs --reps 7       # 更稳（默认档，出报告用的是这一档）
node render-refs.mjs --out refs2    # 换目录
```

`--reps N` 的作用：Chromium 合成器对粒子/辉光的抗锯齿边缘偶发会落到另一个"特征态"
（实测 96px 下最坏 0.37% 像素、240px 下最坏 0.006%）。脚本对每张图连渲 N 次、
挑"离其余帧总差异最小"的那一帧落盘，并打印每张图出现过几种帧态。
