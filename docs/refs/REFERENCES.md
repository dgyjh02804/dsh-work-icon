# 科幻 FUI 参考对照表

给「科幻等离子核心」桌面悬浮控件的信息面板（宽 210–320px、高 ≤220px、浮在任意壁纸上）挑的 **16 张真实参考图**。

面板要显示：① 一行当前动作 ② 一段持续增长、要有跳动感的思考文本 ③ 一个金额数字 ④ 一个带完成/进行中状态的任务列表。

---

## 一、方法与证据分级（先读这段）

**图是真的。** 全部 16 张从真实站点抓取到本目录，没有一张是凭印象生成或凭印象描述的。主来源是 **HUDS+GUIS（hudsandguis.com）**——专门按作品/工作室建档的影视 FUI 资料站；另有 **Territory Studio 官网作品页**。所有链接都做过 HTTP 状态校验，全部可达。

每一条「技术点」都标注了它的证据来源，分三级：

| 标记 | 含义 | 可信度 |
|---|---|---|
| **视觉核验** | 由独立的视觉分析流程真正看过这张图后给出的描述，并给出「280px 下是否可读」的判定 | 最强 |
| **来源文档** | 来自资料页里设计方/资料站自己写的设计说明（已引原文） | 强（讲的是设计意图，不是这一张的具体像素） |
| **实测像素** | 本机对图片做的离线统计（近黑占比 / 平均饱和度 / 边缘密度 / 主色），可复核 | 强（客观测量，但不描述内容） |

几条必须说清的事：

- **视觉核验只覆盖了 15 张候选，本表 16 张里有 11 张拿到了核验结论。**覆盖不到的原因是视觉模型后端本轮被限流（所有后端 429）。剩余 5 张（#12–#16 中的部分）我**没有**编造任何看图描述，只用了「来源文档 + 实测像素」两类可核验证据，并已在表中标为「证据较弱」。
- **「可读性」是核验给出的独立判定，不是我的推测。**它带来的最有价值的结论是**负面**的：有 4 张图的手法很好、但画面本身在 280px 下会崩。我把它们留在表里，因为「知道什么会死」比多一张好看的图更值钱。
- **边缘密度**是我自定义的代理指标：灰度图上相邻像素亮差的平均值，越高代表细节越密。用来比较「这张到底有多密」，不等于「这张好不好」。
- 原始核验记录留在 `_vision-notes.md`，包含每个文件的逐条判定，可复核。

---

## 二、对照表

| # | 文件名 | 来源作品 / 作者 / 公司 | 原始链接 | 可取的技术点 | 适用性评估（210–320px + 任意壁纸） | 证据 | 实测（本机像素统计） |
|---|---|---|---|---|---|---|---|
| 1 | `blade-runner-2049-analysis-console-01.jpg` | 《Blade Runner 2049》— 科研分析台 — Territory Studio | [资料页](https://www.hudsandguis.com/home/2018/blade-runner-2049)<br>[原始出处](https://territorystudio.com/project/blade-runner-2049/) | 等宽数字块硬贴在画面最左边缘，靠四角暗角收束视线——数字不必居中，贴边反而扫读更快。 | **数字呈现** — 金额列左对齐贴边，比居中更省宽度、扫读更快。视觉核验：280px 下仍可读。 | 视觉核验(可读) | 边缘密度 19.6、平均饱和 22.7 |
| 2 | `star-citizen-mobiglas-overlay-02.png` | 《Star Citizen》— mobiGlas 个人 HUD — Cloud Imperium Games | [资料页](https://www.hudsandguis.com/home/star-citizen-revisited-part-1)<br>[原始出处](https://robertsspaceindustries.com) | 半透明深色底板 + 清晰分区网格；粗体无衬线标题配更小的明细行。核验结论：压住任意背景靠的是“把底板压得足够深”，不是挑强调色。 | **整体气质 / 数字呈现** — 16 张里唯一直接演示“半透明信息板浮在场景上”的参考，而且它本身就在显示财务数字——与我们的金额行同构。视觉核验：可读。 | 视觉核验(可读) | 47.7% 近黑、边缘密度 20.3 |
| 3 | `blade-runner-2049-database-columns-03.jpg` | 《Blade Runner 2049》— 数据解密 / 基因序列查看器 — Territory Studio | [资料页](https://www.hudsandguis.com/home/2018/blade-runner-2049)<br>[原始出处](https://territorystudio.com/project/blade-runner-2049/) | 等宽字符列 + 统一行距。核验原话：“统一的字符节奏能在没有语义的情况下暗示密度”——行距列位一致时，字看不清也依然读起来像一张表。 | **任务列表** — 完成/进行中可以直接挂在“列位 + 行节奏”上，不必依赖文字本身——这在小尺寸下等于白送一档信息层级。视觉核验：可读。 | 视觉核验(可读) | 边缘密度 29.5、37% 近黑 |
| 4 | `the-expanse-agatha-king-panel-04.jpg` | 《The Expanse》— Agatha King 号控制面板 — Rhys Yorke | [资料页](https://www.hudsandguis.com/home/2021/theexpanse)<br>[原始出处](https://rhysyorke.com/) | 蓝字黑底，约 2px 的粗边框把面板切成均等区块，关键指标用大号无衬线数字，区块间距均匀。 | **数字呈现 / 任务列表** — 区块化做法。视觉核验：可读——高对比 + 粗字能扛住缩小；反过来细字方案会先死。 | 视觉核验(可读) | 62.2% 近黑、平均饱和 52.6 |
| 5 | `the-expanse-rocinante-panels-05.jpg` | 《The Expanse》— Rocinante 号走廊壁挂面板 — Rhys Yorke | [资料页](https://www.hudsandguis.com/home/2021/theexpanse)<br>[原始出处](https://rhysyorke.com/) | 单色 + 恰好一处红色强调；粗体无衬线数字竖排堆叠以求紧凑。 | **数字呈现 / 任务列表** — 视觉核验：可读——“单色 + 一处高亮”在极限缩放下比多色方案活得久（呼应 #1 的 0 饱和色相族）。竖排数字也是 210px 宽下省水平空间的一个选项。 | 视觉核验(可读) | 49.4% 近黑、平均饱和 51.6、边缘密度 34.3 |
| 6 | `the-expanse-behemoth-command-06.jpg` | 《The Expanse》— Behemoth 号指挥中心 — Rhys Yorke | [资料页](https://www.hudsandguis.com/home/2021/theexpanse)<br>[原始出处](https://rhysyorke.com/) | 关键/实时数据用边框脉冲标记，其余区块保持静态；深底 + 充足留白，靠“呼吸”而不是靠换色抢注意力。 | **动效 / 思考文本** — 这是 16 张里唯一给出脉动具体做法的参考——让边框呼吸，而不是让文字抖动（文字抖在小尺寸下会直接毁掉可读性）。视觉核验：可读。 | 视觉核验(可读) | 30.9% 近黑、边缘密度 32 |
| 7 | `blade-runner-2049-lapd-scan-07.jpg` | 《Blade Runner 2049》— LAPD 热成像/X 光监视器 — Territory Studio | [资料页](https://www.hudsandguis.com/home/2018/blade-runner-2049)<br>[原始出处](https://territorystudio.com/project/blade-runner-2049/) | 高对比蓝色渐变 + 粗轮廓 + 简单几何——“对比度承担全部含义”，不靠细节。 | **整体气质** — 视觉核验：可读（大形状 + 强对比扛得住缩小）。这条的反面同样有用：靠细节堆出来的画面缩到 280px 一定崩。 | 视觉核验(可读) | 边缘密度 45.5、平均饱和 76 |
| 8 | `blade-runner-2049-wallace-grid-08.jpg` | 《Blade Runner 2049》— Wallace Corp 系统状态板 — Territory Studio | [资料页](https://www.hudsandguis.com/home/2018/blade-runner-2049)<br>[原始出处](https://territorystudio.com/project/blade-runner-2049/) | 等宽数据网格 + 严格正交行 + 1px 细分割线做表格对齐。 | **任务列表（只取骨架）** — **技术可取、这张图本身不可取**：视觉核验判定它在 280px 下“密集小行会糊成雪花”。要抄的是“正交行 + 细分割线”的骨架，不是它的信息量。 | 视觉核验(不可读) | 57.5% 纯黑、0 个饱和色相族、边缘密度 22.6 |
| 9 | `blade-runner-2049-ks-spinner-09.jpg` | 《Blade Runner 2049》— K 的 Spinner 载具 HUD — Territory Studio | [资料页](https://www.hudsandguis.com/home/2018/blade-runner-2049)<br>[原始出处](https://territorystudio.com/project/blade-runner-2049/) | 左右两侧各一条 1px 刻度尺（tick ruler）框住视口，暗示比例与量程，中间保持空白。 | **整体气质 / 版式** — 刻度尺几乎不占像素却提供整套骨架——小面板两侧各加一条极细刻度，是最便宜的“科幻感”来源。视觉核验：本图内容不可读，但这条手法可搬。 | 视觉核验(不可读) | 22.6% 近黑、主色偏脏绿 #081810、边缘密度 25.1 |
| 10 | `blade-runner-2049-wallace-cockpit-10.jpg` | 《Blade Runner 2049》— Wallace Corp 载具座舱 — Territory Studio | [资料页](https://www.hudsandguis.com/home/2018/blade-runner-2049)<br>[原始出处](https://territorystudio.com/project/blade-runner-2049/) | 深黑屏上打亮青/白数据，让读数压过座舱里的暖色环境光。 | **整体气质** — 这就是“浮在任意壁纸上”这条约束的直接答案：**先把底板压深、再把数据打亮**，优先级高于选哪个强调色。视觉核验：本图因屏占比小而不可读，结论可搬。 | 视觉核验(不可读) | 42.6% 近黑、主色 #000000 占 32.7% |
| 11 | `the-expanse-razorback-hud-11.jpg` | 《The Expanse》— Razorback 号 HUD — Rhys Yorke | [资料页](https://www.hudsandguis.com/home/2021/theexpanse)<br>[原始出处](https://rhysyorke.com/) | 半透明叠加 + 细白网格线 + 亮蓝文字 + 居中单一视觉焦点。 | **整体气质（正反两面）** — “居中单一焦点”可以借来放金额。但视觉核验判定**本图不可读**——多层叠加元素互相压叠会失去清晰度，这是小尺寸必须避开的坑。 | 视觉核验(不可读) | 43.3% 近黑、边缘密度 34.4 |
| 12 | `cyberpunk-2077-quest-tracker-12.png` | 《Cyberpunk 2077》— 游戏内 HUD / 任务追踪器 — CD Projekt Red | [资料页](https://www.hudsandguis.com/home/2019/cyberpunk-2077)<br>[原始出处](https://www.cyberpunk.net/) | 常驻侧栏任务清单，每条“标题 + 一行目标 + 状态”，高饱和强调色只标当前进行中的一条，其余全部退为中性灰。 | **任务列表** — 形态最接近我们第④条需求（常驻清单 + 完成/进行中）。**证据较弱**：本轮视觉核验未覆盖此图（限流），结论来自来源页归类 + 实测。用之前建议亲眼过一遍。 | 实测像素 | 61.8% 近黑、平均饱和 32.3、边缘密度 20.7 |
| 13 | `destiny-mission-list-13.jpg` | 《Destiny》— 任务/装备菜单 — Bungie | [资料页](https://www.hudsandguis.com/home/2015/5/25/destiny-ui)<br>[原始出处](https://www.bungie.net/7/en/Destiny) | 深菜单用“自由光标 + 悬停浮出 tooltip”把内容藏起来，屏幕本体只留必要项。原文：内容太密时，tooltip 是“隐藏内容的优雅方式，让用户自己决定想显示什么”。 | **任务列表** — 220px 高度里塞下多条任务的现实解法：每条只留“名称 + 状态点”，详情交给 hover/展开。 | 来源文档 | 边缘密度 46.4（51 个样本中最高）、亮底 L=141.8 |
| 14 | `the-martian-console-14.png` | 《The Martian》— 舱内控制台 — Territory Studio（片中屏幕图形） | [资料页](https://www.hudsandguis.com/home/2015/8/17/the-martian)<br>[原始出处](https://territorystudio.com/project/the-martian/) | 把极小的字号当“纹理”用，而不是承载真实内容。原文：小字号“有助于营造技术工作站的印象”……FUI 的便利正在于不必遵守可读性下限，字“可以被当作传达整体感觉的装置，而不必呈现真实内容”。 | **文字排版 / 整体气质** — 思考文本旁可挂一条极小、近乎不可读的辅行做技术感纹理，零阅读负担——小尺寸下的低成本高级感。 | 来源文档 | 平均饱和 13.4（全部样本最低）、边缘密度 23.1 |
| 15 | `severance-macrodata-terminal-15.png` | 《Severance》— Lumon Macrodata Refinement 终端 — Apple TV+ | [资料页](https://www.hudsandguis.com/home/2022/severance) | 只有 2 个饱和色相族、77% 近黑，单一色相发光承担全部层级；数字等宽、逐位变化。原文称其界面“非常晦涩古怪”，动画只是暗示某种理解正在发生。 | **数字呈现** — 金额跳动直接照搬“等宽逐位变化 + 单色发光”——跳动感来自数字本身，不需要额外动效道具，成本最低。 | 实测像素 + 来源文档 | 2 个饱和色相族、77.3% 近黑、平均饱和 85.1 |
| 16 | `silo-territory-cypher-ui-16.jpg` | 《Silo》— 屏幕图形 — Territory Studio（工作室官网作品页） | [资料页](https://territorystudio.com/project/silo/)<br>[原始出处](https://territorystudio.com/project-category/screen-graphics/) | 同一套界面语言跨系统复用：密排小字 + 单一暖色强调 + 极窄边距，画面密度高但元素种类极少。 | **文字排版 / 整体气质** — 对我们的含义是：整块面板只定义 3–4 个组件（状态行 / 文本块 / 数字 / 任务行），靠排列组合，不再新增样式。**证据较弱**：未经视觉核验。 | 实测像素 | 平均饱和 26.2、暖中性主色 #201810、边缘密度 17.4 |

---

## 三、最推荐的五张

按「对我们这块小面板的直接可用度」排序，只从**视觉核验过、且判定为可读**的里面选：

1. **#2 `star-citizen-mobiglas-overlay-02.png`** — 唯一一张直接演示「半透明信息板浮在场景之上」的参考，而且它本身就在显示**财务数字**，与我们第③条同构。它给出的结论也最硬：压住任意背景靠的是**把底板压得足够深**，而不是挑强调色。
2. **#1 `blade-runner-2049-analysis-console-01.jpg`** — 金额那一行的做法：等宽数字、贴边硬对齐、配暗角收束。核验判定 280px 下依然可读，是最省空间的数字排法。
3. **#3 `blade-runner-2049-database-columns-03.jpg`** — 任务列表的关键洞察：只要行距与列位一致，**字看不清也依然读起来像一张表**。于是「完成 / 进行中」可以挂在列位和行节奏上，不必依赖文字本身——小尺寸下等于白送一档层级。
4. **#6 `the-expanse-behemoth-command-06.jpg`** — 唯一给出「跳动感」具体做法的参考：**让边框呼吸**，而不是让文字抖动。文字抖动在 280px 下会直接毁掉可读性，边框脉冲则完全不影响。
5. **#5 `the-expanse-rocinante-panels-05.jpg`** — 「单色 + 恰好一处高亮」在极限缩放下比多色方案活得久；粗体数字竖排也是 210px 宽下省水平空间的一个现成选项。

## 四、核验给出的两条「不要做」

- **不要做径向 / 环形布局。**候选里 Star Citizen 的卡片系统是环形选船界面，核验判定它在 280px 下必崩（环形 + 细节会被压得过于紧凑）。同理，密集示意图（BR2049 的蓝图类、Spinner 空中监视类）也会糊。相关的 3 张没有进入这 16 张。
- **不要靠细节堆画面。**#7 的核验原话是「对比度承担全部含义」——能扛住缩小的是**大形状 + 强对比 + 粗字**；靠细线和密集小字堆出来的画面会先死。注意 #8 是唯一一张「手法可取、画面不可取」的例子，我在表里标了出来。

## 五、没拿到的 / 站点限制

- **Behance / ArtStation / Dribbble**：均未取图。这类站对自动抓取有反爬与登录要求，按「有反爬就换源、不硬撞」的纪律放弃，改用资料站与工作室官网替代。
- **Wikimedia Commons（真实航空航天仪表）**：只取到 1 张（阿波罗 DSKY），随后触发 429 限流，未继续重试。该图属于实物照片且未经视觉核验，与我们的「屏幕设计」需求相关性偏低，**未纳入这 16 张**。
- **Iron Man / Iron Man 2（Prologue）HUD 流程稿**：资料站仅存 590×83 的细长条缩略图，分辨率不足以当参考，已剔除。
- **《Oblivion》《Elysium》《Prometheus》**：资料站对应页面没有可用的静态图（多为视频嵌入），未取。
- **《Arrival》**：资料站没有 Arrival 专页；站内 slug 为 `first-contact` 的页面实际是 **Oculus First Contact（VR）**，不是《Arrival》。已在过程中纠正，未把两者混淆。
- **视觉核验缺口**：38 张候选未能核验（后端 429）。这 16 张中 #12–#16 的部分结论因此弱于其余各张，已在表中标注。
