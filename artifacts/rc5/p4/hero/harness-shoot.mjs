/**
 * 用无头 Chrome 对 hero 静态对照页截图（双主题 × 1440/900/390）并做命中面/
 * 滚动/层级/断点断言。输出：artifacts/rc5/p4/hero/*.png + assertions.json。
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const ROOT = '/Users/sunny/code/agent-basis-rc5'
const OUT = `${ROOT}/artifacts/rc5/p4/hero`
const require = createRequire(`${ROOT}/packages/browser-relay/package.json`)
const { chromium } = require('playwright-core')

const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '900', width: 900, height: 780 },
  { name: '390', width: 390, height: 780 },
]
const THEMES = ['light', 'dark']

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--disable-gpu', '--no-sandbox'],
})

const results = {}

for (const theme of THEMES) {
  results[theme] = {}
  for (const viewport of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    await page.goto(`file://${OUT}/harness-${theme}.html`)

    const layout = await page.evaluate(() => {
      const layer = document.querySelector('[data-eterna-hero-layer]')
      const frame = document.querySelector('[data-eterna-hero-frame]')
      const root = document.getElementById('root')
      const mark = document.querySelector('[data-eterna-hero-mark]')
      const glow = document.querySelector('[data-eterna-hero-glow]')
      const rings = [...document.querySelectorAll('[data-eterna-hero-ring]')]
      const cs = getComputedStyle(layer)
      const rect = layer.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      return {
        frameDisplay: getComputedStyle(frame).display,
        layer: {
          position: cs.position,
          zIndex: cs.zIndex,
          pointerEvents: cs.pointerEvents,
          top: cs.top,
          left: cs.left,
          right: cs.right,
          bottom: cs.bottom,
        },
        coversRoot: Math.abs(rect.width - rootRect.width) < 1 && Math.abs(rect.height - rootRect.height) < 1,
        ariaHidden: layer.getAttribute('aria-hidden'),
        markOpacity: getComputedStyle(mark).opacity,
        markWidth: getComputedStyle(mark).width,
        ringDisplays: rings.map(ring => getComputedStyle(ring).display),
        glowAnimation: getComputedStyle(glow).animationName,
        headlineMarkSize: document.querySelector('.hero-fish').getAttribute('width'),
      }
    })

    // 先截首屏静止帧，再做交互断言（避免滚动改变取景）。
    await page.screenshot({ path: `${OUT}/hero-${theme}-${viewport.name}.png`, animations: 'disabled' })

    // 滚动：滚轮落在滚动体上 → scrollTop 必须变化。
    const scrollBox = await page.locator('.scroll').boundingBox()
    await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + 40)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(120)
    const scrollTop = await page.evaluate(() => document.querySelector('.scroll').scrollTop)

    // 命中面：把输入卡滚进视口，elementFromPoint 与真实点击都必须落在输入上
    // （品牌层 pointer-events:none → 不挡输入，H13）。
    await page.locator('.composer-input').scrollIntoViewIfNeeded()
    const hit = await page.evaluate(() => {
      const input = document.querySelector('.composer-input')
      const rect = input.getBoundingClientRect()
      const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return {
        hitAtInputCenter: at === null ? null : `${at.tagName.toLowerCase()}${at.className ? `.${String(at.className).split(' ')[0]}` : ''}`,
        hitIsInput: at === input,
        inputVisible: rect.top >= 0 && rect.bottom <= window.innerHeight,
      }
    })
    const inputBox = await page.locator('.composer-input').boundingBox()
    await page.mouse.click(inputBox.x + inputBox.width / 2, inputBox.y + inputBox.height / 2)
    const focused = await page.evaluate(() => document.activeElement?.className ?? null)

    results[theme][viewport.name] = { ...layout, ...hit, focused, scrollTop }
    await page.close()
  }
}

await browser.close()
writeFileSync(`${OUT}/assertions.json`, `${JSON.stringify(results, null, 2)}\n`)
console.log(JSON.stringify(results, null, 2))
