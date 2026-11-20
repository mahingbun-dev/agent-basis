/**
 * 层序像素断言（B19「z-index 计算在内容之下」）。
 *
 * 取水印本体上的一个点（卡片中心，选离水印包围盒中心最近者）：
 * 1. 正常页：该点像素必须等于不透明卡片底色（内容在水印之上）；
 * 2. 同一页把卡片底色设为透明：该点像素必须偏离卡片底色（证明水印确实
 *    画到这里，第 1 条的"相等"不是空断言）。
 * 再取水印包围盒之外的卡片点做对照。
 */
import { createRequire } from 'node:module'
const require = createRequire('/Users/sunny/code/agent-basis-rc5/packages/browser-relay/package.json')
const { chromium } = require('playwright-core')
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('file:///Users/sunny/code/agent-basis-rc5/artifacts/rc5/p4/hero/harness-light.html')

const points = await page.evaluate(() => {
  const mark = document.querySelector('[data-eterna-hero-mark]').getBoundingClientRect()
  const center = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } }
  const cards = [...document.querySelectorAll('.message')].map(center)
  const markCy = mark.top + mark.height / 2
  const inside = (p) => p.x >= mark.left + 60 && p.x <= mark.right - 60 && p.y >= mark.top + 60 && p.y <= mark.bottom - 60
  const inBolt = [...cards].filter(inside).sort((a, b) => Math.abs(a.y - markCy) - Math.abs(b.y - markCy))[0]
  const outsideBolt = cards.find(p => p.y >= mark.bottom + 20 && p.y < window.innerHeight - 30)
  return {
    mark: { left: mark.left, top: mark.top, width: mark.width, height: mark.height },
    inBolt, outsideBolt,
  }
})

const shot1 = await page.screenshot({ animations: 'disabled' })
await page.addStyleTag({ content: '.message{background:transparent!important;color:transparent!important}.message{border-color:transparent!important}' })
const shot2 = await page.screenshot({ animations: 'disabled' })
await browser.close()

const { chromium: chromium2 } = require('playwright-core')
const b2 = await chromium2.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const p2 = await b2.newPage()
const sampled = await p2.evaluate(async ({ url1, url2, points }) => {
  const load = async (url) => { const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url }); return img }
  const [img1, img2] = await Promise.all([load(url1), load(url2)])
  const ctxFor = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx }
  const read = (ctx, p) => Array.from(ctx.getImageData(p.x, p.y, 1, 1).data)
  const ctx1 = ctxFor(img1)
  const ctx2 = ctxFor(img2)
  return {
    normal_inBolt: read(ctx1, points.inBolt),
    normal_outsideBolt: read(ctx1, points.outsideBolt),
    decoration_inBolt: read(ctx2, points.inBolt),
  }
}, {
  url1: `data:image/png;base64,${shot1.toString('base64')}`,
  url2: `data:image/png;base64,${shot2.toString('base64')}`,
  points,
})
await b2.close()

const sameAsOutside = JSON.stringify(sampled.normal_inBolt) === JSON.stringify(sampled.normal_outsideBolt)
const watermarkPaintsHere = JSON.stringify(sampled.decoration_inBolt) !== JSON.stringify(sampled.normal_inBolt)
const result = { points, sampled, cardCoversWatermark: sameAsOutside, watermarkPaintsAtPoint: watermarkPaintsHere }
console.log(JSON.stringify(result, null, 2))
process.exit(sameAsOutside && watermarkPaintsHere ? 0 : 1)
