import { build } from "esbuild"
import { mkdir, rm } from "node:fs/promises"

const root = new URL(".", import.meta.url)
const dist = new URL("./dist/", root)

await rm(dist, { recursive: true, force: true })
await mkdir(dist, { recursive: true })

await build({
  entryPoints: [new URL("./src/cli.ts", root).pathname, new URL("./src/mcp.ts", root).pathname],
  bundle: true,
  outdir: dist.pathname,
  outExtension: { ".js": ".mjs" },
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: false,
  minify: false,
  // 运行时依赖不入 bundle（pnpm node_modules 可解析）
  external: ["playwright-core", "ws"],
  logLevel: "info",
})

console.log("relay dist 已生成")
