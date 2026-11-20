#!/usr/bin/env node
/**
 * E2 · RC5-MCPP-024：个人 MCP UI 增删改（双主题 × 三视口，P1）。
 *
 * 用 Playwright 真浏览器（本机 Chrome）+ B 的登录 cookie：
 *   设置 → MCP 服务器 → 我的服务器
 *   1) 新增 HTTP 服务器（header 密钥写入）；
 *   2) 保存后只显示「已设置」，页面 DOM 不含密钥明文；
 *   3) 编辑时密钥输入框为空且 placeholder=留空保持不变；留空再保存仍为「已设置」；
 *   4) 测试连接成功（夹具 echo，1 个工具）；
 *   5) 删除两击确认：第一击后行仍在、按钮变「确认删除?」；第二击后行消失；
 *      全程无原生 confirm()/alert()（监听 dialog 事件计数=0）；
 *   6) 深/浅两主题 × 1440/900/390 三视口截图（6 张）。
 *
 * 前提：lane 白名单含 host.docker.internal；本机 Chrome；测试账号 user_b。
 * 用法：node artifacts/rc5/E2/MCPP/run-extra.mjs --only=024
 */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Case, STATUS, shape } from '../_lib/evidence.mjs'
import { LANE, REPO, call, sessions, sleep } from '../_lib/env.mjs'


const req = createRequire(join(REPO, 'packages/browser-relay/package.json'))
const { chromium } = req('playwright-core')
const HTTP_PORT = 18600 + (process.pid % 300)
const FIXTURE = join(REPO, 'tests', 'fixtures', 'mcp-http-server.mjs')
const SECRET = 'Bearer rc5-ui-secret-7f3a'

async function healthy(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1_000) })
    const body = await response.json().catch(() => ({}))
    return response.ok && body?.tag === 'http-fixture'
  } catch {
    return false
  }
}

async function clickText(page, text) {
  let clicked = false
  for (let attempt = 0; attempt < 50; attempt += 1) {
    clicked = await page.evaluate((wanted) => {
      const scopes = [...document.querySelectorAll('[role=dialog],dialog')]
      if (scopes.length === 0) scopes.push(document)
      for (const dialog of scopes) {
        const visible = [...dialog.querySelectorAll('button,[role=button],a,span,div,label,p,h1,h2,h3,h4')]
          .filter(node => node.getClientRects().length > 0 && (node.textContent || '').trim() === wanted)
        const direct = visible.find(node => node.tagName === 'BUTTON' || node.getAttribute('role') === 'button' || node.tagName === 'A')
        if (direct !== undefined) { direct.click(); return true }
        const leaf = visible.find(node => node.children.length === 0)
        if (leaf === undefined) continue
        let element = leaf
        while (element !== null && element !== dialog && element.tagName !== 'BUTTON'
          && element.getAttribute('role') !== 'button' && element.tagName !== 'A') element = element.parentElement
        ;(element ?? leaf).click()
        return true
      }
      return false
    }, text)
    if (clicked) return
    await sleep(200)
  }
  const debug = await page.evaluate(() => ({
    dialogs: [...document.querySelectorAll('[role=dialog],dialog')].map(d => ({ rects: d.getClientRects().length, text: (d.innerText || '').slice(0, 200) })),
    body: (document.body.innerText || '').slice(-300),
    url: location.href,
  }))
  throw new Error(`找不到可点击文本: ${text} :: ${JSON.stringify(debug)}`)
}

async function openSettings(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForSelector('[aria-label="偏好设置"]', { timeout: 30_000 })
      await page.waitForTimeout(1_200)
      await page.click('[aria-label="偏好设置"]')
      await page.waitForTimeout(2_500)
      await clickText(page, 'MCP 服务器')
      await page.waitForSelector('[data-eterna-mcp-servers]', { timeout: 20_000 })
      return
    } catch (error) {
      if (attempt === 2) throw error
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1_500)
    }
  }
}

export async function run(s) {
  const c = new Case('MCPP', 'RC5-MCPP-024')
  const OUT = join(LANE.evidenceRoot, 'MCPP', 'RC5-MCPP-024')
  mkdirSync(OUT, { recursive: true })
  let child
  let browser
  try {
    const catalog = await call(s.userB.cookie, 'mcp-personal/catalog')
    const hosts = catalog.value?.hostWhitelist ?? []
    c.cmd('POST /api/mcp-personal/catalog（B，前置白名单）', catalog.status, `hostWhitelist=${JSON.stringify(hosts)}`)

    child = spawn(process.execPath, [FIXTURE, '--port', String(HTTP_PORT), '--host', '0.0.0.0'], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.stderr.on('data', () => undefined)
    let up = false
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await healthy(HTTP_PORT)) { up = true; break }
      await sleep(250)
    }
    c.cmd(`node tests/fixtures/mcp-http-server.mjs --port ${HTTP_PORT} --host 0.0.0.0`, up ? 0 : 1, `healthy=${up}`)

    // 复用 sessions() 缓存的完整 cookie（dsh-auth + eterna_session）：避免再登录一次
    // 触发 5/min 限速（429 时页面停在 /login，偏好设置按钮自然不可见）。
    const pairs = s.userB.cookie.split(';').map(part => part.trim()).filter(Boolean).map((part) => {
      const at = part.indexOf('=')
      return { name: part.slice(0, at), value: part.slice(at + 1) }
    })

    browser = await chromium.launch({
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
    await context.addCookies(pairs.map(pair => ({ ...pair, url: LANE.base })))
    let page = await context.newPage()
    page.setDefaultTimeout(25_000)
    const nativeDialogs = []
    page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss().catch(() => undefined) })

    // 清掉同名残留，保证 UI 从干净起点开始（在任何 UI 读取前完成）
    const before = await call(s.userB.cookie, 'mcp-personal/list')
    for (const item of before.value?.items ?? []) {
      if (item.name === 'ui-http') {
        await call(s.userB.cookie, 'mcp-personal/delete', { request: { id: item.id } })
      }
    }

    await page.goto(`${LANE.base}/`, { waitUntil: 'domcontentloaded' })
    await openSettings(page)
    c.cmd('浏览器：登录 B → 设置 → MCP 服务器', 200, 'panel=visible')


    // 1) 新增 HTTP server（header 密钥）
    await clickText(page, '新增服务器')
    await page.waitForSelector('#ea-mcp-name', { timeout: 10_000 })
    await page.fill('#ea-mcp-name', 'ui-http')
    await page.selectOption('#ea-mcp-transport', 'streamable-http')
    await page.fill('#ea-mcp-url', `http://host.docker.internal:${HTTP_PORT}/mcp`)
    await clickText(page, '添加请求头')
    await page.waitForSelector('[aria-label="请求头名称"]', { timeout: 10_000 })
    await page.fill('[aria-label="请求头名称"]', 'Authorization')
    await page.fill('#ea-mcp-header-0', SECRET)
    await clickText(page, '保存')
    await page.waitForFunction(() => document.body.innerText.includes('已保存'), null, { timeout: 20_000 })
    await page.waitForSelector('[data-eterna-mcp-server]', { timeout: 10_000 })
    await page.waitForTimeout(400)
    const afterSave = await page.evaluate(() => ({
      text: document.body.innerText,
      rows: [...document.querySelectorAll('[data-eterna-mcp-server]')].map(row => row.innerText),
    }))
    c.cmd('UI 新增 ui-http（HTTP + Authorization 密钥）→ 保存', 200, shape(afterSave.rows.join(' | '), 300))

    // 2) 编辑：密钥框空、placeholder=留空保持不变；留空保存后仍「已设置」
    await clickText(page, '编辑')
    await page.waitForSelector('#ea-mcp-header-0', { timeout: 10_000 })
    const editState = await page.evaluate(() => ({
      value: document.querySelector('#ea-mcp-header-0')?.value ?? '(none)',
      placeholder: document.querySelector('#ea-mcp-header-0')?.getAttribute('placeholder') ?? '(none)',
    }))
    await clickText(page, '保存')
    await page.waitForTimeout(1_500)
    const afterKeep = await page.evaluate(() => [...document.querySelectorAll('[data-eterna-mcp-server]')].map(row => row.innerText).join(' | '))
    c.cmd('UI 编辑（密钥留空）→ 保存', 200, `value=${editState.value} placeholder=${editState.placeholder} row=${shape(afterKeep, 200)}`)

    // 3) 测试连接
    await clickText(page, '测试')
    await page.waitForFunction(() => /连接成功|连接失败/.test(document.body.innerText), null, { timeout: 30_000 })
    const probeText = await page.evaluate(() => document.body.innerText)
    const probeOk = /连接成功，发现 1 个工具/.test(probeText)
    c.cmd('UI 测试连接（echo 夹具）', 200, probeOk ? '连接成功，发现 1 个工具' : shape(probeText.slice(-300), 200))

    // 4) 外观设为「跟随系统」→ 用 CDP 色彩偏好真实切换深/浅，各自三视口截图。
    //    主题切换会让设置面板重挂载（实测点击主题后弹窗消失），故每轮新建 context，
    //    不依赖在同一个已打开的面板里来回切。
    await clickText(page, '通用设置')
    await clickText(page, '跟随系统')
    await page.waitForTimeout(800)
    await context.close()

    const shots = []
    for (const theme of ['dark', 'light']) {
      const shotContext = await browser.newContext({
        viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: theme,
      })
      await shotContext.addCookies(pairs.map(pair => ({ ...pair, url: LANE.base })))
      page = await shotContext.newPage()
      page.setDefaultTimeout(30_000)
      page.on('dialog', async (dialog) => { nativeDialogs.push(dialog.type()); await dialog.dismiss().catch(() => undefined) })
      await page.goto(`${LANE.base}/`, { waitUntil: 'domcontentloaded' })
      await openSettings(page)
      for (const [width, height] of [[1440, 900], [900, 900], [390, 844]]) {
        await page.setViewportSize({ width, height })
        await page.waitForTimeout(600)
        const name = `${theme}-${width}x${height}.png`
        await page.screenshot({ path: join(OUT, name) })
        shots.push(name)
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      if (theme === 'dark') await shotContext.close()
    }
    c.cmd('截图：深/浅（colorScheme）× 1440/900/390', 0, shots.join(','))

    // 5) 删除两击确认（无原生 confirm）
    const rowBefore = await page.evaluate(() => document.querySelectorAll('[data-eterna-mcp-server]').length)
    await clickText(page, '删除')
    await page.waitForTimeout(400)
    const armed = await page.evaluate(() => ({
      confirmVisible: [...document.querySelectorAll('[data-eterna-mcp-server] button')].some(button => /确认删除/.test(button.textContent ?? '')),
      rows: document.querySelectorAll('[data-eterna-mcp-server]').length,
    }))
    await clickText(page, '确认删除?')
    await page.waitForTimeout(1_200)
    const rowAfter = await page.evaluate(() => document.querySelectorAll('[data-eterna-mcp-server]').length)
    const emptyShown = await page.evaluate(() => document.body.innerText.includes('还没有个人 MCP 服务器'))
    c.cmd('UI 删除（两击）', 200, `rowBefore=${rowBefore} armed=${JSON.stringify(armed)} rowAfter=${rowAfter} empty=${emptyShown} nativeDialogs=${nativeDialogs.length}`)

    // 6) 密钥不落 DOM（在保存后/编辑后都检查）
    const secretInPage = afterSave.text.includes('rc5-ui-secret') || afterKeep.includes('rc5-ui-secret')
    const list = await call(s.userB.cookie, 'mcp-personal/list')
    const remaining = (list.value?.items ?? []).map(item => item.name)
    c.cmd('POST /api/mcp-personal/list（UI 删除后）', list.status, `items=${JSON.stringify(remaining)}`)

    c.assert('前置：白名单含 host.docker.internal', hosts.includes('host.docker.internal'), JSON.stringify(hosts))
    c.assert('UI 保存成功（行内显示已设置）', /已设置/.test(afterSave.rows.join(' ')) && afterSave.rows.length === 1, shape(afterSave.rows.join(' | '), 200))
    c.assert('密钥写入后不回显（DOM 无明文；编辑框为空且 placeholder=留空保持不变）',
      secretInPage === false && editState.value === '' && editState.placeholder === '留空保持不变',
      `secretInPage=${secretInPage} value='${editState.value}' placeholder=${editState.placeholder}`)
    c.assert('留空保存保持原密钥（仍显示已设置）', /已设置/.test(afterKeep), shape(afterKeep, 200))
    c.assert('测试连接成功（echo，1 个工具）', probeOk === true)
    c.assert('六张截图齐备（深/浅 × 三视口）', shots.length === 6, shots.join(','))
    c.assert('删除两击确认：第一击后行仍在且按钮变确认删除', armed.confirmVisible === true && armed.rows === rowBefore)
    c.assert('第二击后行消失、列表回到空态', rowAfter === 0 && emptyShown === true, `rowAfter=${rowAfter} empty=${emptyShown}`)
    c.assert('无原生 confirm()/alert()', nativeDialogs.length === 0, JSON.stringify(nativeDialogs))
    c.assert('删除后 API 列表无残留', remaining.length === 0, JSON.stringify(remaining))

    const pass = hosts.includes('host.docker.internal') && /已设置/.test(afterSave.rows.join(' ')) && afterSave.rows.length === 1
      && secretInPage === false && editState.value === '' && editState.placeholder === '留空保持不变'
      && /已设置/.test(afterKeep) && probeOk && shots.length === 6
      && armed.confirmVisible === true && armed.rows === rowBefore && rowAfter === 0 && emptyShown
      && nativeDialogs.length === 0 && remaining.length === 0
    return c.finish({
      status: pass ? STATUS.PASS : STATUS.FAIL,
      title: '个人 MCP UI 增删改（密钥 write-only / 两击删除 / 双主题三视口）',
      expected: '新增可保存并显示已设置；密钥不回显、留空保持；测试成功；两击删除无原生 confirm；6 张截图',
      actual: `saved=${/已设置/.test(afterSave.rows.join(' '))} secretInDom=${secretInPage} keep=${/已设置/.test(afterKeep)} probe=${probeOk} shots=${shots.length} armed=${armed.confirmVisible}/${armed.rows} deleted=${rowAfter === 0} nativeDialogs=${nativeDialogs.length} remaining=${remaining.length}`,
      notes: [
        `lane=${LANE.container}（独立测试容器，未触碰生产）；HTTP 夹具=host:${HTTP_PORT}`,
        '密钥只以密文落库；UI 只读 hasSecret，编辑时输入框为空 + placeholder=留空保持不变（留空保存不改值）',
        '删除走 ArmedDelete（两击），页面 dialog 事件计数=0，证明未调用原生 confirm()',
        ...shots.map(name => `截图 ${name}`),
      ],
      artifacts: ['cmd.log', ...shots],
    })
  } finally {
    if (browser !== undefined) await browser.close().catch(() => undefined)
    if (child !== undefined) {
      child.kill('SIGTERM')
      await sleep(300)
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    await call(s.userB.cookie, 'mcp-personal/list').then(async (list) => {
      for (const item of list.value?.items ?? []) {
        if (item.name === 'ui-http') await call(s.userB.cookie, 'mcp-personal/delete', { request: { id: item.id } }).catch(() => undefined)
      }
    }).catch(() => undefined)
  }
}