/**
 * RC5-API-009 行为验证：cordis 4.1.0 LoggerLevel 数值语义 + exporter 阈值过滤。
 *
 * 用法：node api009.mjs <cordis ESM entry>
 * 输出：JSON（checks + observations）到 stdout；全过 EXIT 0，否则 EXIT 1。
 *
 * rc.5（cordis 4.1.0）的语义是 ERROR=0 / WARN=1 / INFO=2 / DEBUG=3，
 * 数字越大越 verbose；exporter 的阈值判定是 `targetLevel < level ⇒ skip`。
 * 触发 debug/info/warn 时，阈值 1 只能看到 warn+error，阈值 2 看到 info+warn+error，
 * 阈值 3 才看到 debug。数值反转（旧版 DEBUG 小）会让阈值 1 误吞 warn 或放行 info。
 */
const entry = process.argv[2]
if (!entry) {
  console.error('usage: node api009.mjs <cordis entry>')
  process.exit(2)
}
const mod = await import(entry)
const { Context, Logger } = mod
// 上游 4.1.0 把 LoggerLevel 声明为 `const enum`（类型层擦除，运行时无此导出）；
// vendored @core/cordis 把它落成运行时常量。行为断言用数值语义，常量值另由 d.ts 扫描。
const LoggerLevel = mod.LoggerLevel ?? { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }

const checks = []
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail })
const expected = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 }
check('LoggerLevel = {ERROR:0, WARN:1, INFO:2, DEBUG:3}',
  Object.entries(expected).every(([key, value]) => LoggerLevel[key] === value),
  { actual: LoggerLevel, source: mod.LoggerLevel ? 'runtime export' : 'const enum fallback (values pinned by d.ts)' })
check('数值序：ERROR < WARN < INFO < DEBUG（数字越大越 verbose）',
  LoggerLevel.ERROR < LoggerLevel.WARN && LoggerLevel.WARN < LoggerLevel.INFO && LoggerLevel.INFO < LoggerLevel.DEBUG,
  `${LoggerLevel.ERROR}<${LoggerLevel.WARN}<${LoggerLevel.INFO}<${LoggerLevel.DEBUG}`)

const ctx = new Context()
const thresholds = [0, 1, 2, 3]
const buckets = new Map(thresholds.map((threshold) => [threshold, []]))
for (const threshold of thresholds) {
  ctx.logger.exporter({
    levels: { default: threshold },
    export: (message) => buckets.get(threshold).push({ type: message.type, level: message.level, name: message.name }),
  })
}
// 名称级覆盖：只对 'api-009' 放行 debug，其余 logger 仍受 default:0 限制。
const named = []
ctx.logger.exporter({
  levels: { 'api-009': 3, default: 0 },
  export: (message) => named.push({ type: message.type, level: message.level, name: message.name }),
})

const log = ctx.logger('api-009')
log.error('error-line')
log.warn('warn-line')
log.info('info-line')
log.debug('debug-line')
// 名称级覆盖的另一侧：另一个 logger 在 default:0 下只应收到 error。
const other = ctx.logger('other')
other.error('e'); other.warn('w'); other.info('i'); other.debug('d')

const expectedByThreshold = {
  0: ['error'],
  1: ['error', 'warn'],
  2: ['error', 'warn', 'info'],
  3: ['error', 'warn', 'info', 'debug'],
}
for (const threshold of thresholds) {
  const seen = buckets.get(threshold).filter((item) => item.name === 'api-009').map((item) => item.type)
  check(`阈值 ${threshold}: 只收到 ${expectedByThreshold[threshold].join('+')}`,
    JSON.stringify(seen) === JSON.stringify(expectedByThreshold[threshold]), seen)
}

const levelsSeen = buckets.get(3).filter((item) => item.name === 'api-009')
check('四档消息的 level 数值 = {error:0, warn:1, info:2, debug:3}',
  levelsSeen.length === 4
  && levelsSeen.find((item) => item.type === 'error')?.level === 0
  && levelsSeen.find((item) => item.type === 'warn')?.level === 1
  && levelsSeen.find((item) => item.type === 'info')?.level === 2
  && levelsSeen.find((item) => item.type === 'debug')?.level === 3,
  levelsSeen)

check('exporter 名称级覆盖：api-009 收到四档，default:0 的 other 只收 error',
  named.filter((item) => item.name === 'api-009').length === 4
  && named.filter((item) => item.name === 'other').map((item) => item.type).join(',') === 'error',
  named)

// LoggerOptions.level：单个 logger 的缺省上限（阈值语义同 exporter）。
const capped = []
// 无 levels 的 exporter：阈值回落到 logger 自身的 LoggerOptions.level。
ctx.logger.exporter({ export: (message) => capped.push({ type: message.type, level: message.level, name: message.name }) })
const cappedLog = new Logger({ name: 'capped', level: LoggerLevel.WARN }, ctx.logger)
cappedLog.error('e')
cappedLog.warn('w')
cappedLog.info('i')
cappedLog.debug('d')
const cappedSeen = capped.filter((item) => item.name === 'capped')
check('LoggerOptions.level=WARN 时只输出 error+warn',
  cappedSeen.map((item) => item.type).join(',') === 'error,warn', cappedSeen)

// 阈值方向：targetLevel < level 才跳过；用 ERROR=0 的 exporter 验证 error 仍进来。
check('targetLevel < level 方向（阈值 0 仍收到 error=0）',
  buckets.get(0).some((item) => item.type === 'error'), buckets.get(0))

const report = { entry, loggerLevelExport: Boolean(mod.LoggerLevel), checks, ok: checks.every((item) => item.ok) }
console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
