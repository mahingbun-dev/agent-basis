# RC5-V1-005 — runtime 测试 + `basis chat` 六插件装载 + CLI 退出码

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:282`（RC5-V1-005，P0：
  「`pnpm --filter @core/runtime test`；`node … chat --bundle basis.yml </dev/null` |
  6 插件全部解析装载；无 `bundle-core` 行；CLI 退出 0」）
- 任务：T20（54 §4.5「basis chat 离线 turn」；50 §3.3 同款命令）
- 判定：**PASS**（本 session 实跑）

## 1) runtime 测试

```bash
cd /Users/sunny/code/agent-basis-rc5
pnpm --filter @core/runtime test
```

```text
 ✓ tests/cli.spec.ts (7 tests) 12ms
 ✓ tests/boot.spec.ts (6 tests) 15ms
 Test Files  2 passed (2)
      Tests  13 passed (13)
```

`EXIT=0`。日志 `artifacts/rc5/p3/v1-runtime-test.log`

## 2) `basis chat` 离线（stdin 立即 EOF）

```bash
node core/runtime/bin/basis.mjs chat --bundle basis.yml </dev/null
```

```text
basis chat 已就绪(/exit 或 EOF 退出;每行输入 = 一个 turn)
>
```

`EXIT=0`。日志 `artifacts/rc5/p3/v1-basis-chat.log`（187 字节，无报错/无 stack）。

## 3) `basis run` 单 turn（stub fixture）

```bash
node core/runtime/bin/basis.mjs run "ping" \
  --bundle core/runtime/tests/fixtures/basis-run.yml --json
```

stdout（`artifacts/rc5/p3/v1-basis-run.json`）：

```json
{"turn":1,"steps":1,"output":"echo(default):ping","toolCalls":[]}
```

stderr 空（`v1-basis-run.err` 0 字节），`EXIT=0`。

## 4) 六插件全部解析装载（chat 不打印插件表，另跑 boot 探针）

`basis.mjs chat` 成功只说明「无插件抛错」；为给出「6 插件全部装载」的直接证据，
用与 CI 同一 `bootBundle` 路径探测 `ctx` 服务面（探针脚本放 `/tmp`，不入仓）：

```js
// /tmp/v1-boot-probe.mjs
const bootMod = await import(`${root}/core/runtime/src/boot.ts`)
const manifest = bootMod.parseManifestYaml(await readFile(join(root,'basis.yml'),'utf8'))
const bundle = await bootMod.bootBundle(manifest, dirname(join(root,'basis.yml')))
for (const s of ['systemPrompt','session','tools','llm','approval','agents'])
  console.log(`ctx.${s}=${bundle.ctx.get(s) !== undefined ? 'present' : 'MISSING'}`)
```

输出（`EXIT=0`，`artifacts/rc5/p3/v1-boot-probe.log`）：

```text
manifest.plugins.length=6
  - packages/system-prompt
  - packages/session
  - packages/tools
  - packages/llm
  - packages/approval-cli
  - packages/agent-loop
manifest.agent=default
ctx.systemPrompt=present
ctx.session=present
ctx.tools=present
ctx.llm=present
ctx.approval=present
ctx.agents=present
PROBE=PASS
```

装载失败会走 `bootBundle` 的「任一插件抛错 = 全量回卷后抛出」路径（`core/runtime/src/boot.ts:80-101`，回卷在 `:97-98`），
因此 `EXIT=0` + 六个服务 present = 六插件确实挂载成功。

## 5) `basis.yml` 无 `bundle-core` 行

```bash
grep -n "bundle-core" basis.yml core packages/{system-prompt,session,tools,llm,approval-cli,agent-loop}
# 无输出,EXIT=1
ls packages/bundle-core
# → No such file or directory
```

`basis.yml:4-9` 六行即全部条目（`system-prompt` / `session` / `tools` / `llm` /
`approval-cli` / `agent-loop`），`:10` `agent: default`。H15 的删行 + 删空目录已完成。

## 断言

- [x] `pnpm --filter @core/runtime test` EXIT=0（13/13）
- [x] `node core/runtime/bin/basis.mjs chat --bundle basis.yml </dev/null` EXIT=0
- [x] 六插件全部解析装载（manifest 6 条 + 六个 ctx 服务 present）
- [x] `basis.yml` 无 `bundle-core` 行；`packages/bundle-core` 目录不存在
- [x] `basis run` stub fixture EXIT=0，JSON 单行、stderr 空