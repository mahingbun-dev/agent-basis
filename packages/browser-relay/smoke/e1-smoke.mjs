#!/usr/bin/env node
// E1 冒烟脚本（实现者自测证据，非门禁判定——G-CORE-01/02 的判定归独立验收代理）。
// 流程：起 relay（固定 9310=扩展默认地址）→ 起带扩展的 Chromium → snapshot/fill/click 打本地 fixture → 尝试 example.com。
// Chromium 来源优先级：SMOKE_CHROME 环境变量 > smoke/.browsers（@puppeteer/browsers 下载）> /Applications/Chromium.app。
// 品牌版 Chrome 137+ 已移除 --load-extension，故不用系统 Chrome；SMOKE_HEADLESS=1 时用 --headless=new。

import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const PKG_ROOT = resolve(new URL("..", import.meta.url).pathname)
const REPO_ROOT = resolve(PKG_ROOT, "../..")
const EXT_DIST = join(REPO_ROOT, "packages/extension-companion/dist")
const PORT = 9310
const BASE = `http://127.0.0.1:${PORT}`
const BROWSER_DIR = join(PKG_ROOT, "smoke/.browsers")

const results = { steps: [], examplecom: null, refMode: null, chromePath: null, headless: null }
function step(name, ok, detail = "") {
  results.steps.push({ name, ok, detail })
  console.log(`${ok ? "✅" : "❌"} ${name}${detail !== "" ? ` — ${detail}` : ""}`)
}

function listFilesRecursive(dir, depth = 12) {
  if (!existsSync(dir) || depth < 0) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFilesRecursive(p, depth - 1))
    else out.push(p)
  }
  return out
}

function findChromiumBinary(rootDir) {
  const files = listFilesRecursive(rootDir)
  return files.find((f) => f.endsWith("/Chromium.app/Contents/MacOS/Chromium") ?? f.endsWith("/chrome"))
}

async function ensureChromium() {
  const envPath = process.env.SMOKE_CHROME
  if (envPath !== undefined && existsSync(envPath)) return envPath
  let bin = findChromiumBinary(BROWSER_DIR) ?? (existsSync("/Applications/Chromium.app/Contents/MacOS/Chromium") ? "/Applications/Chromium.app/Contents/MacOS/Chromium" : null)
  if (bin === null) {
    console.log("未找到本地 Chromium，尝试 @puppeteer/browsers 下载（约 170MB，需网络）…")
    const r = spawnSync("pnpm", ["exec", "browsers", "install", "chromium@latest", "--path", BROWSER_DIR], { cwd: PKG_ROOT, stdio: "inherit", timeout: 600_000 })
    if (r.status !== 0) throw new Error("Chromium 下载失败：可手动执行 pnpm exec browsers install chromium@latest --path smoke/.browsers，或设 SMOKE_CHROME 指向任意 Chromium 二进制")
    bin = findChromiumBinary(BROWSER_DIR)
  }
  if (bin === null) throw new Error("找不到 Chromium 二进制")
  return bin
}

async function poll(fn, timeoutMs, label) {
  const start = Date.now()
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch {
      /* 重试 */
    }
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}`)
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function callTool(name, args) {
  const res = await fetch(`${BASE}/api/tools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args }),
  })
  return await res.json()
}

function extractRef(snapshot, role, name) {
  const re = new RegExp(`${role} "${name}"[^\\n]*\\[ref=([^\\]]+)\\]`)
  const m = re.exec(snapshot)
  return m === null ? null : m[1]
}

async function main() {
  if (!existsSync(join(EXT_DIST, "manifest.json"))) {
    throw new Error("扩展未构建：先执行 pnpm --filter @eterna/extension-companion build")
  }
  const chromePath = await ensureChromium()
  results.chromePath = chromePath
  const headless = process.env.SMOKE_HEADLESS === "1"
  results.headless = headless

  // 1. 起 relay（固定 9310 = 扩展默认连接地址）
  const relayProc = spawn("node", [join(PKG_ROOT, "dist/cli.mjs"), "start", "--port", String(PORT)], { stdio: ["ignore", "pipe", "pipe"] })
  relayProc.stderr.on("data", (d) => process.stderr.write(`[relay] ${String(d)}`))
  try {
    await poll(async () => {
      const r = await fetch(`${BASE}/healthz`)
      return r.ok
    }, 10_000, "relay 启动")
    step("relay 启动", true, `port ${PORT}`)

    // 2. 起带扩展的 Chromium（一次性临时 profile）
    const profile = join(tmpdir(), `eterna-smoke-profile-${Date.now()}`)
    mkdirSync(profile, { recursive: true })
    const chromeArgs = [
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
    ]
    if (headless) chromeArgs.push("--headless=new")
    chromeArgs.push(`--load-extension=${EXT_DIST}`, "about:blank")
    const chromeProc = spawn(chromePath, chromeArgs, { stdio: "ignore", detached: false })
    try {
      // 3. 等扩展连上 relay（SW 启动 + ws 握手）
      const status = await poll(async () => {
        const r = await fetch(`${BASE}/api/status`)
        const j = await r.json()
        return j.extensionConnected === true ? j : null
      }, 30_000, "扩展连接 relay（检查：扩展已加载且默认地址为 ws://127.0.0.1:9310/extension）")
      step("扩展连接 relay", true, `ext=${String(status.extVersion)} chrome=${String(status.chromeVersion)}`)

      // 4. snapshot 打开 fixture（E1 过渡：snapshot 携带 url 即打开该地址）
      const snap1 = await callTool("browser_snapshot", { url: `${BASE}/fixture` })
      const ok1 = snap1.ok === true && String(snap1.result?.snapshot ?? "").includes("E1 Fixture")
      step("browser_snapshot 打开本地 fixture", ok1, ok1 ? `url=${String(snap1.result?.url)}` : JSON.stringify(snap1.error ?? snap1.result))
      if (!ok1) throw new Error("fixture 快照失败，冒烟中止")

      // 5. 解析 ref（ai 快照形态）→ fill + click
      const snapshot1 = String(snap1.result?.snapshot ?? "")
      const inputRef = extractRef(snapshot1, "textbox", "搜索关键词")
      const btnRef = extractRef(snapshot1, "button", "提交")
      const useRef = inputRef !== null && btnRef !== null
      results.refMode = useRef ? "ai-ref" : "selector-fallback"
      const fillArgs = useRef ? { ref: inputRef, value: "playwright" } : { selector: "#kw", value: "playwright" }
      const clickArgs = useRef ? { ref: btnRef } : { selector: "#go" }
      const fillRes = await callTool("browser_fill", fillArgs)
      step("browser_fill", fillRes.ok === true, useRef ? `ref=${String(inputRef)}` : "selector=#kw")
      const clickRes = await callTool("browser_click", clickArgs)
      const clickOk = clickRes.ok === true && String(clickRes.result?.url ?? "").includes("/fixture/result")
      step("browser_click（提交→结果页）", clickOk, `url=${String(clickRes.result?.url ?? clickRes.error?.message)}`)

      // 6. 动作后再快照：结果页含提交的关键词
      const snap2 = await callTool("browser_snapshot", {})
      const ok2 = snap2.ok === true && String(snap2.result?.snapshot ?? "").includes("playwright")
      step("动作后快照含预期内容", ok2, `url=${String(snap2.result?.url)}`)

      // 7. example.com（公网；网络不可达时如实记录不伪造）
      try {
        const snap3 = await callTool("browser_snapshot", { url: "https://example.com/" })
        const ok3 = snap3.ok === true && String(snap3.result?.snapshot ?? "").includes("Example Domain")
        results.examplecom = ok3 ? "pass" : `fail:${JSON.stringify(snap3.error ?? {})}`
        step("example.com 真实快照（R-02 场景）", ok3, `title=${String(snap3.result?.title ?? "")}`)
      } catch (err) {
        results.examplecom = "network-unreachable"
        step("example.com 真实快照（R-02 场景）", false, `网络不可达：${err instanceof Error ? err.message : String(err)}`)
      }

      const failed = results.steps.filter((s) => !s.ok)
      writeFileSync(join(PKG_ROOT, "smoke/e1-smoke-result.json"), JSON.stringify({ at: new Date().toISOString(), ...results }, null, 2))
      if (failed.length > 0) {
        console.log(`\n冒烟结论：${failed.length} 步失败（详见 smoke/e1-smoke-result.json）`)
        process.exitCode = 1
      } else {
        console.log("\n冒烟结论：E1 最小闭环全部步骤通过（实现者自测证据，非门禁判定）")
      }
    } finally {
      chromeProc.kill("SIGTERM")
      await new Promise((r) => setTimeout(r, 500))
      rmSync(profile, { recursive: true, force: true })
    }
  } finally {
    relayProc.kill("SIGTERM")
  }
}

await main()
