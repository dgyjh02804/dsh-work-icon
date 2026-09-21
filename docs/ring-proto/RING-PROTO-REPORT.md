# ring-proto · 验证证据留档

> 生成方式：`node docs/ring-proto-gen/gen.mjs` → 写出 `docs/ring-proto/*.html`
> 验证方式：`node docs/ring-proto-gen/verify.mjs` / `idlecheck.mjs` / `smoke.mjs` / `audit.mjs`
> 全部离屏无头 Edge（`headless: true`），无弹窗，无输入合成，不碰用户进程。

## 0. 资产来源与漂移核对

- 几何资产 `<g id="base-h2">` 与七态配色 `.st-*` **只读复制**自
  `runtime/electron/index.html`（我在 21:10 前读的那一版，base-h2 原文长度 1318 字符）。
- **漂移核对**（`driftcheck.mjs`，在交付前重跑）：当前 runtime 里
  `base-h2` 七层几何**逐字未变**（plate r=97 / tick r=94 dash 1.5 7 / cloud / seg r=60 dash "40 16 8 16" /
  inner r=48 / glowA r=44 / burst r=34 / core 三角+圆），七个 `.st-*` 的 `--c1/--c2/--core` **也逐项一致**。
  ⇒ 原型里看到的形状与颜色就是产品当前的形状与颜色。
- 同时段 `runtime/electron/index.html` 确实被另一位成员在改（文件从 78,972 B 长到 82,718 B），
  但改动不落在本原型抽取的那两块资产上。

## 1. 真动效（不用两帧像素差）

`node verify.mjs` → `verify-report.json` 的 `live` 段：

```
v1  ticks [1,35,52]  incr:true | p [0, 0.3632, 0.5338]  advanced:true | jserr_empty:true
    runTf  matrix(-0.6529,0.7575,-0.7575,-0.6529,0,0)  ->  matrix(-0.9775,-0.2110,0.2110,-0.9775,0,0)   changing:true
    dash   136.93 240.06   changing:true   state advance
v2  ticks [1,36,53]  incr:true | p [0, 0.3586, 0.5314]  advanced:true | jserr_empty:true
    runTf  matrix(-0.6305,0.7762,-0.7762,-0.6305,0,0)  ->  matrix(-0.9806,-0.1959,0.1959,-0.9806,0,0)   changing:true
    dash   198.27 354.65   changing:true   state advance
```

四条独立证据：
1. **tick 探针递增**（1 → 35/36 → 52/53）
2. **`#jserr` 为空**（整轮无未捕获错误；`smoke.mjs` 另报 `pageerror/console.error` 均为 none）
3. **主元素 computed transform 逐帧变化** —— v1 是 `.prun` 运行体；v2 另有 `.cloud` 与 `.seg` 自转
4. **环填充 `stroke-dasharray` 随进度变化**（不是只有动画在跑、进度却不动）

## 2. 三档行为真的不同（tick 实测）

```
v1  eco       ticks_delta_3s=12   expected_fps=4
    standard  ticks_delta_3s=40   expected_fps=15
    smooth    ticks_delta_3s=80   expected_fps=30
v2  eco       ticks_delta_3s=12
    standard  ticks_delta_3s=40
    smooth    ticks_delta_3s=76
```

空闲（静止呼吸）态 `idlecheck.mjs`（把进度钉死在 rest，等 2500ms 再比）：

| 版本 | 档位 | 云核自转 | 现有弧自转 | 呼吸(glowA/core opacity) | 环是否画 |
|---|---|---|---|---|---|
| v1 | 省电 | **冻结** | **冻结** | 不变 0.039/0.620 | 不画(opacity 0) |
| v1 | 标准 | — (v1 无自转弧) | **冻结**（已变成进度） | 0.130→0.128 / 1.000→0.992 在变 | 不画 |
| v1 | 流畅 | — | **冻结** | 0.130→0.129 / 1.000→0.997 在变 | 不画 |
| v2 | 省电 | **冻结** | **冻结** | 不变 0.039/0.620 | 不画 |
| v2 | 标准 | **在转** | **在转** | 0.130→0.128 / 1.000→0.990 在变 | 不画 |
| v2 | 流畅 | **在转** | **在转** | 0.130→0.129 / 1.000→0.996 在变 | 不画 |

⇒ 「**省电档空闲时必须完全静止**」= 省电档云核/弧全冻结、呼吸关闭、环不画、tick 仍按 4fps 记时但**没有任何视觉变化**。

## 3. 静态合规

`verify.mjs` 的 `static` 段（对**全部元素**的 computed style 做全量扫描）：

```
v1  animated_properties:["opacity"]  forbidden_computed:[]  forbidden_count:0
    @keyframes:0  running_css_animations:0  feGaussianBlur_in_dom:0
v2  同上
```

- 无 `backdrop-filter`、无 `filter`（含 blur）、无 `box-shadow`（computed 命中 0 处）
- **`@keyframes` 数量为 0** —— 全部由 JS 逐帧驱动（与 runtime 的纪律一致：不留无限 CSS 动画，避免合成器按刷新率常跑）
- 元素规模：每层 132（v1）/ 134（v2）个图元，同时可见 2 枚图标 → 264 / 268 个在画

## 4. 三档 CPU 实测（单核占比）

口径：本机 20 逻辑核；CDP `Performance.getMetrics` 的 `TaskDuration ÷ 采样时长`；
**无头 Edge、1260×1000 视口、单页同时渲染 2 枚图标、每格 12 s、3 次取中位数**。

| 组合 | 空闲(rest) | 推进中 | 完成 | 三次实测 |
|---|---|---|---|---|
| v1 / 省电 | 1.66% | 1.78% | 1.79% | 1.80/1.66/1.64 ｜ 1.62/1.78/1.82 ｜ 1.86/1.77/1.79 |
| v1 / 标准 | 5.19% | 4.17% | 4.27% | 5.51/5.19/5.08 ｜ 4.18/4.08/4.17 ｜ 4.27/4.31/4.22 |
| v1 / 流畅 | 5.86% | 5.27% | 5.19% | 5.86/5.99/5.86 ｜ 5.12/5.27/5.32 ｜ 4.90/5.24/5.19 |
| v2 / 省电 | 1.75% | 1.77% | 1.78% | 1.75/1.80/1.74 ｜ 1.77/1.78/1.74 ｜ 1.78/1.72/1.78 |
| v2 / 标准 | 5.57% | 6.23% | 6.61% | 5.57/5.71/5.57 ｜ 6.33/6.23/6.01 ｜ 6.63/6.37/6.61 |
| v2 / 流畅 | 6.84% | 14.56% ⚠ | 8.31% | 6.23/6.84/7.26 ｜ 14.56/15.72/8.60 ｜ 10.88/8.03/8.31 |
| **基线：暂停（整页静止）** | **0.02%** | — | — | 0.01 / 0.02 / 0.02 |

- ⚠ v2/流畅/推进那一格三次是 14.56 / 15.72 / 8.60 —— 机器负载尖峰，**不要当真实成本**；同档同方案的"完成"格是 8.31。
- 成本结构：`script` 各档只有 30~260 ms，而 `layout` 有 33~288 ms、`recalcStyle` 5~87 ms
  ⇒ **瓶颈在布局/样式重算与光栅化，不在 JS**。
- 真实产品里只有 1 枚图标（本原型为了对照同时放 2 枚）⇒ 上述数字可近似减半。

## 5. 复现命令

```powershell
cd C:\Users\david\.dsh\local-plugins\dsh-work-icon\docs\ring-proto-gen
node gen.mjs          # 生成三页
node audit.mjs        # 编码/定义/合规静态审计
node smoke.mjs        # 两页无错误 + 关键值抽样
node idlecheck.mjs    # 空闲三档：自转/呼吸/环是否画
node verify.mjs       # live + tiers + static + CPU，写 verify-report.json
node summarize.mjs    # 打印上面这些表的汇总
node driftcheck.mjs   # 与 runtime 的资产漂移核对
```
