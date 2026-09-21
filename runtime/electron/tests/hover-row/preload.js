const { ipcRenderer } = require('electron')
/* 渲染进程只管两件事：① 收到 'row' 就把那一行高亮（证明主→渲染通路可用）
 *                   ② 老实记录自己到底收到了多少次 DOM mousemove（回答 forward 是否真转发） */
let moves = 0
window.addEventListener('mousemove', () => { moves++; ipcRenderer.send('dom-move') })
window.__moves = () => moves
ipcRenderer.on('row', (_e, row) => {
  document.querySelectorAll('.trow').forEach((el, i) => {
    el.setAttribute('data-hot', i === row ? '1' : '0')
  })
  const el = document.getElementById('hot')
  if (el) el.textContent = row < 0 ? '—（不在任何行）' : ('第 ' + (row + 1) + ' 行')
})
