#!/usr/bin/env node
/**
 * 发布说明截图流水线(55 号 §3.3,D5)。
 *
 * 用法:
 *   node scripts/release-shots.mjs [--version=0.2.1] [--form=base|super]
 *                                  [--out=<dir>] [--plan=<file>] [--keep] [--strict]
 *
 * 它做四件事:
 *   1. 真启动一份**隔离**实例(临时 DSH_HOME + 播种管理员 + OS 分配端口),不碰生产数据根;
 *   2. playwright-core 驱动 Chrome(headless,1440×900,浅色)按 `shots.plan.json` 走界面;
 *   3. 用 Playwright **原生 webp** 输出(1.65 起支持 `type:'webp'`,不需要 cwebp/sharp);
 *   4. 写 `.shots.json`(逐文件 sha256/浏览器/视口)并回填 release.json 的 media.sha256。
 *
 * 纪律:
 * - 场景失败不伪造图:默认跳过该场景并汇总(报告里写明原因);`--strict` 则失败退出。
 * - CI 用 `--out` 指到仓库外(产物走 artifact),**不自动提交**截图——落库属发布动作。
 * - 启动与登录都走真实路径:/login 表单 + 播种管理员(不依赖本机 .env 与生产凭据)。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9a-z.]+)?$/
const SHOTS_USER = 'shots-admin'
const SHOTS_PASSWORD = 'Shots-Admin-2026'
const VIEWPORT = { width: 1440, height: 900 }
// 验收用:--viewport=760x900 / --color-scheme=dark(正式素材固定 1440×900 浅色)。
const viewportArg = argValue('viewport')
const colorScheme = argValue('color-scheme') ?? 'light'

function argValue(name) {
  const hit = process.argv.find(argument => argument.startsWith(`--${name}=`))
  return hit === undefined ? undefined : hit.slice(name.length + 3)
}

const version = argValue('version') ?? (() => {
  try {
    return readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim()
  } catch {
    console.error('release-shots: 缺 VERSION 且未传 --version')
    process.exit(2)
  }
})()
if (!VERSION_RE.test(version)) {
  console.error(`release-shots: 版本号非法 ${version}`)
  process.exit(2)
}
const form = argValue('form') ?? 'base'
if (form !== 'base' && form !== 'super') {
  console.error(`release-shots: --form 只支持 base|super(实得 ${form})`)
  process.exit(2)
}
const strict = process.argv.includes('--strict')
const keep = process.argv.includes('--keep')
const releaseDir = join(repoRoot, 'releases', version)
const outDir = resolve(argValue('out') ?? join(releaseDir, 'assets'))
const planPath = resolve(argValue('plan') ?? join(releaseDir, 'shots.plan.json'))
// 隔离 home **必须落在仓库外**:dsh 按 profile 目录向上解析 bundle 名,home 在仓库内时
// 会先撞到仓库 node_modules 里的依赖副本(本机曾因此解析到过期 @deepseek-ai/dsh-session,
// 版本不兼容直接拒载)。容器里 DSH_HOME=/data 同理在 /repo 之外。
const home = resolve(process.env.RELEASE_SHOTS_HOME ?? join(tmpdir(), `eterna-release-shots-${form}`))
const profileName = form === 'super' ? 'eterna-super' : 'eterna-web'
const profileDir = join(home, 'profiles', profileName)
const templatePath = join(repoRoot, 'docker', 'profile', form === 'super' ? 'cordis.super.patch.yml.template' : 'cordis.patch.yml.template')
// dsh 运行时可换(D5 CI 与本地同一条命令;`RELEASE_SHOTS_DSH` 指到任意一份安装的
// `@deepseek-ai/dsh/lib/bin.js`)。默认用仓库 devDependency 那份。
// 为什么需要这个口子:pnpm 的 autoInstallPeers:false 让 rc.1 内核树的部分 peer
// (dsh-attachment/dsh-jobs/...)不落盘,启动整树 pending——这是本机 install 状态问题;
// 容器镜像与 CI 的 npm 扁平树不受影响(npm 装 peer)。本地排障时用一份 npm 扁平
// 安装即可(`npm i --prefix /tmp/shots-dsh @deepseek-ai/dsh@<版>`)。
const dshBin = resolve(process.env.RELEASE_SHOTS_DSH ?? join(repoRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
// 与 bin.js 同级的那层 `@deepseek-ai` 目录:仓库 pnpm symlink 与 npm 扁平安装同形。
const dshFamilyDir = resolve(dirname(dshBin), '..', '..')

/** 各页「截哪一屏」的剧本。默认覆盖 0.2.1 的四个功能页;失败即跳过并报原因。 */
const DEFAULT_PLAN = {
  viewport: VIEWPORT,
  scenes: [
    {
      id: 'clear',
      file: '01-clear.webp',
      steps: [
        { goto: '/' },
        { waitFor: '[data-eterna-access-role]' },
        { closeReleaseNotes: true },
        { click: { text: '新会话', exact: true } },
        { click: { selector: 'textarea, [contenteditable="true"]' } },
        { type: '/cl' },
        { waitForText: '清空当前会话上下文' },
        { waitMs: 400 },
      ],
    },
    {
      id: 'tasks',
      file: '02-tasks.webp',
      form: 'super',
      steps: [
        { goto: '/' },
        { waitFor: '[data-eterna-access-role]' },
        { closeReleaseNotes: true },
        { click: { text: '工作台', exact: true } },
        { waitMs: 1200 },
      ],
    },
    {
      id: 'plugins',
      file: '03-plugins.webp',
      steps: [
        { goto: '/' },
        { waitFor: '[data-eterna-access-role]' },
        { closeReleaseNotes: true },
        { click: { text: '插件', exact: true } },
        { waitForText: '恒灵插件' },
        // 恒灵插件 tab = 红线 + 功能插件家族(插件页故事的代表画面)
        { click: { text: '恒灵插件', exact: true } },
        { waitForText: '治理基座' },
        { waitMs: 400 },
      ],
    },
    {
      id: 'providers',
      file: '04-providers.webp',
      steps: [
        { goto: '/' },
        { waitFor: '[data-eterna-access-role]' },
        { closeReleaseNotes: true },
        { click: { selector: 'button[aria-label="偏好设置"]' } },
        { click: { text: '模型', exact: true } },
        { waitMs: 800 },
      ],
    },
  ],
}

function log(message) {
  console.log(`[release-shots] ${message}`)
}

// ── 1. 隔离实例的 profile 物化(与 entrypoint 第 2/3/4 步同口径)──────────
const BASE_PACKAGES = ['glue', 'llm-doctor', 'brand', 'panel', 'prompt-studio', 'llm-openai', 'access', 'usage-stats', 'compaction', 'attachments', 'memory', 'governance', 'adviser']
const SUPER_PACKAGES = ['tasks', 'channels', 'interact', 'workbench', 'toolkit']

function materializeProfile() {
  if (!existsSync(dshBin)) {
    throw new Error(`dsh CLI 不存在(${dshBin});先 pnpm install`)
  }
  if (!existsSync(templatePath)) throw new Error(`缺 patch 模板 ${templatePath}`)
  rmSync(profileDir, { recursive: true, force: true })
  mkdirSync(join(profileDir, 'node_modules', '@eterna'), { recursive: true })
  mkdirSync(join(profileDir, 'node_modules', '@deepseek-ai'), { recursive: true })

  // @deepseek-ai 家族:与 entrypoint 一样指向内核自带的 preset / mcp-client 拷贝。
  // 优先取内核安装树(容器/扁平安装);仓库 pnpm 形态再从 .pnpm 找。
  const pnpmStore = join(repoRoot, 'node_modules', '.pnpm')
  const presetDir = [
    join(dshFamilyDir, 'dsh-agent-preset'),
    ...(existsSync(pnpmStore)
      ? readdirSync(pnpmStore)
        .filter(entry => entry.startsWith('@deepseek-ai+dsh-agent-preset@'))
        .map(entry => join(pnpmStore, entry, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'))
      : []),
  ].find(dir => existsSync(join(dir, 'package.json')))
  if (presetDir === undefined) throw new Error('缺 @deepseek-ai/dsh-agent-preset(内核安装不完整)')
  symlinkSync(presetDir, join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-agent-preset'), 'dir')
  const mcpClientDir = [
    join(dshFamilyDir, 'dsh-mcp-client'),
    ...(existsSync(pnpmStore)
      ? readdirSync(pnpmStore)
        .filter(entry => entry.startsWith('@deepseek-ai+dsh-mcp-client@'))
        .map(entry => join(pnpmStore, entry, 'node_modules', '@deepseek-ai', 'dsh-mcp-client'))
      : []),
  ].find(dir => existsSync(join(dir, 'package.json')))
  if (mcpClientDir !== undefined) {
    symlinkSync(mcpClientDir, join(profileDir, 'node_modules', '@deepseek-ai', 'dsh-mcp-client'), 'dir')
  } else {
    log('警告:未找到 @deepseek-ai/dsh-mcp-client——mcp-browser 条目不会激活')
  }

  const packages = form === 'super' ? [...BASE_PACKAGES, ...SUPER_PACKAGES] : BASE_PACKAGES
  for (const pkg of packages) {
    const dir = join(repoRoot, 'packages', pkg)
    if (!existsSync(dir)) continue
    symlinkSync(dir, join(profileDir, 'node_modules', '@eterna', pkg), 'dir')
  }
  symlinkSync(join(repoRoot, 'packages', 'brand'), join(profileDir, 'node_modules', '@eterna', 'creation-skills'), 'dir')

  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: `dsh-profile-${profileName}`,
    private: true,
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
  }, null, 2)}\n`)
  writeFileSync(join(profileDir, 'cordis.yml'), '[]\n')
  const template = readFileSync(templatePath, 'utf8').replaceAll('__ETERNA_RELAY_TOKEN__', 'shots-relay-token')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), template)
}

// ── 2. 启动与就绪 ──────────────────────────────────────────────────────
const BOOT_TIMEOUT_MS = 120_000

function startHost() {
  const child = spawn(process.execPath, [dshBin, '--profile', profileName, '--host', '127.0.0.1', '--port', '0', '--no-open'], {
    // cwd=DSH_HOME 与容器一致(working_dir=/data);不落仓库树,避免 cwd 参与的
    // 裸名解析/相对路径读写碰到并行会话的 WIP。
    cwd: home,
    env: {
      ...process.env,
      DSH_HOME: home,
      ETERNA_ACCESS_DIR: join(home, 'access'),
      ETERNA_TENANT_ROOT: join(home, 'workspaces'),
      ETERNA_ACCESS_ADMIN_USER: SHOTS_USER,
      ETERNA_ACCESS_ADMIN_PASSWORD: SHOTS_PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = []
  const collect = (stream) => {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => { output.push(chunk) })
  }
  collect(child.stdout)
  collect(child.stderr)
  const ready = new Promise((resolveReady, rejectReady) => {
    const timer = setTimeout(() => rejectReady(new Error(`启动超时(${BOOT_TIMEOUT_MS}ms)\n${output.join('')}`)), BOOT_TIMEOUT_MS)
    const check = () => {
      const match = output.join('').match(/^dsh web: (\S+)$/m)
      if (match !== null) {
        clearTimeout(timer)
        resolveReady(match[1])
      }
    }
    child.stdout.on('data', check)
    child.stderr.on('data', check)
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectReady(new Error(`dsh 提前退出(code=${code})\n${output.join('')}`))
    })
    check()
  })
  return { child, ready, output }
}

async function stopHost(host) {
  const { child } = host
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolveStop() }, 5000)
    child.once('exit', () => { clearTimeout(timer); resolveStop() })
  })
}

// ── 3. 浏览器 ──────────────────────────────────────────────────────────
function requirePlaywright() {
  const relayRequire = createRequire(join(repoRoot, 'packages', 'browser-relay', 'package.json'))
  return relayRequire('playwright-core')
}

async function launchBrowser(chromium) {
  const common = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] }
  const candidates = []
  if (process.env.CHROME_PATH !== undefined && process.env.CHROME_PATH !== '') {
    candidates.push({ ...common, executablePath: process.env.CHROME_PATH })
  }
  candidates.push({ ...common, channel: 'chrome' })
  candidates.push(common)
  let lastError
  for (const options of candidates) {
    try {
      return await chromium.launch(options)
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`Chrome 不可用(试过 CHROME_PATH / channel:chrome / playwright 自带): ${lastError?.message ?? lastError}`)
}

async function login(page, origin) {
  await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#account', SHOTS_USER)
  await page.fill('#password', SHOTS_PASSWORD)
  await page.click('#go')
  await page.waitForSelector('html[data-eterna-access-role]', { timeout: 20_000 })
  // 登录跳转完成后等壳稳定(侧栏/输入框就绪)
  await page.waitForTimeout(1200)
}

async function runStep(page, step, origin) {
  if (step.goto !== undefined) {
    const target = step.goto.startsWith('http') ? step.goto : `${origin}${step.goto}`
    // 同 URL 的 goto 会被内核当成空操作,上一屏残留(命令菜单/设置弹窗)会污染下一
    // 场景(2026-11-24 实测 providers 因此 flaky)——此时显式 reload 拿新文档。
    if (page.url() === target) await page.reload({ waitUntil: 'domcontentloaded' })
    else await page.goto(target, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(300)
    return
  }
  if (step.waitFor !== undefined) {
    await page.waitForSelector(step.waitFor, { timeout: step.timeout ?? 15_000 })
    return
  }
  if (step.waitForText !== undefined) {
    await page.getByText(step.waitForText, { exact: step.exact ?? false }).first().waitFor({ timeout: step.timeout ?? 15_000 })
    return
  }
  if (step.waitMs !== undefined) {
    await page.waitForTimeout(step.waitMs)
    return
  }
  if (step.click !== undefined) {
    const target = step.click
    const locator = target.selector !== undefined
      ? page.locator(target.selector).first()
      : target.text !== undefined
        ? page.getByText(target.text, { exact: target.exact ?? false }).first()
        : page.getByRole(target.role, { name: target.name })
    await locator.waitFor({ state: 'visible', timeout: step.timeout ?? 15_000 })
    await locator.click()
    await page.waitForTimeout(350)
    return
  }
  if (step.fill !== undefined) {
    await page.locator(step.fill.selector).first().fill(step.fill.text)
    return
  }
  if (step.type !== undefined) {
    await page.keyboard.type(step.type, { delay: 40 })
    return
  }
  if (step.closeReleaseNotes !== undefined) {
    // 首屏弹出版本说明(55 号)会挡住壳层操作;先按 × 关掉(任一关闭都记已读)。
    const close = page.locator('[data-eterna-release-notes] .ern-close').first()
    if (await close.count() > 0 && await close.isVisible()) {
      await close.click()
      await page.waitForTimeout(400)
    }
    return
  }
  if (step.evalJs !== undefined) {
    const result = await page.evaluate(step.evalJs)
    console.log(`[eval] ${JSON.stringify(result)}`)
    return
  }
  if (step.expectAbsent !== undefined) {
    await page.waitForTimeout(1200)
    const count = await page.locator(step.expectAbsent).count()
    console.log(`[expectAbsent] ${step.expectAbsent} count=${count}`)
    if (count !== 0) throw new Error(`期望不存在但命中了: ${step.expectAbsent}`)
    return
  }
  if (step.rects !== undefined) {
    for (const selector of step.rects) {
      const box = await page.locator(selector).first().boundingBox()
      console.log(`[rect] ${selector} ${JSON.stringify(box)}`)
    }
    return
  }
  if (step.listButtons !== undefined) {
    const items = await page.locator('button, [role="button"]').evaluateAll(nodes => nodes.slice(0, 60).map(node => `${node.tagName.toLowerCase()}|${node.getAttribute('aria-label') ?? ''}|${(node.textContent ?? '').trim().slice(0, 24)}|${node.className && typeof node.className === 'string' ? node.className.slice(0, 40) : ''}`))
    console.log('[buttons] ' + JSON.stringify(items, null, 0))
    return
  }
  if (step.dumpText !== undefined) {
    const text = await page.locator(step.dumpText.selector ?? 'body').first().innerText()
    console.log(`[dump ${step.dumpText.selector ?? 'body'}] ${text.slice(0, 3000)}`)
    return
  }
  if (step.press !== undefined) {
    await page.keyboard.press(step.press)
    return
  }
  throw new Error(`未知步骤 ${JSON.stringify(step)}`)
}

// ── 4. 主流程 ──────────────────────────────────────────────────────────
function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function backfillManifest(files) {
  const manifestPath = join(releaseDir, 'release.json')
  if (!existsSync(manifestPath)) return 0
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  let changed = 0
  for (const slide of manifest.slides ?? []) {
    const media = slide?.media
    if (media === undefined || typeof media.src !== 'string') continue
    const hash = files[media.src]
    if (hash !== undefined && media.sha256 !== hash) {
      media.sha256 = hash
      changed += 1
    }
  }
  if (changed > 0) writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return changed
}

async function main() {
  if (!existsSync(dshBin)) {
    throw new Error(`dsh 未安装(${dshBin}):先 pnpm install,或设 RELEASE_SHOTS_DSH 指到内核 bin.js`)
  }
  const plan = existsSync(planPath)
    ? JSON.parse(readFileSync(planPath, 'utf8'))
    : DEFAULT_PLAN
  if (!existsSync(planPath) && argValue('out') === undefined) {
    // 首次运行时把默认剧本落盘,让「截哪一屏」成为可评审的版本化数据。
    mkdirSync(dirname(planPath), { recursive: true })
    writeFileSync(planPath, `${JSON.stringify(DEFAULT_PLAN, null, 2)}\n`)
    log(`已写默认剧本 ${planPath.replace(repoRoot, '.')}(可改选择器)`)
  }

  const viewport = viewportArg === undefined
    ? (plan.viewport ?? VIEWPORT)
    : { width: Number(viewportArg.split('x')[0]), height: Number(viewportArg.split('x')[1]) }
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)) throw new Error(`--viewport 需形如 760x900(实得 ${viewportArg})`)

  mkdirSync(outDir, { recursive: true })
  log(`version=${version} form=${form} out=${outDir.replace(repoRoot, '.')}`)
  materializeProfile()

  const host = startHost()
  let browser
  const captured = {}
  const skipped = []
  try {
    const url = await host.ready
    const origin = new URL(url).origin
    log(`宿主就绪 ${origin}`)

    const chromium = requirePlaywright().chromium
    browser = await launchBrowser(chromium)
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme })
    const page = await context.newPage()
    page.on('console', message => {
      if (message.type() === 'error') console.log(`[page:error] ${message.text()}`)
    })
    await login(page, origin)

    for (const scene of plan.scenes ?? []) {
      if (scene.form !== undefined && scene.form !== form) {
        skipped.push({ id: scene.id, reason: `需要 ${scene.form} 形态(本次 ${form})` })
        continue
      }
      try {
        for (const step of scene.steps ?? []) await runStep(page, step, origin)
        const file = scene.file ?? `${scene.id}.webp`
        const path = join(outDir, file)
        await page.screenshot({ path, type: 'webp', quality: 80 })
        captured[file] = sha256File(path)
        log(`SHOT ${file}`)
      } catch (error) {
        skipped.push({ id: scene.id, reason: error instanceof Error ? error.message : String(error) })
        log(`SKIP ${scene.id}: ${skipped[skipped.length - 1].reason.split('\n')[0]}`)
        // 失败现场留一张调试图(不进 assets 目录的正式清单)
        try {
          const debugPath = join(outDir, `_debug-${scene.id}.webp`)
          await page.screenshot({ path: debugPath, type: 'webp', quality: 70 })
          log(`     调试截图 ${debugPath.replace(repoRoot, '.')}`)
        } catch { /* 页面已崩就算了 */ }
      }
    }
    await context.close().catch(() => {})
  } finally {
    if (browser !== undefined) await browser.close().catch(() => {})
    await stopHost(host)
    if (!keep) rmSync(home, { recursive: true, force: true })
  }

  const shotFiles = Object.keys(captured)
  const shotsJsonPath = outDir === join(releaseDir, 'assets') ? join(releaseDir, '.shots.json') : join(outDir, '.shots.json')
  writeFileSync(shotsJsonPath, `${JSON.stringify({
    version,
    form,
    capturedAt: new Date().toISOString(),
    viewport,
    theme: colorScheme,
    files: captured,
    skipped,
  }, null, 2)}\n`)
  const backfilled = backfillManifest(captured)
  log(`完成:${shotFiles.length} 张 · 回填 ${backfilled} 个 sha256 · 跳过 ${skipped.length}`)
  for (const item of skipped) log(`  跳过 ${item.id}: ${item.reason.split('\n')[0]}`)
  if (strict && skipped.length > 0) process.exit(1)
  if (shotFiles.length === 0) {
    console.error('release-shots: 一张都没截到——检查剧本选择器(或加 --keep 保留实例排查)')
    process.exit(1)
  }
}

main().catch((error) => {
  console.error(`release-shots: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})