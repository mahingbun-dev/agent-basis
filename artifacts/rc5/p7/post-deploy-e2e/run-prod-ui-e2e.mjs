#!/usr/bin/env node
/**
 * 生产浏览器级 E2E：系统 Chrome（headless）走公网入口（SECURE=1 同源闸要求公网源）。
 *
 * 流程：API 登录取 eterna_session → 容器日志 boot token + /?token= 铸 dsh-auth →
 * 双 cookie 注入浏览器 → 打开 / → 等 composer → 输入「只回复 UI-E2E-OK」回车 →
 * 等页面出现 UI-E2E-OK（真模型回合）→ 截图取证 → 归档该 UI 会话。
 * 证据：ui-evidence.png + result.json（脱敏）。
 */
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { bootTokenFromContainer, bootstrapDshSession, login, request, rpc } from '../../../../scripts/rc5-test-client.mjs'

const BASE = process.env.E2E_BASE ?? 'https://eternity-electricity.cn:3210'
const OUT = '/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/post-deploy-e2e'

const require = createRequire('/Users/sunny/code/agent-basis-rc5/node_modules/.pnpm/playwright-core@1.65.0/node_modules/playwright-core/package.json')
const { chromium } = require('playwright-core')

async function main() {
  const t0 = Date.now()
  const { readFileSync } = await import('node:fs')
  const env = {}
  for (const line of readFileSync('/Users/sunny/code/agent-basis-main-0.2.0-rc.5/.env', 'utf8').split('\n').filter(Boolean)) {
    const at = line.indexOf('=')
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1)
  }
  const admin = await login(BASE, env.ETERNA_ACCESS_ADMIN_USER, env.ETERNA_ACCESS_ADMIN_PASSWORD)
  const dsh = await bootstrapDshSession(BASE, bootTokenFromContainer('eterna-agent'))
  const jar = new Map()
  for (const jarText of [admin.cookie, dsh]) {
    for (const pair of jarText.split('; ')) {
      const at = pair.indexOf('=')
      if (at > 0) jar.set(pair.slice(0, at), pair.slice(at + 1))
    }
  }
  const cookieHeader = [...jar].map(([key, value]) => `${key}=${value}`).join('; ')
  const cookies = [...jar].map(([name, value]) => ({ name, value, domain: 'eternity-electricity.cn', path: '/' }))

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addCookies(cookies)
    const page = await context.newPage()
    const consoleErrors = []
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 160)) })
    page.on('pageerror', error => consoleErrors.push(`pageerror: ${String(error).slice(0, 160)}`))

    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(2_000)
    const url = page.url()
    let composer = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 20_000 }).catch(() => undefined)
    /* 先点「新会话」，避免应用把回合追加进最近会话（既有会话保持原样） */
    let freshSession = false
    if (composer !== undefined) {
      freshSession = await page.getByText('新会话', { exact: true }).first().click({ timeout: 5_000 }).then(() => true).catch(() => false)
      if (freshSession) {
        await page.waitForTimeout(1_500)
        composer = await page.waitForSelector('textarea, [contenteditable="true"]', { timeout: 15_000 }).catch(() => composer)
      }
    }
    const shot0 = `${OUT}/ui-evidence-loaded.png`
    await page.screenshot({ path: shot0, fullPage: false })

    let turnOk = false
    let turnDetail = 'composer 未找到'
    let serverAssistantHit = false
    let serverSessionId = '-'
    if (composer !== undefined) {
      await composer.click()
      await composer.fill('不要调用任何工具。直接只回复一行：UI-E2E-OK')
      await composer.press('Enter')
      const deadline = Date.now() + 150_000
      while (Date.now() < deadline) {
        await page.waitForTimeout(3_000)
        const body = await page.evaluate(() => document.body?.innerText ?? '')
        /* 用户气泡本身含标记 1 处；助手回复上屏后 >=2 处才判回合完成 */
        const occurrences = typeof body === 'string' ? (body.match(/UI-E2E-OK/g) ?? []).length : 0
        if (occurrences >= 2) { turnOk = true; turnDetail = `页面出现助手回复（标记出现 ${occurrences} 处 = 用户气泡 + 助手）`; break }
      }
      if (!turnOk) turnDetail = `150s 内助手回复未上屏（url=${page.url().slice(0, 80)}）`
      /* 服务端独立确认：会话事件里有 role=assistant 且文本含标记 */
      try {
        const list = await rpc(BASE, cookieHeader, 'session/list', {})
        const items = list.value?.items ?? []
        const target = items.find(row => row?.running === true) ?? items[0]
        if (target?.sessionId !== undefined) {
          const events = await rpc(BASE, cookieHeader, 'session/events', {
            request: { address: { kind: 'session', sessionId: target.sessionId }, maxMessages: 40 },
          })
          for (const rec of events.value?.records ?? []) {
            const message = rec?.event?.data?.message
            if (message?.role !== 'assistant') continue
            for (const part of Array.isArray(message.content) ? message.content : []) {
              if (part?.type === 'text' && typeof part.text === 'string' && part.text.includes('UI-E2E-OK')) serverAssistantHit = true
            }
          }
          serverSessionId = String(target.sessionId)
        }
      } catch (error) { turnDetail += `；服务端确认异常 ${String(error).slice(0, 80)}` }
    }
    const shot1 = `${OUT}/ui-evidence-reply.png`
    await page.screenshot({ path: shot1, fullPage: false }).catch(() => undefined)

    /* 清理：归档 UI 会话（取 session/list 最新一条标题含 UI-E2E 的） */
    let archived = 'skipped'
    try {
      const list = await rpc(BASE, cookieHeader, 'session/list', {})
      const items = list.value?.items ?? []
      const mine = items.filter(row => typeof row?.title === 'string' && row.title.includes('UI-E2E-OK')).at(-1)
      if (mine?.sessionId !== undefined) {
        const done = await rpc(BASE, cookieHeader, 'workspace/archiveSession', { request: { sessionId: mine.sessionId } })
        archived = `archive=${done.ok}`
      } else archived = 'target-not-found'
    } catch (error) { archived = String(error).slice(0, 80) }

    const result = {
      base: BASE,
      landedUrl: url,
      loggedIn: url.includes('/login') === false,
      composerFound: composer !== undefined,
      freshSession,
      turnOk,
      turnDetail,
      serverAssistantHit,
      serverSessionId,
      consoleErrors: consoleErrors.slice(0, 8),
      archived,
      durationMs: Date.now() - t0,
    }
    writeFileSync(`${OUT}/ui-result.json`, `${JSON.stringify(result, null, 2)}\n`)
    console.log(JSON.stringify(result, null, 2))
    process.exit(result.loggedIn && result.composerFound && result.turnOk && result.serverAssistantHit === true ? 0 : 1)
  } finally {
    await browser.close()
  }
}

main().catch(error => { console.error('UI E2E 异常:', error); process.exit(2) })
