/* pixel-contrast.mjs —— 「像素口径」对比度的公共件（**从 panel-lightness.mjs 原样抽出**，2026-09-19）
 *
 * 为什么抽出来：这套口径是本项目踩过两次坑之后才定下来的（① 用量"名义色"代替像素 ⇒ 30/30 全绿而
 * 用户看不清；② 用坏掉的 PNG 解码器 ⇒ 所有从截图像素实取的数字都建立在乱码上）。
 * 抽成一处之后，panel-lightness.mjs（大面板）与 hover-plate.mjs（悬浮板）用的是**同一份**实现，
 * 不会出现"两块板各算各的、口径悄悄漂开"。
 *
 * 口径（逐字沿用）：
 *   fg            = 该文字矩形内**笔画像素**（相对底板比值最高的前 1% 像素平均色）
 *   bg(幕上)      = 同一矩形内**众数色**（字形之间的底板）
 *   bg(用户所见)  = α·bg(幕上) + (1-α)·壁纸像素    ← α 取该像素的**实测 alpha 通道**
 *   判据          = WCAG(fg, bg(用户所见)) ≥ 4.5（小字）/ 3.0（≥18px）
 *
 * ⚠️ 透明窗口的 capturePage **不叠桌面**（2026-09-19 复测：同一帧带/不带 `--hide hex=<壁纸>`
 *    逐像素完全一致 ⇒ 页面内的 body 背景图进不了截图）。所以"用户实际看到的底"必须自己按
 *    **实测 α** 合成到真实壁纸之上 —— 这一条是整套口径的地基，别改成"直接读截图里的底"。
 */
import zlib from 'node:zlib'

/* ---------- PNG 解码（精确 Paeth；近似式会在这里整体失真） ---------- */
export function pngDecode (buf) {
  let off = 8, w = 0, h = 0, ct = 0; const idat = []
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp
  const raw = zlib.inflateSync(Buffer.concat(idat)), out = Buffer.alloc(h * stride)
  let p = 0
  for (let y = 0; y < h; y++) {
    const ft = raw[p++], cur = raw.slice(p, p + stride); p += stride
    const prev = y ? out.slice((y - 1) * stride, y * stride) : Buffer.alloc(stride)
    const line = out.slice(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? line[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0, v = cur[x]
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c)
      const pr = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c)
      line[x] = (ft === 0 ? v : ft === 1 ? v + a : ft === 2 ? v + b : ft === 3 ? v + ((a + b) >> 1) : v + pr) & 0xff
    }
  }
  /* ⚠️ 页面内有不透明底（--bg white/dark）时 Electron 会给出**没有 alpha 通道**的 PNG（ct=2）：
     统一补成 RGBA + alpha=255，否则后面按 4 通道取数会读出 NaN。 */
  if (bpp === 3) {
    const out4 = Buffer.alloc(w * h * 4)
    for (let i = 0, j = 0; i < out.length; i += 3, j += 4) { out4[j] = out[i]; out4[j + 1] = out[i + 1]; out4[j + 2] = out[i + 2]; out4[j + 3] = 255 }
    return { w, h, bpp: 4, px: out4 }
  }
  return { w, h, bpp, px: out }
}

/* ---------- WCAG ---------- */
export const lin = (v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }
export const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
export const ratio = (a, b) => { const A = lum(a), B = lum(b); return (Math.max(A, B) + 0.05) / (Math.min(A, B) + 0.05) }
export const rgbOf = (css) => { const m = String(css).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null }
export const fmt = (c) => 'rgb(' + c.map(Math.round).join(',') + ')'
export const mix = (fg, a, bg) => [0, 1, 2].map((k) => a * fg[k] + (1 - a) * bg[k])

/* ---------- 单个元素矩形内的众数色 + 笔画像素（与 v2.mjs / panel-lightness.mjs 同口径） ---------- */
export function measure (img, row, dpr) {
  const nom = rgbOf(row[5]); if (!nom) return null
  const L = Math.round(Number(row[1]) * dpr), T = Math.round(Number(row[2]) * dpr)
  const W = Math.round(Number(row[3]) * dpr), H = Math.round(Number(row[4]) * dpr)
  if (W < 3 || H < 3) return null
  const X1 = Math.min(img.w, L + W), Y1 = Math.min(img.h, T + H)
  if (L >= X1 || T >= Y1 || L < 0 || T < 0) return null
  const tally = new Map()
  for (let y = T; y < Y1; y++) for (let x = L; x < X1; x++) {
    const i = y * img.w * img.bpp + x * img.bpp
    const k = (img.px[i] >> 3) + ',' + (img.px[i + 1] >> 3) + ',' + (img.px[i + 2] >> 3) + ',' + (img.px[i + 3] >> 4)
    tally.set(k, (tally.get(k) || 0) + 1)
  }
  if (!tally.size) return null
  const mk = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number)
  const bg = [mk[0] * 8 + 4, mk[1] * 8 + 4, mk[2] * 8 + 4], aMode = mk[3] * 16 + 8
  const cand = []
  for (let y = T; y < Y1; y++) for (let x = L; x < X1; x++) {
    const i = y * img.w * img.bpp + x * img.bpp
    cand.push([ratio([img.px[i], img.px[i + 1], img.px[i + 2]], bg), [img.px[i], img.px[i + 1], img.px[i + 2]], img.px[i + 3]])
  }
  cand.sort((a, b) => b[0] - a[0])
  const tp = cand.slice(0, Math.max(3, Math.ceil(cand.length * 0.01)))
  const fg = [0, 1, 2].map((k) => Math.round(tp.reduce((s, p) => s + p[1][k], 0) / tp.length))
  const fgA = Math.round(tp.reduce((s, p) => s + p[2], 0) / tp.length)
  return { txt: (row[0] || '').slice(0, 18), cls: row[10] || '', nom, fg, fgA, bg, aMode, size: Number(row[6]) || 10,
    cx: (L + X1) / 2 / dpr, cy: (T + Y1) / 2 / dpr }
}

/* ---------- 已知图往返自证：sharp 造图 → PNG → 本解码器 → 逐字节差必须为 0 ---------- */
export async function decoderSelfCheck (sharp, dir, fs, path) {
  const W = 96, H = 64
  const raw = Buffer.alloc(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4
    raw[i] = (x * 7 + y * 3) & 255
    raw[i + 1] = (x * 11 + 17) & 255
    raw[i + 2] = (y * 13 + 29) & 255
    raw[i + 3] = (x + y) % 2 ? 255 : 200      /* 含 alpha 变化 ⇒ 走 ct=6（真 RGBA）分支 */
  }
  fs.mkdirSync(dir, { recursive: true })
  const f = path.join(dir, 'decoder-selfcheck.png')
  await sharp(raw, { raw: { width: W, height: H, channels: 4 } }).png().toFile(f)
  const dec = pngDecode(fs.readFileSync(f))
  let maxErr = -1
  if (dec.w === W && dec.h === H && dec.px.length === raw.length) {
    maxErr = 0
    for (let i = 0; i < raw.length; i++) maxErr = Math.max(maxErr, Math.abs(raw[i] - dec.px[i]))
  }
  return { file: f, w: dec.w, h: dec.h, bpp: dec.bpp, maxErr, expected: W + 'x' + H }
}
