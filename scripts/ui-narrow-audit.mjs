#!/usr/bin/env node
/**
 * UI 窄窗溢出审计(2026-11-17 composer 按钮溢出回归修复的验收与常驻防线)。
 *
 * 背景:流程启动触发条曾挂 conversation.input.right(契约是"submit 前的紧凑
 * 控件",宿主整组 .trailing{flex:0 0 auto} 不可收缩),655px 的条把右侧组撑到
 * 921px > 卡片 712px(1080 宽),整组越出卡片并被视口 overflow-x 静默裁切——
 * 发送/模型钮"消失"、域 chip 被切一半。修复=触发条迁 conversation.input.dock
 * (卡片上方整宽条)+ 域 chip 截断。本脚本把判据固化成可执行断言。
 *
 * 用法:
 *   node scripts/ui-narrow-audit.mjs [--base https://eternity-electricity.cn:3210]
 *        [--widths 1440,1080,900,760] [--out gui-test-screenshots/ui-narrow]
 *        [--color-scheme light|dark] [--keep-open]
 *
 * 判据(任一不满足 → exit 1):
 *   1. 每个面:document.documentElement.scrollWidth ≤ 视口宽(整页不横向溢出);
 *   2. composer 卡内容不横向溢出(scrollWidth ≤ clientWidth + 2);
 *   3. 任何 [data-eterna-*] 元素右缘 ≤ 视口宽、且不越出 composer 卡(composer 内);
 *   4. 新会话首屏与对话内都存在触发条,且整条落在 composer 卡水平范围内;
 *   5. 发送按钮在视口内(溢出事故的第一现场)。
 *
 * 依赖:playwright-core(复用 packages/browser-relay 已装)+ 仓库内置 CfT
 * Chromium(零新依赖、零浏览器下载)。凭据只从 .env 读入进程内存,不落盘不回显。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const args = process.argv.slice(2)
const pick = (key) => { const i = args.indexOf(key); return i >= 0 ? args[i + 1] : undefined }
const BASE = pick('--base') ?? 'https://eternity-electricity.cn:3210'
const WIDTHS = (pick('--widths') ?? '1440,1080,900,760').split(',').map(value => Number(value.trim())).filter(Number.isFinite)
const OUT = resolve(REPO, pick('--out') ?? 'gui-test-screenshots/ui-narrow')
const SCHEME = pick('--color-scheme') ?? 'light'
const HEIGHT_RATIO = 0.7

const req = createRequire(join(REPO, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')

/** 递归找仓库内置 CfT Chromium 可执行文件(ph-e2e 同款定位)。 */
function findChromiumBinary(dir, depth = 12) {
  if (depth < 0 || !existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) { const found = findChromiumBinary(path, depth - 1); if (found !== null) return found }
    else if (path.endsWith('/Chromium.app/Contents/MacOS/Chromium') || path.endsWith('/chrome')) return path
  }
  return null
}
const CHROME = findChromiumBinary(join(REPO, 'packages/browser-relay/smoke/.browsers/chromium'))
if (CHROME === null) {
  console.error('ui-narrow-audit: 找不到仓库内置 Chromium(packages/browser-relay/smoke/.browsers/chromium)')
  process.exit(1)
}

/** 管理员凭据:主仓 .env(测试实例由同一 .env 播种),只入进程内存。 */
function envValue(text, key) {
  return (text.match(new RegExp(`^${key}=(.*)$`, 'mu'))?.[1] ?? '').trim()
}
const envPath = join(REPO, '.env')
const envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : ''
const ADMIN = {
  account: process.env.ETERNA_ACCESS_ADMIN_USER ?? envValue(envText, 'ETERNA_ACCESS_ADMIN_USER'),
  password: process.env.ETERNA_ACCESS_ADMIN_PASSWORD ?? envValue(envText, 'ETERNA_ACCESS_ADMIN_PASSWORD'),
}

// ── 页面内测量(单一函数,所有面共用) ───────────────────────────────────
function measurePage() {
  const viewportWidth = window.innerWidth
  const docOverflow = document.documentElement.scrollWidth - viewportWidth
  const card = document.querySelector('[data-composer-card]')
  const cardRect = card === null ? null : card.getBoundingClientRect()
  const chips = document.querySelector("[data-eterna-panel='chips']")
  // 主操作钮:空闲=发送(aria 发送消息),回合进行中=停止(同一 .primary 位置)。
  // 类名是 CSS Modules 哈希,uV2eYG_primary 之类——取 _primary 后缀段。
  const send = document.querySelector('[data-composer-card] button[class*="_primary"]')
  const rectOf = (el) => {
    if (el === null) return null
    const r = el.getBoundingClientRect()
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) }
  }

  const offenders = []
  for (const el of document.querySelectorAll('[data-eterna-panel], [data-eterna-memory], [data-eterna-access-root], [data-eterna-workbench], [data-t7-studio-root], [data-eterna-usage-stats], [data-eterna-compaction]')) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    const overRight = r.right - viewportWidth
    const internal = el.scrollWidth - el.clientWidth
    // chip 的 ::after 是外扩 5px/4px 的透明命中区(styles.ts),会让 scrollWidth
    // 多出 4px——属设计而非越界,阈值放到 8px。
    const internalLimit = el.getAttribute('data-eterna-panel') === 'chip' ? 8 : 2
    if (overRight > 1 || internal > internalLimit) {
      offenders.push({
        key: el.getAttribute('data-eterna-panel') ?? el.getAttribute('data-eterna-memory') ?? el.getAttribute('data-eterna-workbench')
          ?? el.getAttribute('data-t7-studio-root') ?? el.getAttribute('data-eterna-usage-stats') ?? el.getAttribute('data-eterna-compaction')
          ?? el.getAttribute('data-eterna-access-root') ?? 'unknown',
        text: (el.textContent ?? '').slice(0, 24),
        right: +r.right.toFixed(1),
        overRight: +overRight.toFixed(1),
        scrollOverflowX: internal,
      })
    }
  }

  return {
    url: location.href,
    viewportWidth,
    docOverflow,
    card: cardRect === null ? null : { x: +cardRect.x.toFixed(1), right: +cardRect.right.toFixed(1), w: +cardRect.width.toFixed(1) },
    cardScrollOverflowX: card === null ? 0 : card.scrollWidth - card.clientWidth,
    chips: rectOf(chips),
    send: rectOf(send),
    offenders,
  }
}

/** 单面断言;返回失败项列表。 */
function assertFace(name, m, options = {}) {
  const failures = []
  if (m.docOverflow > 0) failures.push(`${name}: 整页横向溢出 ${m.docOverflow}px`)
  if (m.cardScrollOverflowX > 2) failures.push(`${name}: composer 卡内容横向溢出 ${m.cardScrollOverflowX}px`)
  for (const o of m.offenders) {
    failures.push(`${name}: ${o.key}("${o.text}") 右缘 ${o.right} / 视口 ${m.viewportWidth}(越界 ${o.overRight}px,内部溢出 ${o.scrollOverflowX}px)`)
  }
  if (options.expectComposer === true) {
    if (m.card === null) failures.push(`${name}: 缺 composer 卡`)
    if (m.chips === null) {
      failures.push(`${name}: 缺流程启动触发条(conversation.input.dock)`)
    } else if (m.card !== null) {
      if (m.chips.right > m.card.right + 1) failures.push(`${name}: 触发条右缘 ${m.chips.right} 越出卡片右缘 ${m.card.right}`)
      if (m.chips.x < m.card.x - 1) failures.push(`${name}: 触发条左缘 ${m.chips.x} 越出卡片左缘 ${m.card.x}`)
      if (m.chips.bottom > m.card.y + 1) failures.push(`${name}: 触发条未落在卡片上方(底 ${m.chips.bottom} > 卡顶 ${m.card.y})`)
    }
    if (m.send === null) failures.push(`${name}: 缺主操作钮(发送/停止)`)
    else {
      if (m.send.right > m.viewportWidth + 1) failures.push(`${name}: 主操作钮右缘 ${m.send.right} 越出视口 ${m.viewportWidth}`)
      if (m.card !== null && m.send.right > m.card.right + 1) failures.push(`${name}: 主操作钮右缘 ${m.send.right} 越出卡片右缘 ${m.card.right}`)
    }
  }
  return failures
}

const results = {}
const failures = []
let browser
try {
  browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
  for (const width of WIDTHS) {
    const height = Math.round(width * HEIGHT_RATIO)
    const dir = join(OUT, `${width}x${height}`)
    mkdirSync(dir, { recursive: true })
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: SCHEME, ignoreHTTPSErrors: true })
    const page = await context.newPage()
    const widthResults = {}

    const snap = async (name, options = {}) => {
      await page.waitForTimeout(1200)
      const measured = await page.evaluate(measurePage)
      widthResults[name] = measured
      failures.push(...assertFace(`${width}:${name}`, measured, options))
      await page.screenshot({ path: join(dir, `${name}.png`) })
    }

    try {
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 45_000 })
      if (await page.locator('#account').isVisible({ timeout: 5000 }).catch(() => false)) {
        if (ADMIN.account === '' || ADMIN.password === '') throw new Error('.env 缺管理员凭据(ETERNA_ACCESS_ADMIN_USER/PASSWORD)')
        await page.fill('#account', ADMIN.account)
        await page.fill('#password', ADMIN.password)
        await page.click('#go')
        await page.waitForURL(url => !String(url).includes('/login'), { timeout: 30_000 })
      }
      await page.waitForTimeout(5000)

      // 侧栏窄窗默认收起:展开到用户常见形态
      const expand = page.locator('[aria-label="打开侧边栏"]').first()
      if (await expand.isVisible().catch(() => false)) { await expand.click(); await page.waitForTimeout(800) }

      // 全新实例首屏是"选择工作区"触发态(整卡是选择器,没有发送钮);
      // 先落一个工作区,让 composer 进入真实可用态再测。
      const workspacePlaceholder = page.getByText('选择工作区', { exact: false }).first()
      if (await workspacePlaceholder.isVisible().catch(() => false)) {
        await workspacePlaceholder.click().catch(() => {})
        await page.waitForTimeout(800)
        const firstWorkspace = page.locator('[role="menuitem"], [role="option"]').first()
        if (await firstWorkspace.isVisible().catch(() => false)) {
          await firstWorkspace.click().catch(() => {})
          await page.waitForTimeout(2000)
        }
      }

      // ① 新会话首屏(hero):触发条必须存在且整条在卡片水平范围内
      await snap('01-hero', { expectComposer: true })

      // ② 对话内(docked composer):点侧栏会话行(role=treeitem,类名含
      // sessionRow;"新会话"行是 hero 态,排除)。按文本点会误中
      // [data-eterna-panel='chip'] 的流程启动条(点了会真的发一轮对话)。
      const sessionRow = page.locator('[role="treeitem"][class*="sessionRow"]')
        .filter({ hasNotText: /^新会话$/u }).first()
      if (await sessionRow.isVisible().catch(() => false)) {
        await sessionRow.click().catch(() => {})
        await page.waitForTimeout(1800)
        await snap('02-session', { expectComposer: true })
      } else if (await page.evaluate(() => {
        // 窄窗侧栏是覆盖抽屉:行在 DOM 里但被抽屉收起隐藏,程序化 click 仍生效
        const row = [...document.querySelectorAll('[role="treeitem"][class*="sessionRow"]')]
          .find(el => !/^新会话$/u.test((el.textContent ?? '').trim()))
        if (row === undefined) return false
        row.click()
        return true
      })) {
        await page.waitForTimeout(1800)
        await snap('02-session', { expectComposer: true })
      } else {
        widthResults['02-session'] = { skipped: '实例内没有既有会话(新库),只断言首屏' }
      }

      // ③ 各业务面
      const nav = async (label, name) => {
        let item = page.locator(`[aria-label="${label}"]`).first()
        if (!(await item.isVisible().catch(() => false))) item = page.getByText(label, { exact: true }).first()
        if (await item.isVisible().catch(() => false)) {
          await item.click().catch(() => {})
          await snap(name)
          return true
        }
        const clicked = await page.evaluate((text) => {
          const el = document.querySelector(`[aria-label="${text}"]`)
          if (el === null) return false
          el.click()
          return true
        }, label)
        if (clicked) { await snap(name); return true }
        return false
      }
      await nav('基座面板', '03-panel')
      await nav('提示词工坊', '04-prompt-studio')
      await nav('用量统计', '05-usage')
      await nav('循环轨迹', '06-observe')

      // ④ 设置弹窗分区(桌面端齿轮 / 窄窗账户菜单或抽屉内程序化 click)
      const settingsOpen = async () => page.getByText('通用设置', { exact: false }).first().isVisible().catch(() => false)
      let opened = false
      const gear = page.locator('[aria-label*="设置"], [title*="设置"]').first()
      if (await gear.isVisible().catch(() => false)) {
        await gear.click().catch(() => {})
        opened = true
      }
      if (!opened) {
        const account = page.locator('[aria-label="账户菜单"]').first()
        if (await account.isVisible().catch(() => false)) {
          await account.click().catch(() => {})
          await page.waitForTimeout(800)
          const item = page.locator('[role="menuitem"]:has-text("设置"), [aria-label*="设置"]').first()
          if (await item.isVisible().catch(() => false)) { await item.click().catch(() => {}); opened = true }
        }
      }
      if (!opened) {
        // 抽屉收起态:入口在 DOM 里但不可见,程序化 click 仍可打开
        await page.evaluate(() => {
          const el = document.querySelector('[aria-label*="设置"], [title*="设置"]')
          if (el !== null) el.click()
        })
        await page.waitForTimeout(1500)
      }
      if (await settingsOpen()) {
        await snap('07-settings-general')
        for (const [label, name] of [['记忆', '08-settings-memory'], ['上下文压缩', '09-settings-compaction'], ['账号', '10-settings-account'], ['用户管理', '11-settings-users'], ['模型', '12-settings-model']]) {
          const tab = page.getByRole('button', { name: label, exact: false }).first()
          if (await tab.isVisible().catch(() => false)) { await tab.click().catch(() => {}); await snap(name) }
        }
      } else {
        widthResults['07-settings-general'] = { skipped: '设置入口不可达(窄窗抽屉态)' }
      }
    } catch (error) {
      failures.push(`${width}: 导航/测量失败 — ${error instanceof Error ? error.message : String(error)}`)
      await page.screenshot({ path: join(dir, 'error.png') }).catch(() => {})
    } finally {
      results[width] = widthResults
      await context.close()
    }
  }
} finally {
  if (browser !== undefined) await browser.close()
}

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, `audit-${SCHEME}.json`), JSON.stringify({ base: BASE, scheme: SCHEME, widths: WIDTHS, results, failures }, null, 2))

for (const [width, faces] of Object.entries(results)) {
  const summary = Object.entries(faces).map(([name, m]) => m.skipped !== undefined ? `${name}:skip` : `${name}:offenders=${m.offenders.length},cardOverflow=${m.cardScrollOverflowX}px`).join(' ')
  console.log(`width=${width}  ${summary}`)
}
if (failures.length > 0) {
  console.error(`\nui-narrow-audit: FAIL(${failures.length} 项)`)
  for (const failure of failures) console.error(`  - ${failure}`)
  console.error(`  证据:${OUT}/audit-${SCHEME}.json 与各面截图`)
  process.exit(1)
}
console.log(`\nui-narrow-audit: PASS(${WIDTHS.length} 档宽度 × ${Object.values(results)[0] ? Object.keys(Object.values(results)[0]).length : 0} 个面)`)
