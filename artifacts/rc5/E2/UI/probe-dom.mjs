#!/usr/bin/env node
/** 一次性 DOM 探针：登录 A 后导出页面的可交互元素，供 UI-006 截图脚本选锚点。 */
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LANE } from '../_lib/env.mjs'
import { bootTokenFromContainer, bootstrapDshSession, loadAccounts, login } from '../../../../scripts/rc5-test-client.mjs'

const req = createRequire(join(LANE.repoRoot, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')

const accounts = loadAccounts(LANE.accountsFile)
const dsh = await bootstrapDshSession(LANE.base, bootTokenFromContainer(LANE.container))
const auth = await login(LANE.base, accounts.admin.account, accounts.admin.password)
if (auth.status !== 200) throw new Error(`login=${auth.status}`)

const cookiePairs = `${dsh}; ${auth.cookie}`.split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const index = part.indexOf('=')
  return { name: part.slice(0, index), value: part.slice(index + 1) }
})

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--no-first-run', '--no-default-browser-check'],
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
await context.addCookies(cookiePairs.map(cookie => ({ ...cookie, url: LANE.base })))
const page = await context.newPage()
await page.goto(LANE.base + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const info = await page.evaluate(() => {
  const text = (el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  const buttons = [...document.querySelectorAll('button, [role="button"], a')]
    .map(el => ({ tag: el.tagName, aria: el.getAttribute('aria-label'), title: el.getAttribute('title'), text: text(el), data: [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => `${a.name}=${a.value}`).join(' ') }))
    .filter(item => item.aria || item.text)
  const dataAttrs = [...new Set([...document.querySelectorAll('*')].flatMap(el => [...el.attributes].filter(a => a.name.startsWith('data-')).map(a => a.name)))]
  return { title: document.title, url: location.href, bodyText: (document.body.innerText ?? '').slice(0, 1200), buttons: buttons.slice(0, 80), dataAttrs, htmlLength: document.documentElement.outerHTML.length }
})
console.log(JSON.stringify(info, null, 1).slice(0, 12000))
await page.screenshot({ path: join(LANE.evidenceRoot, 'UI', '_suite', 'probe-1440-light.png'), fullPage: false })
await browser.close()