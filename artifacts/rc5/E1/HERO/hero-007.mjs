#!/usr/bin/env node
/**
 * E1 · RC5-HERO-007：prefers-reduced-motion → hero 静态呈现（无动画）。
 *
 * 方法：Playwright + 本机 Chrome 的 CDP 媒体模拟（emulateMedia / context.reducedMotion）。
 *  IAB 后端无媒体模拟能力，故不在 IAB 里做；同端口同会话 cookie，真浏览器实拍两态：
 *    - reduce        ：hero 可见、光晕 animation-name=none、无动画元素；
 *    - no-preference ：同一元素 animation-name=eterna-hero-breathe（证明规则不是“本来就没有动画”）。
 * 同时做输入框命中测试（光晕不得盖住输入区）。
 *
 * 用法：node artifacts/rc5/E1/HERO/hero-007.mjs
 */
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '../../../../scripts/rc5-test-client.mjs'

const req = createRequire(join(LANE.repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')

const c = new Case('HERO', 'RC5-HERO-007')
const OUT = join(LANE.evidenceRoot, 'HERO', 'RC5-HERO-007')
mkdirSync(OUT, { recursive: true })

const accounts = loadAccounts(LANE.accountsFile)
const dsh = await bootstrapDshSession(LANE.base, bootTokenFromContainer(LANE.container))
const auth = await login(LANE.base, accounts.admin.account, accounts.admin.password)
c.cmd('POST /login（管理员，cookie 注入浏览器，不在页面打字）', auth.status, `cookie=${auth.cookie ? 'set' : 'missing'}`)
const pairs = `${dsh}; ${auth.cookie}`.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const at = part.indexOf('=')
  return { name: part.slice(0, at), value: part.slice(at + 1) }
})

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
})

async function measure(reducedMotion, shotName) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion, deviceScaleFactor: 1 })
  await context.addCookies(pairs.map(pair => ({ ...pair, url: LANE.base })))
  const page = await context.newPage()
  page.setDefaultTimeout(20_000)
  await page.goto(LANE.base + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-composer-input]', { timeout: 30_000 })
  await page.waitForSelector('[data-eterna-hero-layer]', { timeout: 30_000 })
  await page.waitForTimeout(1_200)
  const value = await page.evaluate(() => {
    const layer = document.querySelector('[data-eterna-hero-layer]')
    const glow = document.querySelector('[data-eterna-hero-glow]')
    const composer = document.querySelector('[data-composer-input]')
    const rect = composer?.getBoundingClientRect()
    const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null
    const animated = [...(layer?.querySelectorAll('*') ?? [])]
      .map(node => ({ cls: node.getAttribute('data-eterna-hero-glow') !== null ? 'glow' : (node.className || node.tagName), animationName: getComputedStyle(node).animationName }))
      .filter(row => row.animationName !== 'none')
    return {
      mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      layerVisible: layer !== null && getComputedStyle(layer).display !== 'none',
      glowAnimation: glow ? getComputedStyle(glow).animationName : 'no-glow',
      glowDuration: glow ? getComputedStyle(glow).animationDuration : '-',
      animatedCount: animated.length,
      animatedNames: animated.map(row => `${row.cls}:${row.animationName}`).slice(0, 4),
      composerHit: hit !== null && (hit === composer || composer?.contains(hit) === true),
    }
  })
  await page.screenshot({ path: join(OUT, shotName), fullPage: false })
  await context.close()
  return value
}

let reduce, normal, row
try {
  reduce = await measure('reduce', 'reduce-1440.png')
  c.cmd('Playwright reducedMotion=reduce → 1440×900 截图 + 计算样式', 0, shape(reduce, 300))
  normal = await measure('no-preference', 'no-preference-1440.png')
  c.cmd('Playwright reducedMotion=no-preference → 1440×900 截图 + 计算样式', 0, shape(normal, 300))

  c.assert('媒体模拟生效（reduce 下 matchMedia=true）', reduce.mediaMatches === true, `matches=${reduce.mediaMatches}`)
  c.assert('reduce：hero 仍在（不是隐藏）', reduce.layerVisible === true, `visible=${reduce.layerVisible}`)
  c.assert('reduce：光晕 animation-name=none', reduce.glowAnimation === 'none', `animation=${reduce.glowAnimation}/${reduce.glowDuration}`)
  c.assert('reduce：hero 子树无任何动画元素', reduce.animatedCount === 0, `animated=${reduce.animatedNames.join(',') || 'none'}`)
  c.assert('对照：no-preference 下同一光晕有 eterna-hero-breathe 动画', normal.mediaMatches === false && /eterna-hero-breathe/.test(normal.glowAnimation),
    `matches=${normal.mediaMatches} animation=${normal.glowAnimation}/${normal.glowDuration}`)
  c.assert('两态下输入框中心均命中可编辑区（光晕不挡）', reduce.composerHit === true && normal.composerHit === true,
    `reduce=${reduce.composerHit} normal=${normal.composerHit}`)

  const pass = reduce.mediaMatches && reduce.layerVisible && reduce.glowAnimation === 'none' && reduce.animatedCount === 0
    && normal.mediaMatches === false && /eterna-hero-breathe/.test(normal.glowAnimation) && reduce.composerHit && normal.composerHit
  row = c.finish({
    status: pass ? STATUS.PASS : STATUS.FAIL,
    title: 'prefers-reduced-motion 下 hero 静态呈现',
    expected: '模拟减弱动效 → 静态呈现；无动画',
    actual: `reduce={animation:${reduce.glowAnimation},animated:${reduce.animatedCount},hit:${reduce.composerHit}}；no-preference={animation:${normal.glowAnimation},hit:${normal.composerHit}}`,
    notes: [
      `lane=${LANE.container}（独立测试容器，未触碰生产）`,
      'CDP 媒体模拟（Playwright reducedMotion）真实切换；对照态证明规则生效而非“本来无动画”',
      '证据截图：reduce-1440.png / no-preference-1440.png（同一账号同一入口）',
    ],
    artifacts: ['reduce-1440.png', 'no-preference-1440.png', 'cmd.log'],
  })
} catch (error) {
  c.note(`执行异常：${String(error?.message ?? error).slice(0, 300)}`)
  row = c.finish({
    status: STATUS.FAIL,
    title: 'prefers-reduced-motion 下 hero 静态呈现',
    expected: '模拟减弱动效 → 静态呈现；无动画',
    actual: `异常：${String(error?.message ?? error).slice(0, 200)}`,
    artifacts: ['cmd.log'],
  })
} finally {
  await browser.close().catch(() => undefined)
}
console.log(`[HERO-007] ${row.status}`)