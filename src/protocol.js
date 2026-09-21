/**
 * dsh-work-icon 路 杩涚▼闂村崗璁紙SPEC-H2 绗?5 鑺傦紝鍐荤粨锛? *
 * 绾胯矾鏍煎紡锛歯ewline-delimited JSON锛屼竴琛屼竴涓畬鏁村璞★紝UTF-8锛屾棤 BOM銆? *   { "protocolVersion": 1, "kind": "<kind>", "timestamp": 1757000000000, ...payload }
 *
 * 鏈ā鍧楀彧鍋氥€屾瀯閫?/ 鏍￠獙 / 缂栫爜 / 瑙ｆ瀽銆嶏紝涓嶆寔鏈変换浣曡繍琛屾椂鐘舵€併€? * 瑙ｆ瀽璺緞锛坧arseMessage / LineDecoder锛夊浠讳綍鑴忔暟鎹兘杩斿洖 null 骞惰鏁帮紝
 * 缁濅笉鎶涘紓甯?鈥斺€?杩欐槸 SPEC 绗?5 鑺傘€屽仴澹€ц姹傘€嶇殑鐩存帴钀藉湴銆? */

export const PROTOCOL_VERSION = 2

/**
 * 瀹夸富**鎺ュ彈**鐨勫叆绔欏崗璁増鏈€倂1 鏄喕缁撶殑鑰佸崗璁細鑰佺獥鍙ｅ彧鍙?v1 鐨?`ready`
 * 锛堟病鏈?capabilities锛夛紝瀹夸富蹇呴』缁х画璁ゅ畠锛屽苟鎸?v1 鍙彂鍩虹瀛楁銆? */
export const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([1, 2])

/** 绐楀彛鍙互鍦?`ready` 閲屽０鏄庤嚜宸辫璇嗙殑鎵╁睍锛涘涓绘寜鑳藉姏闂ㄦ帶鏂板瀛楁/鏂?kind銆?*/
export const Capability = Object.freeze({
  TODOS: 'todos',
  COST: 'cost',
  TEXT: 'text',
  /** 璁″垝杩涘害锛?*鐪熻繘搴?*锛? 娲诲姩閲忥紙**浠ｇ悊鎸囨爣**锛岀嫭绔嬪瓧娈?metrics锛岀粷涓嶆贩杩?progress锛夈€?*/
  PROGRESS: 'progress',
  /** 瀛愪唬鐞嗚鏁颁笌鏍戯紙鐪熻繘搴︼細宸插畬鎴?鎬绘暟锛夈€?*/
  SUBAGENTS: 'subagents',
  /** 澶氬璇濆垪琛紙闈㈡澘閲屾瘡瀵硅瘽涓€鏉★級銆?*/
  SESSIONS: 'sessions',
  /**
   * 涓婁笅鏂囧崰鐢紙**璧勬簮鎸囨爣**锛岀嫭绔嬪瓧娈?context锛夈€?   * 鏈夌湡瀹炲垎姣嶏紙pressureTokens / contextWindow锛夛紝鍙敾鐜?鏉★紱
   * 浣?*蹇呴』**鏍囨敞涓?涓婁笅鏂囧崰鐢?鑰屼笉鏄?宸ヤ綔杩涘害"鈥斺€斿畠涓嶆槸 progress銆?   */
  CONTEXT: 'context',
})

const CAPABILITY_SET = new Set(Object.values(Capability))

export function isCapability(value) {
  return typeof value === 'string' && CAPABILITY_SET.has(value)
}

/** SPEC 绗?5 鑺傚喕缁撶殑 kind 鍙栧€硷紙v2 澧炶ˉ `text`锛屽彧澧炰笉鏀癸級銆?*/
export const MessageKind = Object.freeze({
  READY: 'ready',
  STATE: 'state',
  PULSE: 'pulse',
  CONFIG: 'config',
  SETTING: 'setting',
  SHUTDOWN: 'shutdown',
  CLOSED: 'closed',
  /** v2锛氭祦寮忔枃鏈笓鐢紙涓?state 鐨?鍙樺寲鎵嶅彂"瑙ｈ€︼紝鑷繁甯﹁妭娴侊級銆?*/
  TEXT: 'text',
})

/** 姣忎釜 kind 鐨勫悎娉曟柟鍚戯紱host 鍙彂 host-to-window锛屽彧澶勭悊 window-to-host銆?*/
export const KIND_DIRECTION = Object.freeze({
  ready: 'window-to-host',
  state: 'host-to-window',
  pulse: 'host-to-window',
  config: 'host-to-window',
  setting: 'window-to-host',
  shutdown: 'host-to-window',
  closed: 'window-to-host',
  text: 'host-to-window',
})

/** SPEC 绗?5 鑺?state 鏋氫妇锛堢 4 鑺傜殑涓枃鏍囩鏄樉绀哄悕锛屼笉璧颁笂绾胯矾锛夈€?*/
export const WorkState = Object.freeze({
  IDLE: 'IDLE',
  THINKING: 'THINKING',
  WORKING: 'WORKING',
  WAITING: 'WAITING',
  SUCCESS: 'SUCCESS',
  ERROR: 'ERROR',
  DISCONNECTED: 'DISCONNECTED',
})

/** SPEC 绗?5 鑺?activity 鏋氫妇銆?*/
export const Activity = Object.freeze({
  SEARCHING: 'searching',
  EDITING: 'editing',
  TESTING: 'testing',
  COMMANDING: 'commanding',
})

const KIND_SET = new Set(Object.values(MessageKind))
const STATE_SET = new Set(Object.values(WorkState))
const ACTIVITY_SET = new Set(Object.values(Activity))

export function isKind(value) {
  return typeof value === 'string' && KIND_SET.has(value)
}

export function isWorkState(value) {
  return typeof value === 'string' && STATE_SET.has(value)
}

export function isActivity(value) {
  return typeof value === 'string' && ACTIVITY_SET.has(value)
}

/**
 * 宸茬煡 kind 鐨勫繀闇€杞借嵎銆傚彧鏍￠獙銆屽绾﹂噷鏄庣‘鍐欎簡銆嶇殑瀛楁锛岄澶栧瓧娈典竴寰嬫斁琛? * 锛圫PEC 鐨?JSONC 澶撮儴鐢?`"..." : "payload"` 鏄惧紡鐣欎簡鎵╁睍浣嶏級銆? */
function validatePayload(message) {
  switch (message.kind) {
    case MessageKind.STATE:
      if (!isWorkState(message.state)) return `unknown state: ${String(message.state)}`
      if (message.activity !== undefined && !isActivity(message.activity)) {
        return `unknown activity: ${String(message.activity)}`
      }
      return undefined
    case MessageKind.PULSE:
      if (!isWorkState(message.state)) return `unknown state: ${String(message.state)}`
      if (message.activity !== undefined && !isActivity(message.activity)) {
        return `unknown activity: ${String(message.activity)}`
      }
      return undefined
    case MessageKind.READY:
      if (message.pid !== undefined && !Number.isFinite(message.pid)) return 'ready.pid must be a number'
      // v2：窗口声明能力。不认识的条目**忽略**（前向兼容），非法形状才报错。
if (message.capabilities !== undefined && !Array.isArray(message.capabilities)) {
        return 'ready.capabilities must be an array'
      }
      return undefined
    case MessageKind.TEXT:
      // v2 流式文本：revision 是"文本在增长"的单调证据，窗口靠它驱动跳动动画。
if (!Number.isFinite(message.revision) || message.revision < 0) return 'text.revision must be a non-negative number'
      for (const field of ['activityText', 'thoughtTail', 'bodyTail']) {
        if (message[field] !== undefined && typeof message[field] !== 'string') return `text.${field} must be a string`
      }
      return undefined
    case MessageKind.SETTING:
      if (typeof message.key !== 'string' || message.key.length === 0) return 'setting.key must be a non-empty string'
      return undefined
    case MessageKind.SHUTDOWN:
      return undefined
    case MessageKind.CLOSED:
      if (message.reason !== undefined && typeof message.reason !== 'string') return 'closed.reason must be a string'
      return undefined
    case MessageKind.CONFIG:
      return undefined
    default:
      return `unknown kind: ${String(message.kind)}`
  }
}

/**
 * 鍙鏍￠獙銆傝繑鍥?`{ ok: true, message }` 鎴?`{ ok: false, error }`銆? * 涓嶅仛浠讳綍绫诲瀷杞崲 鈥斺€?鏍￠獙閫氳繃鐨勬案杩滄槸璋冪敤鏂逛紶杩涙潵鐨勯偅涓璞°€? */
export function validateMessage(value, { direction } = {}) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'message must be a plain object' }
  }
  if (!SUPPORTED_PROTOCOL_VERSIONS.includes(value.protocolVersion)) {
    return { ok: false, error: `unsupported protocolVersion: ${String(value.protocolVersion)}` }
  }
  if (!isKind(value.kind)) return { ok: false, error: `unknown kind: ${String(value.kind)}` }
  if (direction !== undefined && KIND_DIRECTION[value.kind] !== direction) {
    return { ok: false, error: `kind ${value.kind} is not valid in direction ${direction}` }
  }
  const payloadError = validatePayload(value)
  if (payloadError) return { ok: false, error: payloadError }
  return { ok: true, message: value }
}

/** 鎶涘紓甯哥増鏈紝缁欍€岀函绋嬪簭鍛橀敊璇€嶇殑鏋勯€犺矾寰勭敤銆?*/
export function assertMessage(value, options) {
  const result = validateMessage(value, options)
  if (!result.ok) throw new TypeError(`invalid work-icon message: ${result.error}`)
  return value
}

/** 淇濈暀瀛椾笉鍏佽琚?payload 瑕嗙洊锛岄伩鍏嶅嚭鐜?kind/protocolVersion 涓庡疄闄呬笉绗︾殑娑堟伅銆?*/
function stripReserved(payload) {
  const clean = {}
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'protocolVersion' || key === 'kind') continue
      clean[key] = value
    }
  }
  return clean
}

/**
 * 鏋勯€犱竴鏉″鍙戞秷鎭€俴ind 闈炴硶鐩存帴鎶?TypeError 鈥斺€?杩欐槸缂栫爜鏈熼敊璇紝
 * 搴旇鍦ㄦ湰杩涚▼閲岀偢寰楄秺鏃╄秺濂斤紙bridge 浼氬湪鍙戦€佽竟鐣屽厹浣忓畠锛夈€? */
export function createMessage(kind, payload = {}) {
  if (!isKind(kind)) throw new TypeError(`Unknown work-icon message kind: ${String(kind)}`)
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind,
    timestamp: Date.now(),
    ...stripReserved(payload),
  }
}

/**
 * 缂栫爜涓轰竴琛岋紙浠?\n 缁撳熬锛夈€備細鍏堝畬鏁存牎楠岋細瀹佸彲涓竴鏉℃秷鎭紝
 * 涔熶笉瑕佸湪绾夸笂鍙戝嚭鍗忚澶栫殑涓滆タ璁╁鏂硅В鏋愬櫒鐘毦銆? */
export function encodeMessage(message) {
  assertMessage(message)
  return `${JSON.stringify(message)}\n`
}

/**
 * 瑙ｆ瀽涓€琛屻€備换浣曞け璐ワ紙绌鸿銆侀潪 JSON銆佺増鏈笉绗︺€乲ind 闈炴硶銆佽浇鑽风己瀛楁锛? * 閮借繑鍥?null锛屼笉鎶涘紓甯搞€? */
export function parseMessage(line) {
  if (typeof line !== 'string') return null
  const text = line.replace(/^\uFEFF/u, '').replace(/\r+$/u, '')
  if (text.trim().length === 0) return null
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return null
  }
  const result = validateMessage(value)
  return result.ok ? result.message : null
}

/**
 * 瀛楄妭娴?鈫?娑堟伅銆傛寜 \n 鍒囧垎锛屽ぉ鐒跺鐞嗐€屼竴琛岃鎷嗘垚澶氫釜 chunk銆嶃€? * 瓒呴暱琛岋紙瀵圭娌℃湁鎹㈣绗﹀氨鐙傚悙鏁版嵁锛夌洿鎺ヤ涪寮冨苟璁℃暟锛岄伩鍏嶆棤鐣屽唴瀛樺闀裤€? */
export class LineDecoder {
  constructor({ maxLineLength = 256 * 1024 } = {}) {
    this.maxLineLength = maxLineLength
    this.buffer = ''
    this.receivedLines = 0
    this.invalidLines = 0
    this.droppedOversize = 0
  }

  push(chunk) {
    const text = typeof chunk === 'string'
      ? chunk
      : (chunk === undefined || chunk === null ? '' : String(chunk))
    const messages = []
    if (text.length > 0) this.buffer += text

    let index = this.buffer.indexOf('\n')
    while (index >= 0) {
      const raw = this.buffer.slice(0, index)
      this.buffer = this.buffer.slice(index + 1)
      if (raw.trim().length > 0) {
        this.receivedLines += 1
        const message = parseMessage(raw)
        if (message === null) this.invalidLines += 1
        else messages.push(message)
      }
      index = this.buffer.indexOf('\n')
    }

    if (this.buffer.length > this.maxLineLength) {
      this.droppedOversize += 1
      this.buffer = ''
    }
    return messages
  }

  reset() {
    this.buffer = ''
  }
}

export { KIND_SET, STATE_SET, ACTIVITY_SET, CAPABILITY_SET }
