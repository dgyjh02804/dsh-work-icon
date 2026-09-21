/**
 * 宿主侧诊断文件（**与窗口的 helper.log 同目录**）。
 *
 * 为什么必须有这个东西：本机 DSH 的 logger 一个字节都没落盘
 * （`~/.dsh/logs/boot` 是 0 字节），于是"心跳为什么没发""谁把配置翻了"
 * 这类只有宿主知道的事，在日志里完全不可见 —— 2026-09-13 两次排查都被这条卡住。
 *
 * 纪律：**尽力而为**，任何失败都吞掉（诊断绝不能影响图标本体）；
 * 有大小上限（超了清空重写），避免无限增长。
 */

import { appendFileSync, statSync, writeFileSync } from 'node:fs'

export const DIAG_MAX_BYTES = 256 * 1024

/**
 * 追加一行诊断。
 * @param file 目标文件；空值 = 关闭诊断（不写）
 * @param line 内容（自带时间戳更易读，这里不代加，调用方口径各不同）
 * @returns 是否真的写进去了（测试用它断言"留痕了"）
 */
export function appendDiag(file, line, { fs = {} } = {}) {
  if (typeof file !== 'string' || file.trim().length === 0) return false
  const append = fs.appendFileSync ?? appendFileSync
  const write = fs.writeFileSync ?? writeFileSync
  const stat = fs.statSync ?? statSync
  try {
    const entry = line.endsWith('\n') ? line : `${line}\n`
    let size = 0
    try {
      size = stat(file).size
    } catch {
      size = 0
    }
    if (size > DIAG_MAX_BYTES) write(file, entry, 'utf8')
    else append(file, entry, 'utf8')
    return true
  } catch {
    return false
  }
}
