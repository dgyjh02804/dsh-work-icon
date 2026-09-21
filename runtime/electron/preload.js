'use strict'
/* dsh-work-icon · Electron 渲染进程桥（contextIsolation 开启，只暴露必需的最小面） */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('dsh', {
  onMessage: (cb) => ipcRenderer.on('msg', (_e, payload) => { try { cb(payload) } catch (err) { /* 渲染层异常不影响主进程 */ } }),
  dragBy: (dx, dy) => ipcRenderer.send('drag-by', dx, dy),
  dragEnd: () => ipcRenderer.send('drag-end'),
  activate: () => ipcRenderer.send('activate'),
  togglePanel: () => ipcRenderer.send('toggle-panel'),
  menu: () => ipcRenderer.send('menu'),
  painted: () => ipcRenderer.send('painted'),
  fps: (frames, avg, drv) => ipcRenderer.send('fps', frames, avg, drv),
  log: (m) => ipcRenderer.send('log', m),
  treeRows: (rows) => ipcRenderer.send('tree-rows', rows),
  /* 面板可见矩形的真实布局（窗口局部 CSS px）→ 主进程的命中区（图标圆 ∪ 面板矩形）用它 */
  panelHitRect: (r) => ipcRenderer.send('panel-hitrect', r)
})
