import { build } from "esbuild"
import { cp, mkdir, rm } from "node:fs/promises"

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
