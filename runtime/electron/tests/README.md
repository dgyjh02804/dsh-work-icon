# runtime/electron/tests 说明

## 离屏截图：可用调用形状（照抄，别凭记忆拼）

> 这条形状我丢过四次，**它才是"能跑通"的证据**。参考实现：`tests/shots.mjs`（七态黄金样本）、`tests/panel-shot.mjs`（面板 + 悬浮层）。

```
--shot 240 --shot-panel --bg dark --shot-states WORKING --out <目录> --settle-ms 3000 --hidden
+ 通过 stdin 喂 v2 载荷（{kind:'state', ...} / {kind:'text', ...}）
+ 等进程自己退出（waitExit）——它抓图后才退，提前 kill 永远拿不到图
```

**三条极易踩错**：
1. 用 `--shot-states`（**不是** `--state`）——`--state` 只设图标状态，不会触发抓图；
2. `--out` 给**目录**（给 `.png` 单张路径时在我这版没落盘）；
3. **进程自己退出**，不要 kill。

**另一个坑**：同一目录里两次抓图**文件名相同会互相覆盖** ⇒ 每次抓图给独立子目录。

**产物**：`test/out/<runId>/panel-shot/{panel,hover}/*.png`

**纪律**：不要用 `browser_evaluate`（用户已终局拒绝，不重试、不换说法）；也不要用"两帧像素差"当动效证据（会被加载态污染）。

### 让截图带真实数据：`--shot-payload <json>`（main.js 新增，仅 shot 模式生效）

```
--shot 240 --shot-panel --bg dark --shot-states WORKING --out <目录> --shot-payload <载荷.json> --settle-ms 3000 --hidden
```

载荷格式：`{ "state": { ...v2 字段... }, "text": { "revision": 1, ... } }`

**为什么必须有它**：`--shot` 模式有自己的状态来源，stdin 喂的载荷**不会**进渲染层 ⇒ 不带它截出来的面板是**空壳**。
（这个坑踩过一次：把空壳图当成品报了出去，后来被我新加的 `plate nodata` 断言当场推翻。）

**另一种坑（2026-09-19 实测到的假失败）**：产物目录按 `runId` 隔离，而 runId 原来是**纯 pid**
⇒ **pid 被系统回收**时跨天复用同一个目录，于是"整份日志通读 + 数条数"的断言（`v2-fields.mjs`
的"相同 revision 不重画"）把**旧一轮的行**一起数了进去，整轮 run-all 报一项**假红**。
现在 runId 带时间后缀（`harness.mjs`），并且 `v2-fields.mjs` 自己也会先清日志。

## 新增三项（2026-09-19：E 悬浮板全删底 / F 配色设置窗口 / G 日志去重）

| 测试 | 钉住什么 | 关键口径 |
| --- | --- | --- |
| `hover-plate.mjs` | 图标下那块悬浮信息板（`#v2hover`）的**底/框/圆角全部由 `--hover-plate-a` 控、默认 0 = 全删**；文字描边补偿；**大面板的底一字未动** | 像素：透明窗口截图**不叠桌面** ⇒ 用户所见 = α·截图像素 + (1−α)·真实壁纸像素；壁纸按**屏幕坐标**取样（生产窗口在右下角，四个屏幕角位形取最亮） |
| `settings-window.mjs` | 右键菜单「配色设置…」→ 独立普通窗口 → **实时**热更新（同一个 Electron 实例的 IPC，**不经宿主 stdio**）→ 只落 `~/.dsh/work-icon/theme.json`（**绝不碰宿主 `config.json`**） | 热更新的证据 = 渲染层 `theme css:` 留痕 + **本进程没往图标进程 stdin 写过任何字节** + `window created × 1`；对比度读数用**公式**实时算、断言用**像素**复验 |
| `log-dedup.mjs` | 同一次 `logPanelLayout`（一段连续 burst）里，**同一条 `v2panel blk` 留痕最多 1 条** | 去重单位是**整行**（同一次调用里同一个元素被量 15 遍 ⇒ 整行逐字节相同），不是文本（面板里本来就可能有两个同文本元素）；另有"留痕内容不许缩水"的防退化守卫 |

**像素口径只有一份实现**：`tests/pixel-contrast.mjs`（`pngDecode` / WCAG / `measure`），
`panel-lightness.mjs`（大面板）与 `hover-plate.mjs`（悬浮板）都从它 import —— 两块板不会各算各的。
量产品像素之前，测试会先用 **sharp 自造已知图往返**自证解码器（`maxErr` 必须 = 0）。

**窗口侧主题**：`~/.dsh/work-icon/theme.json`（`hoverPlateAlpha` / `panelAlpha` / `textBoost` /
`panelOpacity` / `iconBright`）。`panelAlpha: null` 的语义是"没在设置窗口里调过 ⇒ 跟随宿主 `config.json`
的 `window.panelAlpha`"；写成数字才是窗口侧覆盖。**窗口侧设置与宿主配置必须是两个文件两个真相源**
（本项目踩过"窗口侧把宿主配置文件覆盖掉、把用户勾选态清空"的坑）。

## ⚠️ 事故教训（第三次同源，务必遵守）

**整段替换一个函数之后：必须 grep「定义是否还在」+ 立刻跑一次套件。**
- 本项目已发生 **3 次**同源事故：**语法全过、代码看着对，实际已经坏了**。
- 最近一次：整段替换 `renderPanel` 时**把函数定义弄丢**（只剩调用点）⇒ 样板停止渲染（生产受损），
  而 `node --check` **全部通过**（合法 JS，只是少了个函数）——**在这里语法检查是无效证据**。
- 现有硬网：① 渲染层几何自检 `panel layout(...)`（出界/重叠的数字）② 关键值"同一次渲染里只出现一次"断言
  ③ `test-mode` 下的渲染层 error/rejection 通道（否则异常完全静默）。
