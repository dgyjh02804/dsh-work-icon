# 进度条 / 加载指示器 设计参考对照表

**采集时间**：2026-08（本次会话）
**采集方式**：headless Edge 真实访问各站点页面 → 取页面自身发布的预览图 / 页面实况截图；实物类取自 Wikimedia Commons 原始文件。
**目标尺寸前提**：悬浮条 ≈ 260–360px 宽 × ~20px 高的进度条；展开面板宽 440px，内含多条进度条；主图标 140px 环形。
**总张数**：16 张（`01-` ~ `16-`）。

> 关于"推进时 vs 完成时"一列：直接来自源页面/文件本身的描述我直写；属于我基于该手法做的推演，一律标注 **（推演）**，不要当成源作品的既有行为。

---

## 一、软件 / 网页 UI 参考（可直接抄手法）

| 文件 | 来源作品 · 作者 | 链接 | 可取的技术点（它做对了什么 / 我们能拿它做什么） | 推进时 vs 完成时 | 在我们的尺寸下是否可行 |
|---|---|---|---|---|---|
| `01-segmented-svg-stepper.webp` | **Segmented SVG Progress Loading Bar** · Jon Kantner（MIT）— FreeFrontend 收录 | [freefrontend.com/javascript-progress-bars](https://freefrontend.com/javascript-progress-bars/) | **不画连续条，画"分段 + 节点"**：几个圆形 hub 用直线段相连，推进时用 `stroke-dashoffset` 把连接线"画"出来，到点后 hub 从描边膨胀成实心。一条总进度 = 一串可数单元，用户一眼知道"到第几步了"。→ 正好对应面板里"每个对话一条"，以及悬浮条上的"当前进程数"。 | 推进：连接线用 dash 匀速生长，hub 保持空心描边描边呼吸<br>完成：hub 由空心→实心并外扩一圈（alt 原文描述的是"sequential hub expansions"） | **可行**。360px 宽下切 8–16 段（每段 20–40px）在视觉上最舒服；段间隔 2px 即可，再小会糊成连续条。 |
| `02-perimeter-progress-checkmark.webp` | **SVG Perimeter Progress Upload Button** — FreeFrontend 收录 | [freefrontend.com/javascript-progress-bars](https://freefrontend.com/javascript-progress-bars/) | **进度沿"轮廓周长"走，而不是走直线**：胶囊形按钮的整圈描边当轨道，百分比数字在中间，完成后同一元素直接变成绿色对勾。→ 这是"完成时形态改变"最省事的实现：**不新增元素，只换描边颜色 + 数字换图形**（alt 原文：completing into a green checkmark）。 | 推进：外圈描边按百分比补齐，中间数字跳动<br>完成：描边转绿、数字位置换成对勾，同位置原地切换（推演：通常配 200–300ms 的缩放） | **可行且推荐**。140px 图标外圈就是现成的"周长"；hover 条的 20px 高度里做不出环形，但可以做"条的两端各有一个端点圆点"复用同一套逻辑。 |
| `03-progress-bar-style-kit.webp` | **Semantic Custom Progress Bar Kit** — FreeFrontend 收录 | [freefrontend.com/javascript-progress-bars](https://freefrontend.com/javascript-progress-bars/) | **并排给出 4 种同一数据的风格化方案**：实心橙、紫色渐变、**对角斜纹**、霓虹描边。其中最值得抄的是**对角斜纹**——它用 `repeating-linear-gradient` + 动画 `background-position`，是"持续在动"的**最低成本实现**（GPU 合成层，不重排不重绘内容，且不需要 JS 每帧驱动）。 | 源图只给了静态四态（推演）：斜纹可以用位移速度/方向编码"快 / 慢"，完成时把斜纹停住并切纯色，形成"完工"的静默感 | **可行**，是本次 16 张里性价比最高的一条。斜纹周期 8–10px、每 1.2–2s 平移一个周期 ≈ 视觉"在动"但几乎不吃 CPU。 |
| `04-loading-progress-button.webp` | **Interactive Loading Progress Button** — FreeFrontend 收录 | [freefrontend.com/javascript-progress-bars](https://freefrontend.com/javascript-progress-bars/) | **进度是可交互对象**：按钮上有百分比计数、暂停控件、和沿外轮廓走的动画描边（alt 原文：percentage counter, pause control, and animated SVG outline）。→ 我们的 hover 行已经有"状态文字 + token 数"，可以把 token 数做成**计数滚动**（数字位滚动比进度条本身更"在动"）。 | 推进：描边沿轮廓循环，数字滚动<br>完成：描边闭合，数字定格（推演） | **可行**。数字滚动在 12–13px 字级下是低成本的"活着"信号；暂停控件在这个产品里不必做（无意义）。 |
| `05-glassmorphic-gel-meters.webp` | **Glossy Glassmorphic Native Progress Meters** · Simey（MIT）— FreeFrontend 收录 | [freefrontend.com/css-progress-bars](https://freefrontend.com/css-progress-bars/) | **"凝胶感"用内阴影 + 径向高光 + oklch 渐变**堆出来，而不是靠模糊背景；同时它自带 **indeterminate（不确定总量）连续动画**（alt 原文 + 页面描述：indeterminate loading animations、oklch gradients、radial lighting masks）。→ 这直接回答我们的老问题：**"总量未知"时不该假装知道百分比，而应切到连续流动态**——正是"一直在动"的正解。 | 推进：填充体内部有横向流动的高光<br>完成：填充停住、高光衰减（推演） | **手法可行，材质不可行**。`backdrop-filter`/大面积 blur 在"透明置顶窗口浮在任意壁纸"上每帧都要重采样桌面背景，代价高——改成**静态渐变 + 内部高光用 transform 平移**，观感八成、成本一成。 |
| `06-scifi-triangle-loader.webp` | **Sci-Fi Glowing Triangle Loader** · Shane Burns（MIT）— FreeFrontend 收录 | [freefrontend.com/css-sci-fi-style](https://freefrontend.com/css-sci-fi-style/) | **科幻感的来源是"结构 + 描边 + 单点高亮"，不是模糊**：暗底、霓虹白描边几何路径、3 个光点沿路径行进（alt 原文）。元素极少但方向感极强。→ 我们的等离子核心可以直接沿用：**几何路径 + 少量沿路径运动的光点**，比整块发光便宜得多。 | 推进：光点沿边循环行进<br>完成：三光点汇聚到顶点并闪一次（推演） | **可行**。但要避开 `filter: drop-shadow` 逐帧重绘——把光晕**预渲染成一张贴图**，用 `transform` + `opacity` 驱动，成本接近零。 |
| `07-cyberpunk-upgrade-modal.webp` | **Cyberpunk Glitch Upgrade Modal** — FreeFrontend 收录 | [freefrontend.com/css-sci-fi-style](https://freefrontend.com/css-sci-fi-style/) | **面板的科幻"装帧"语法**：发光边框 + 斜切角（不等宽边框）+ 扫描/故障文字（alt 原文：glowing border, sharp angled corners, glitching text effect）。→ 直接可用于 440px 展开面板的外框，让面板和图标是同一套语言。 | 源图为静态（推演）：glitch 只应该在**"完成 / 出错"那一刻闪 150ms**，常驻故障闪烁会很累而且是性能陷阱 | **可行**（斜切角 + 描边 + 角标都是静态成本）。**不推荐**常驻 glitch。 |
| `08-cpu-circuit-loader.webp` | **Animated CPU Circuit Loader** — FreeFrontend 收录 | [freefrontend.com/css-loaders](https://freefrontend.com/css-loaders/) | **用"线路上的能量流动"表达处理中**：中心芯片 + 多条彩色线路依次点亮，模拟数据流（alt 原文）。→ 这是和我们图标（"等离子核心"）**语义最贴**的一条：核心不动，**能量从边缘向核心汇入**。把"线路"降级替换成"格子"就是我们需要的分段进度条。 | 推进：光点沿线由外向内跑<br>完成：所有线路同时亮满一次然后回落（推演） | **小尺寸下要把线路换成格子**。20px 高的条里画不出可辨认的电路；只保留"多个离散单元按顺序点亮"这一层，1 单元 ≈ 12–20px。 |
| `09-css-loaders-progress-collection.png` | **The Progress CSS Loaders Collection** · css-loaders.com（Temani Afif） | [css-loaders.com/progress](https://css-loaders.com/progress/) | **一整个"单元素纯 CSS 进度 loader"库**：站方自述"600+ CSS-only loaders made using a single element"，即**每个 loader 只有一个 div、零 JS、零图片**。→ 要找"低成本持续动效"，这里可以直接抄到可用实现，而不是只抄观感。 | 多为不变量循环（indeterminate）；完成态通常直接隐藏 loader 换成内容 | **可行**。单元素 = 单图层合成，是"空闲不做无限动画"约定下**唯一可以例外允许常驻**的那一类：只有 `transform`/`background-position` 在变化。 |
| `10-css-loaders-infinity-collection.png` | **The Infinity CSS Loaders Collection** · css-loaders.com | [css-loaders.com/infinity](https://css-loaders.com/infinity/)（由 `/ring/` 跳转） | 页面自带源码，可逐字验证：`repeating-linear-gradient(90deg,#000 0 calc(25% - 5px),#0000 0 25%) left/calc(4*100%/3) 100%` + `@keyframes { 100% { background-position: right } }`——**"分段格子 + 一直行进"就是用一条渐变和一条 keyframes 做出来的**，没有 JS、没有逐帧重绘。 | 推进：条纹持续行进（可变速编码快/慢）<br>完成：条纹停下 → 整条闪一次 → 收成实心（推演） | **完全可行，强烈推荐作为悬浮条基础动效**。`background-position` 动画走合成层，是明文可查的最低成本方案。 |

---

## 二、"完成"/里程碑反馈专属参考

| 文件 | 来源作品 · 作者 | 链接 | 可取的技术点 | 推进时 vs 完成时 | 可行性 |
|---|---|---|---|---|---|
| `02-perimeter-progress-checkmark.webp` | 同上一节的 #02，单独列出因为它是**唯一明确给出"完成态形态变化"**的样本 | [freefrontend.com/javascript-progress-bars](https://freefrontend.com/javascript-progress-bars/) | **完成 = 轨道自身变成结果**（描边补齐 → 转绿 → 变成对勾）。不是"再加一个庆祝动画"，而是**同一个元素换一个形态**。→ 对用户"完成一项任务动得不一样/更剧烈"的要求，这是最克制也最可靠的做法；"更剧烈"放在**百分之一秒级的整条闪光**上，而不是持续很久的粒子。 | 见上一节 | 可行 |
| `12-lcd-bargraph.jpg` | **LCD Bargraph reflective + backlit** · Wikimedia Commons | [File:LCD Bargraph reflective + backlit.jpg](https://commons.wikimedia.org/wiki/File:LCD_Bargraph_reflective_%2B_backlit.jpg) | **现实世界的分段进度指示器的原始形态**：一段一段的液晶格子，每格只有"亮 / 不亮"两态。它证明了**离散格子在极小的物理尺寸下依然可读**——这正是我们 20px 高悬浮条需要的东西，而连续细条在 20px 高时反而容易看不出变化。 | 源为静态实物照片（推演）：格子逐格点亮=推进；全部点亮并反色闪一下=完成 | 可行（分段方案的最强论据） |

---

## 三、真实世界 / 非屏幕参考（仪表、刻度、行程）

| 文件 | 来源作品 | 链接 | 可取的技术点 | 推进时 vs 完成时 | 可行性 |
|---|---|---|---|---|---|
| `11-bullet-graph.png` | **HKPF used bullet graph**（子弹图实例）· Wikimedia Commons | [File:HKPF used bullet graph.png](https://commons.wikimedia.org/wiki/File:HKPF_used_bullet_graph.png) | **子弹图 = 三层信息压进一条细条**：定性区间底色（差/中/好）+ 实际值实心条 + 目标值竖线标记。→ 我们的 token 进度天然有这三层：**已用 / 预算区间 / 上限或目标**。一条 20px 的条能同时表达"我在哪、我还剩多少、到哪儿算超支"。 | 源为静态图表（推演）：实心条推进=消耗；目标竖线被越过时可变色告警 | 可行，且是"总进度条"信息密度最高的方案 |
| `13-mercury-thermometer.jpg` | **Mercury Thermometer** · Wikimedia Commons | [File:Mercury Thermometer.jpg](https://commons.wikimedia.org/wiki/File:Mercury_Thermometer.jpg) | **刻度（离散）+ 液柱（连续）叠加**：读数靠液柱的连续高度，精度靠刻度的离散格子。→ 直接解答"要连续条还是分段条"：**两者都要**——底色是连续填充（廉价、平滑），上面叠一层等距刻度线（提供"格"的节奏感）。 | 源为静态实物照片 | 可行（刻度线是静态的，零成本） |
| `14-vu-meter.jpg` | **Technics RS-612US (Vu-Meter)** · Wikimedia Commons | [File:Technics RS-612US (Vu-Meter).jpg](https://commons.wikimedia.org/wiki/File:Technics_RS-612US_(Vu-Meter).jpg) | **指针表头的两个精髓**：① 刻度从绿→黄→红按区间变色（阈值语义）；② 表头有**峰值保持**（peak hold）——指针冲顶后会留一个标记。→ 峰值保持可以搬来做**里程碑标记**：子代理完成时在总进度条上留一个短竖线，比弹一次动画更持久、更不需要动画预算。 | 源为静态实物照片（推演）：指针随信号抖动=推进中的"活着"；冲顶留标记=完成一次任务 | 可行，且**几乎零成本**（留下一个静态标记 DOM 节点） |
| `15-aircraft-hud.jpg` | **C-130J Co-Pilot's Head-up display** · Wikimedia Commons | [File:C-130J Co-Pilot's Head-up display.jpg](https://commons.wikimedia.org/wiki/File:C-130J_Co_Pilot%27s_Head-up_display.jpg) | **真实 HUD 的"浮在任意背景上"的解法**：单色高亮 + 描边式字形 + 尺度带（scale tape），**不用背景填充块**，所以叠在天空/地面/座舱上都读得清。→ 这正好命中我们的核心约束——**面板浮在任意壁纸上，背景不可控**。结论：不要用大面积半透明底板去"盖住"壁纸，而要用**描边 + 单色 + 刻度带**在任意背景上自证可读。 | 源为静态照片 | 可行（这是解决"背景不可控"最有说服力的一条参考） |
| `16-moto-digital-meter.jpg` | **SYM SR125i digital meter**（摩托车数字仪表）· Wikimedia Commons | [File:Hezery99-SYM SR125i digital meter.jpg](https://commons.wikimedia.org/wiki/File:Hezery99-SYM_SR125i_digital_meter.jpg) | **小到极致时用什么**：LCD 上的分段条 + 大字号数字并存，图形只给"大概到哪了"，数字给精确值。→ 我们的悬浮行正好是"状态文字 + token 数 + 一条总进度条 + 进程数"，可以照这个分工：**进度条负责"动"，数字负责"准"**。 | 源为静态实物照片 | 可行 |

---

## 四、15 秒速查：如果只挑 5 个手法

1. **分段格子 + `repeating-linear-gradient` 行进**（`10-`）→ 悬浮条的常驻"一直在动"，零 JS、零重绘。
2. **完成 = 轨道自身变形态，而非加庆祝动画**（`02-`）→ 满足"完成时不一样"，且不引入常驻动画预算。
3. **环上跑光点 + 线只走描边**（`06-`）→ 140px 图标本体的动态语言，与已有"等离子核心"同构。
4. **子弹图三层压制**（`11-`）→ 让"总进度条"一条线同时说清已用 / 预算 / 上限。
5. **HUD 的"描边而非底板"**（`15-`）→ 解决"浮在任意壁纸、背景不可控"的唯一可靠解法。

---

## 五、本次没能拿到的来源（站点限制，已换源，未硬撞）

| 站点 | 结果 | 处理 |
|---|---|---|
| **loading.io**（HUD spinner 分类页） | Cloudflare 拦截（"Sorry, you have been blocked"） | 放弃，改用 css-loaders.com + FreeFrontend |
| **uiverse.io**（elements 搜索页） | Cloudflare 拦截 | 放弃 |
| **CodePen**（`codepen.io/Ashlook/pen/OJgvxbE` 科幻进度条） | 触发"正在进行安全验证"人机校验 | 放弃，未做任何绕过 |
| **Dribbble / Behance** | 未尝试直接抓取（已知有登录墙/反爬，避免无效请求） | 未纳入 |
| **Apache ECharts** 仪表盘示例页 | 页面本身打开成功，但截图内容以编辑器 UI 为主、图形占比过小（非空白但不足以当参考图） | 已采集但未收进对照表 |
| **canvas-confetti** 演示页 | 页面打开 + 点击 Run 成功、截图已存，但全页截图高 6409px，无法在不做裁剪验证的情况下确认粒子帧是否被捕到 | 未收进对照表（下方"完成反馈"改由 `02-` 承担） |
| **NProgress / SpinKit / Material 3** | 页面均可访问，但截图以页面文字/极细条为主，作为"参考图"信息量不足 | 未收进对照表 |

---

## 六、技术备注：为什么这些手法符合"空闲不做无限动画"

- **只动 `transform` / `opacity` / `background-position`**：走合成层，不触发布局（layout）与重绘（paint），是浏览器里唯一可以长期常驻的动画类型。`10-`、`06-`、`03-` 都属此类。
- **避免**：`filter: blur` / `drop-shadow` 逐帧变化、`backdrop-filter`、`width`/`height`/`box-shadow` 动画——这些每帧都要重算像素，正是"透明置顶窗口 + 任意壁纸"场景里最贵的操作（也是 `05-` 只能取手法不能取材质的原因）。
- **状态机降级**：空闲 → 完全静止（零动画）；有任务 → 分段行进（极低成本）；完成 → 一次性 150–400ms 闪光/形态切换（成本一次性，且能自然结束）；错误 → 静态警示色 + 一次抖动。这样"一直在动"只发生在**真的有任务在跑的时候**，与"空闲不做无限动画"的既有约定不冲突。
