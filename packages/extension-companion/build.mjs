import { build } from "esbuild"
import { cp, mkdir, rm } from "node:fs/promises"
import { spawnSync } from "node:child_process"

const root = new URL(".", import.meta.url)
const dist = new URL("./dist/", root)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

await build({
  entryPoints: [
    new URL("./src/background.ts", root).pathname,
    new URL("./src/options.ts", root).pathname,
  ],
  bundle: true,
  outdir: dist.pathname,
  format: "esm",
  target: "chrome120",
  sourcemap: false,
  minify: false,
  logLevel: "info",
})

await cp(new URL("./manifest.json", root), new URL("./dist/manifest.json", root))
await cp(new URL("./src/options.html", root), new URL("./dist/options.html", root))
console.log("extension dist 已生成")

// 打包 zip 供分发（/companion/download.zip 与手动加载同一内容）
try {
  const zipPath = new URL("./eterna-companion.zip", root).pathname
  await rm(zipPath, { force: true })
  const r = spawnSync("zip", ["-r", zipPath, "."], { cwd: dist.pathname, stdio: "ignore" })
  if (r.status === 0) console.log("zip 已生成:", zipPath)
  else console.log("zip 打包失败 status=" + String(r.status))
} catch (err) {
  console.log("zip 打包跳过:", err instanceof Error ? err.message : String(err))
}

