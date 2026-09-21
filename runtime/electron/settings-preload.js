'use strict'
/* dsh-work-icon · **配色设置窗口**的渲染进程桥（contextIsolation 开启，只暴露必需的最小面）
   —— 任务 F（2026-09-19）。与图标窗口的 preload.js **分开两个文件**：那个是不可聚焦的置顶悬浮窗，
   这个是普通窗口，能访问的面完全不是一回事，混在一起迟早出事。 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('settings', {
  /* 读当前主题（主进程是唯一真源：~/.dsh/work-icon/theme.json） */
  get: () => ipcRenderer.invoke('theme:get'),
  /* 写：**唯一的写入口**。主进程收到后立刻（a）发给图标窗口改 CSS 变量、（b）原子写 theme.json。
     全程不经过 DSH 宿主的 stdio 协议 ⇒ 拖动滑块就是当场生效，不需要重启。 */
  set: (patch) => ipcRenderer.invoke('theme:set', patch),
  reset: () => ipcRenderer.invoke('theme:reset'),
  /* 图标窗口的现状（只读取证：几何 / 置顶 / 穿透）——用来给"设置窗口没影响图标窗口"这件事留痕 */
  iconState: () => ipcRenderer.invoke('icon:state'),
  /* 主进程推过来的主题（打开时、以及任何一侧改动后） */
  onTheme: (cb) => ipcRenderer.on('theme', (_e, theme, why) => { try { cb(theme, why) } catch (err) { /* 渲染层异常不影响主进程 */ } })
})
