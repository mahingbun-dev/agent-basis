#!/usr/bin/env node
/**
 * 发布说明门禁(55 号 §5.2,G-RN-01..12)。
 *
 * 用法:
 *   node scripts/release-notes-gate.mjs                  # 校验 VERSION 指向的版本
 *   node scripts/release-notes-gate.mjs --version=0.2.1  # 指定版本(发布演练/历史复查)
 *   node scripts/release-notes-gate.mjs --hash           # 用资产实算 sha256 回填 release.json
 *   node scripts/release-notes-gate.mjs --json           # 机器可读输出(CI 摘要)
 *
 * 退出码:0 全过 / 1 有断言失败 / 2 用法错误。
 *
 * 纪律:
 * - 零第三方依赖(图片尺寸用手写头解析:PNG IHDR / JPEG SOF / WebP VP8·VP8L·VP8X);
 * - 只读校验 + `--hash` 一个明确写面(仅改 media.sha256 字段);
 * - 通过时写 `releases/<v>/.gate.json`(清单与资产整体摘要),供部署后比对与留痕。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releasesRoot = join(repoRoot, 'releases')

/** 语义化版本(允许预发布后缀)。 */
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9a-z.]+)?$/
const IMAGE_EXT = new Set(['webp', 'png', 'jpg', 'jpeg'])
const ALL_EXT = new Set([...IMAGE_EXT, 'webm'])
const MAX_IMAGE_BYTES = 600 * 1024
const MAX_MOTION_BYTES = 2 * 1024 * 1024
const MAX_RELEASE_BYTES = 6 * 1024 * 1024
const MAX_SLIDES = 8
const MIN_SLIDES = 3
const MAX_TITLE = 18
const MAX_BODY = 120
const MAX_FACT = 24
const MAX_FACTS = 4
const MAX_CAPTION = 40
const BANNED = [
  { pattern: /\bdsh-[a-z0-9-]+/i, hint: '内部代号 dsh-*' },
  { pattern: /\bPR\s*#\d+/i, hint: '内部 PR 号' },
  { pattern: /\bsession-[a-z0-9-]+/i, hint: '内部 session id' },
  { pattern: /\bTODO\b/i, hint: '未完成的 TODO' },
  { pattern: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u, hint: 'emoji' },
  { pattern: /https?:\/\/[^\s]*localhost/i, hint: '内部地址' },
]

function fail(message) {
  console.error(`release-notes-gate: ${message}`)
  process.exit(2)
}

function argValue(name) {
  const hit = process.argv.find(argument => argument.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}

const asJson = process.argv.includes('--json')
const backfill = process.argv.includes('--hash')
const explicitVersion = argValue('version')

const version = explicitVersion ?? (() => {
  try {
    return readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim()
  } catch {
    fail('缺少仓库根 VERSION 文件')
  }
})()

if (!VERSION_RE.test(version)) fail(`VERSION 内容非法: ${JSON.stringify(version)}`)

const releaseDir = join(releasesRoot, version)
const manifestPath = join(releaseDir, 'release.json')
const assetsDir = join(releaseDir, 'assets')

/** 检查项结果;顺序即编号 G-RN-01..12。 */
const checks = []
function check(id, title, run) {
  const findings = []
  try {
    run(finding => { if (typeof finding === 'string') findings.push(finding) })
  } catch (error) {
    findings.push(`检查器异常: ${error instanceof Error ? error.message : String(error)}`)
  }
  checks.push({ id, title, ok: findings.length === 0, findings })
}
const length = (text) => [...text].length

// ── 图片尺寸(零依赖头解析)──────────────────────────────────────────────
function imageSize(bytes) {
  // PNG:IHDR 宽高在 16..24(大端)
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  }
  // JPEG:扫段找 SOF0/1/2/3/5/6/7/9/A/B/D/E/F
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue }
      const size = bytes.readUInt16BE(offset + 2)
      const isSof = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
        || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
      if (isSof) return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) }
      offset += 2 + size
    }
    return undefined
  }
  // WebP:RIFF....WEBP + VP8 / VP8L / VP8X
  if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16)
    if (chunk === 'VP8X') {
      return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    }
    if (chunk === 'VP8 ') {
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined
      return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    }
    if (chunk === 'VP8L') {
      if (bytes[20] !== 0x2f) return undefined
      const b0 = bytes[21]
      const b1 = bytes[22]
      const b2 = bytes[23]
      const b3 = bytes[24]
      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      }
    }
    return undefined
  }
  return undefined
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

// ── 清单读取(01)───────────────────────────────────────────────────────
let manifest
let manifestRaw = ''
check('G-RN-01', 'release.json 存在且为合法 JSON', (report) => {
  if (!existsSync(manifestPath)) {
    report(`缺少 ${manifestPath.replace(repoRoot, '.')} —— 每个版本必须有说明(哪怕是「修复若干问题」)`)
    return
  }
  manifestRaw = readFileSync(manifestPath, 'utf8')
  try {
    manifest = JSON.parse(manifestRaw)
  } catch (error) {
    report(`release.json 不是合法 JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
})

if (manifest === undefined) {
  finish()
}

const slides = Array.isArray(manifest.slides) ? manifest.slides : []
const features = slides.filter(slide => slide?.kind === 'feature')
const declaredMedia = slides.flatMap(slide => (slide?.media === undefined ? [] : [{ slide, media: slide.media }]))

if (backfill) {
  const changed = backfillHashes()
  if (!asJson) console.log(`--hash: 回填 ${changed} 个 media.sha256`)
}

// ── 02 版本一致 ─────────────────────────────────────────────────────────
check('G-RN-02', 'manifest.version === VERSION', (report) => {
  if (manifest.version !== version) report(`manifest.version=${String(manifest.version)} 与 VERSION=${version} 不一致(复制上一版忘改?)`)
})

// ── 03 日期 ────────────────────────────────────────────────────────────
check('G-RN-03', 'releasedAt 为 ISO 日期且不超过今天 +1 天', (report) => {
  const value = manifest.releasedAt
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    report(`releasedAt=${JSON.stringify(value)} 应为 YYYY-MM-DD`)
    return
  }
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) { report(`releasedAt=${value} 不是真实日期`); return }
  const limit = new Date(Date.now() + 24 * 60 * 60 * 1000)
  if (date.getTime() > limit.getTime()) report(`releasedAt=${value} 超过今天 +1 天(未来日期不能当已发布)`)
})

// ── 04 页数与首尾形态 ──────────────────────────────────────────────────
check('G-RN-04', `slides 长度 ${MIN_SLIDES}–${MAX_SLIDES},首 cover / 尾 end / 至少 1 个 feature`, (report) => {
  if (slides.length < MIN_SLIDES || slides.length > MAX_SLIDES) report(`slides=${slides.length},超出 ${MIN_SLIDES}–${MAX_SLIDES}`)
  if (slides[0]?.kind !== 'cover') report('第一页必须是 cover')
  if (slides[slides.length - 1]?.kind !== 'end') report('最后一页必须是 end')
  if (features.length < 1) report('至少需要 1 个 feature 页')
  const ids = slides.map(slide => slide?.id)
  if (new Set(ids).size !== ids.length) report('slide.id 有重复')
})

// ── 05 文案规范 ────────────────────────────────────────────────────────
check('G-RN-05', 'feature 的 kicker/title/body 非空且在字数内;facts/标题/图注达标', (report) => {
  if (features.length === 0) report('没有 feature 页可校验文案')
  for (const [index, slide] of slides.entries()) {
    const where = `slides[${index}](${String(slide?.id)})`
    const title = slide?.title
    if (typeof title !== 'string' || title.trim() === '') { report(`${where}: title 必填`); continue }
    if (length(title) > MAX_TITLE) report(`${where}: title ${length(title)} 字 > ${MAX_TITLE}`)
    assertBanned(title, `${where}.title`, report)
    if (slide.kind !== 'feature') continue
    if (typeof slide.kicker !== 'string' || slide.kicker.trim() === '') report(`${where}: kicker 必填`)
    const body = slide.body
    if (typeof body !== 'string' || body.trim() === '') report(`${where}: body 必填`)
    else {
      if (length(body) > MAX_BODY) report(`${where}: body ${length(body)} 字 > ${MAX_BODY}`)
      assertBanned(body, `${where}.body`, report)
    }
    if (slide.facts !== undefined) {
      if (!Array.isArray(slide.facts)) report(`${where}: facts 必须是数组`)
      else {
        if (slide.facts.length > MAX_FACTS) report(`${where}: facts ${slide.facts.length} 条 > ${MAX_FACTS}`)
        for (const fact of slide.facts) {
          if (typeof fact !== 'string' || fact.trim() === '') report(`${where}: facts 不能为空串`)
          else {
            if (length(fact) > MAX_FACT) report(`${where}: fact「${fact}」${length(fact)} 字 > ${MAX_FACT}`)
            assertBanned(fact, `${where}.facts`, report)
          }
        }
      }
    }
  }
  if (!Array.isArray(manifest.highlights) || manifest.highlights.length !== 3) report(`封面亮点必须恰好 3 枚(当前 ${Array.isArray(manifest.highlights) ? manifest.highlights.length : '缺失'})`)
  if (typeof manifest.theme !== 'string' || manifest.theme.trim() === '') report('theme 必填')
  if (typeof manifest.summary !== 'string' || manifest.summary.trim() === '') report('summary 必填')
  if (typeof manifest.summary === 'string') assertBanned(manifest.summary, 'summary', report)
  if (typeof manifest.announce !== 'boolean') report('announce 必须是布尔')
})

// ── 06 引用落在 assets/ 且扩展名白名单 ─────────────────────────────────
check('G-RN-06', 'media.src 命中 assets/ 且扩展名 ∈ {webp,png,jpg,jpeg}', (report) => {
  for (const { slide, media } of declaredMedia) {
    const src = media?.src
    const where = `slides(${String(slide?.id)}).media`
    if (typeof src !== 'string' || src === '') { report(`${where}: src 必填`); continue }
    if (src.includes('/') || src.includes('\\') || src.startsWith('.')) { report(`${where}: src 只允许文件名(${src})`); continue }
    const ext = src.split('.').pop()?.toLowerCase() ?? ''
    if (!IMAGE_EXT.has(ext)) { report(`${where}: src 扩展名 ${ext} 不在图片白名单`); continue }
    if (!existsSync(join(assetsDir, src))) report(`${where}: 文件不存在 assets/${src}`)
  }
})

// ── 07 图片尺寸/比例/单张大小 ──────────────────────────────────────────
check('G-RN-07', '图片 ≥1200×750、比例 1.5–1.75、单张 ≤600KB', (report) => {
  for (const { slide, media } of declaredMedia) {
    const src = media?.src
    if (typeof src !== 'string') continue
    const path = join(assetsDir, src)
    if (!existsSync(path)) continue
    const bytes = readFileSync(path)
    const where = `assets/${src}`
    if (bytes.length > MAX_IMAGE_BYTES) report(`${where}: ${(bytes.length / 1024).toFixed(0)}KB > 600KB`)
    const size = imageSize(bytes)
    if (size === undefined) { report(`${where}: 无法解析尺寸(不是有效 PNG/JPEG/WebP)`); continue }
    if (size.width < 1200 || size.height < 750) report(`${where}: ${size.width}×${size.height} 小于 1200×750`)
    const ratio = size.width / size.height
    if (ratio < 1.5 || ratio > 1.75) report(`${where}: 比例 ${ratio.toFixed(2)} 超出 1.5–1.75(16:10 是 1.6)`)
    void slide
  }
})

// ── 08 哈希 ────────────────────────────────────────────────────────────
check('G-RN-08', 'media.sha256 与文件实算一致(--hash 回填)', (report) => {
  for (const { slide, media } of declaredMedia) {
    const src = media?.src
    if (typeof src !== 'string') continue
    const path = join(assetsDir, src)
    if (!existsSync(path)) continue
    const actual = sha256(readFileSync(path))
    if (media.sha256 === undefined || media.sha256 === '') {
      report(`slides(${String(slide?.id)}).media.sha256 缺失(跑一次 --hash 回填)`)
    } else if (media.sha256 !== actual) {
      report(`slides(${String(slide?.id)}).media.sha256 与 assets/${src} 不一致(换图后没回填?)`)
    }
  }
  // 采集流水线留痕:存在 .shots.json 时,逐文件哈希必须与资产一致。
  const shotsPath = join(releaseDir, '.shots.json')
  if (existsSync(shotsPath)) {
    try {
      const shots = JSON.parse(readFileSync(shotsPath, 'utf8'))
      const files = shots?.files ?? {}
      for (const [name, expected] of Object.entries(files)) {
        const path = join(assetsDir, name)
        if (!existsSync(path)) { report(`.shots.json 引用的 assets/${name} 不存在`); continue }
        if (typeof expected === 'string' && sha256(readFileSync(path)) !== expected) report(`assets/${name} 与 .shots.json 记录不一致(手工替换?请重跑 release-shots)`)
      }
    } catch {
      report('.shots.json 存在但不是合法 JSON')
    }
  }
})

// ── 09 无障碍与动图 ────────────────────────────────────────────────────
check('G-RN-09', 'media.alt 必填;caption ≤40 字;motion 必须配 poster 且 ≤2MB', (report) => {
  for (const { slide, media } of declaredMedia) {
    const where = `slides(${String(slide?.id)}).media`
    if (typeof media?.alt !== 'string' || media.alt.trim() === '') report(`${where}: alt 必填(无障碍)`)
    else assertBanned(media.alt, `${where}.alt`, report)
    if (media.caption !== undefined) {
      if (typeof media.caption !== 'string') report(`${where}: caption 必须是字符串`)
      else if (length(media.caption) > MAX_CAPTION) report(`${where}: caption ${length(media.caption)} 字 > ${MAX_CAPTION}`)
      else assertBanned(media.caption, `${where}.caption`, report)
    }
    if (media.motion !== undefined) {
      const motion = media.motion
      if (typeof motion !== 'string' || !ALL_EXT.has(motion.split('.').pop()?.toLowerCase() ?? '')) {
        report(`${where}: motion 必须是 assets/ 内的 webm`)
        continue
      }
      const path = join(assetsDir, motion)
      if (!existsSync(path)) { report(`${where}: 动图 assets/${motion} 不存在`); continue }
      const bytes = statSync(path).size
      if (bytes > MAX_MOTION_BYTES) report(`assets/${motion}: ${(bytes / 1024).toFixed(0)}KB > 2MB`)
      if (typeof media.src !== 'string' || !existsSync(join(assetsDir, media.src))) {
        report(`${where}: 有 motion 却没有可用 poster(src)`)
      }
    }
  }
})

// ── 10 总量与孤儿资产 ──────────────────────────────────────────────────
check('G-RN-10', '单版资产合计 ≤6MB,assets/ 内无未引用孤儿', (report) => {
  if (!existsSync(assetsDir)) { report('assets/ 目录不存在'); return }
  const names = readdirSync(assetsDir).filter(name => statSync(join(assetsDir, name)).isFile())
  const referenced = new Set()
  for (const { media } of declaredMedia) {
    if (typeof media?.src === 'string') referenced.add(media.src)
    if (typeof media?.motion === 'string') referenced.add(media.motion)
  }
  let total = 0
  for (const name of names) {
    total += statSync(join(assetsDir, name)).size
    if (!referenced.has(name)) report(`assets/${name} 未被 release.json 引用(孤儿文件)`)
  }
  if (total > MAX_RELEASE_BYTES) report(`资产合计 ${(total / 1024 / 1024).toFixed(2)}MB > 6MB`)
})

// ── 11 禁用词 ──────────────────────────────────────────────────────────
check('G-RN-11', '禁用词扫描(dsh- / PR # / session- / TODO / emoji / 内部地址)', (report) => {
  const texts = [
    ['theme', manifest.theme],
    ['summary', manifest.summary],
    ...(Array.isArray(manifest.highlights) ? manifest.highlights.map((item, index) => [`highlights[${index}].text`, item?.text]) : []),
    ...slides.flatMap((slide, index) => [
      [`slides[${index}].title`, slide?.title],
      [`slides[${index}].kicker`, slide?.kicker],
      [`slides[${index}].body`, slide?.body],
      [`slides[${index}].footerNote`, slide?.footerNote],
      ...(Array.isArray(slide?.facts) ? slide.facts.map((fact, factIndex) => [`slides[${index}].facts[${factIndex}]`, fact]) : []),
      ...(Array.isArray(slide?.links) ? slide.links.flatMap((link, linkIndex) => [
        [`slides[${index}].links[${linkIndex}].label`, link?.label],
        [`slides[${index}].links[${linkIndex}].note`, link?.note],
      ]) : []),
    ]),
    ...declaredMedia.flatMap(({ slide, media }) => [
      [`slides(${String(slide?.id)}).media.alt`, media?.alt],
      [`slides(${String(slide?.id)}).media.caption`, media?.caption],
      [`slides(${String(slide?.id)}).media.notes`, media?.notes],
    ]),
  ]
  for (const [label, value] of texts) {
    if (typeof value === 'string') assertBanned(value, label, report)
  }
})

// ── 12 公告语义 ────────────────────────────────────────────────────────
check('G-RN-12', 'announce:false 只允许预发布版本;正式版必须 true', (report) => {
  const prerelease = version.includes('-')
  if (manifest.announce === false && !prerelease) report(`正式版 ${version} 不能 announce:false(要么公告,要么升一个 rc 版本号)`)
  if (manifest.announce !== true && manifest.announce !== false) report(`announce=${JSON.stringify(manifest.announce)} 必须是布尔`)
})

function assertBanned(text, label, report) {
  for (const { pattern, hint } of BANNED) {
    const hit = text.match(pattern)
    if (hit !== null) report(`${label}: 含禁用词「${hit[0]}」(${hint})`)
  }
}

// ── --hash 回填(只改 media.sha256)────────────────────────────────────
function backfillHashes() {
  if (manifest === undefined) return 0
  let changed = 0
  for (const { media } of declaredMedia) {
    const src = media?.src
    if (typeof src !== 'string') continue
    const path = join(assetsDir, src)
    if (!existsSync(path)) continue
    const actual = sha256(readFileSync(path))
    if (media.sha256 !== actual) {
      media.sha256 = actual
      changed += 1
    }
  }
  if (changed > 0) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return changed
}

// ── 汇总 ──────────────────────────────────────────────────────────────
function finish() {
  const failed = checks.filter(item => !item.ok)
  const size = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter(name => statSync(join(assetsDir, name)).isFile())
      .reduce((total, name) => total + statSync(join(assetsDir, name)).size, 0)
    : 0
  if (asJson) {
    console.log(JSON.stringify({
      version,
      ok: failed.length === 0,
      checks,
      slides: slides.length,
      features: features.length,
      assetBytes: size,
    }, null, 2))
  } else {
    for (const item of checks) {
      if (item.ok) console.log(`PASS ${item.id}  ${item.title}`)
      else {
        console.log(`FAIL ${item.id}  ${item.title}`)
        for (const finding of item.findings) console.log(`     · ${finding}`)
      }
    }
    if (failed.length === 0) {
      console.log('')
      console.log(`PASS ${checks.length}/${checks.length} · ${version} · ${features.length} features · ${(size / 1024 / 1024).toFixed(2)}MB`)
    } else {
      console.log('')
      console.log(`FAIL ${failed.length}/${checks.length} 项未过 — 修完再部署(55 号 §5)`)
    }
  }
  if (failed.length === 0 && manifest !== undefined) {
    const digest = sha256(Buffer.from(JSON.stringify(manifest)))
    writeFileSync(join(releaseDir, '.gate.json'), `${JSON.stringify({
      version, checkedAt: new Date().toISOString(), manifestSha256: digest, slides: slides.length, features: features.length, assetBytes: size,
    }, null, 2)}\n`)
  }
  process.exit(failed.length === 0 ? 0 : 1)
}

if (checks.length + 1 < 12) fail('内部错误:检查项未全部注册')
finish()
