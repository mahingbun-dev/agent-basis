# T30/T38 — chat-import 租户桥 + 检索/市场回归（证据）

- lane：`T30/T38 chat-import 租户桥与检索/市场回归`
- worktree：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`）
- 日期：2026-11-20
- 来源：54 §4.6（T30/T38）+ §4.11 实施细则；50 §3.6 / §5.3；47 §2.11 / B16 / B7 / B8

## 1. 交付物

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/access/src/chat-import.ts` | 新增（本 lane） | 请求级租户门（401/400/403）+ NDJSON pass-through `TransformStream` 记账 + 终态对账 + 审计 |
| `packages/access/src/plugin.ts` | 改动（本 lane，+17 行接线） | `installChatImportGate(...)` 挂 `connection/request`（prepend）；`workspaceSessionIdsOf(ctx.reflect, …)` 惰性读 workspaceRegistry |
| `packages/access/tests/chat-import-gate.spec.ts` | 新增（本 lane） | 20 例：401/400/403/放行/字节透传/记账/幂等/对账/64KB/状态码/探针面 |
| `packages/access/tests/market-gate-coverage.spec.ts` | 新增（本 lane） | 6 例：上游 19 个市场方法逐个 × 三身份 + detail-file + 双层键控 |

不改 `mux.ts` / `tenant.ts`（系统门已在 W0 改；`git diff` 里这两文件 `chat-import|chatImport` 命中数 = 0）。
不改 `client/**`（工作树里 client/** 的改动是并行车道 T28 在 03:22–03:30 写入的，本 lane 未写过）。

## 2. 为什么接入点是 `connection/request` 而不是 admit 包装

- 设计文字（47 B16 / 50 §3.6）写的是「admit 返回的 Response 外包 TransformStream」，但 rc.5 的
  `connection.admit(req)` 只回 `{peer}` / `{rejection}`（`dsh-client-connection lib/index.js:742-750`），
  Response 在 bridge 内部由 Fetch 路由创建（同上 `:82-96`）——admit 层拿不到 body。
- 本 lane 又被明令不改 `mux.ts`（admit 包装所在处，属 W0 车道）。
- `connection/request` 是上游**声明过**的 waterfall 扩展点：
  `dsh-client-connection lib/types/index.d.ts:21-31`——“Admit or wrap an authenticated shared API
  request, including body transfer”；发起处 `lib/index.js:1055`（admit 通过后、bridge 之前）。
- 跨上下文投递已用 cordis 探针实测：`cordis-waterfall-probe.txt` →
  `{"order":["access:/api/x","vendor","inner"]}`（兄弟 ctx 注册、prepend 先执行、next 链完整）。

上游事实（本 lane 实核）：
- 路由 `POST /api/deepseek-chat-import/archive`（`dsh-deepseek-chat-import lib/index.js:1396-1399`、
  登记 `:1683`，`methods:['POST']` / `requestBody:'streaming'`）；
- 响应 NDJSON：progress 行 + 唯一 outcome 行（`:1400-1410`、`:1470-1490`），成功体
  `{"type":"outcome","outcome":{"ok":true,"value":{…,"sessionIds":[…]}}}`（value 生成处 `:1090-1102`）；
- 资格判定只有 `principalOf(...)`（`:1712 limits()`），unary HTTP 恒 owner Peer → 本品里等于无租户校验（H10）；
- workspaceRegistry 为全局注册表（`:1659`），无 workspaceOwner 校验。

## 3. 已执行检查（命令原文 / EXIT / 结果）

1) `pnpm --filter @eterna/access verify`
   - 组成：`node scripts/build-client.mjs && oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run`
   - EXIT=0；`lib/client.js 309.6kb`；oxlint `Found 0 warnings and 0 errors.`；tsc 无输出（clean）；
     vitest `Test Files 49 passed (49)` / `Tests 498 passed (498)`（日志 `access-verify.log`，退出码 `access-verify.exit`）。
   - 注：该套件运行时工作树含并行车道（T28 个人层 UI / mcp-personal）的文件，故计数高于本 lane 新增的 26 例。

2) `pnpm --filter @eterna/access exec vitest run tests/chat-import-gate.spec.ts tests/market-gate-coverage.spec.ts`
   - EXIT=0；20 + 6 = 26 例全绿（`targeted-specs.log`、逐例清单 `targeted-specs-verbose.log`）。

3) cordis 机制探针 `node artifacts/rc5/p4/chat-import/cordis-waterfall-probe.mjs`
   - EXIT=0；输出 `{"order":["access:/api/x","vendor","inner"]}`（`cordis-waterfall-probe.txt`）。

4) T38 静态核查（`t38-search-market.txt`）：
   - 两份模板均定义 `deepseek` / `mimo` / `glm` 三 provider；
   - `tool-web` 行（web + super 各一）`fetch: true`、`searchTimeoutMs: 60000`；
   - 产品模板**不覆写** `web` 行 → 走上游默认路由（`dsh-base/cordis.patch.yml:488-506` 已含
     `web(fetchProvider:http)` / `web-search-deepseek` / `web-deepseek-api` / `web-fetch-http` / `tool-web`）；
   - 路由→provider：`dsh-web lib/index.js:69/74/76/233`——DeepSeek 路由=`deepseek-official`，
     其余路由（mimo/glm）=`deepseek-search-api`；
   - 工具注册条件：`dsh-tool-web lib/index.js:293/351`（`web_search`，`ctx.web.searchReady(provider)`）、
     `:773/854`（`web_fetch`，`fetchReady`）。

5) 边界核验（`worktree-guard.txt`）：`git status/diff --stat`、mux.ts/tenant.ts 无 chat 字样、
   本 lane 只写过 4 个文件（mtime 03:23:58–03:33:27）、`docker ps` 只读查看（生产容器未被操作）。

6) 收尾复跑（03:42，`final-tsc.log` / `final-targeted.log`）：
   `pnpm --filter @eterna/access exec tsc --noEmit` EXIT=0（日志空）；
   `pnpm --filter @eterna/access exec vitest run tests/chat-import-gate.spec.ts tests/market-gate-coverage.spec.ts`
   EXIT=0，`Test Files 2 passed (2)` / `Tests 26 passed (26)`。

## 4. 未执行 / 无法在本 lane 执行（不造假绿灯）

| 项 | 状态 | 原因 |
|---|---|---|
| 容器内真实 401/403/记账 E2E（上传真 zip） | **未跑** | 需 P5 测试容器（T46）与夹具（T47 `verify-chat-import`）；本 lane 只有单元/集成级替身 |
| 512MiB 合成包不 OOM 浸泡 | **未跑** | 同上，属 T46/T47 环境项（47 B16 验收第 7 条） |
| 三路由 `web_search`/`web_fetch` 真调用（deepseek/mimo/glm） | **未跑** | 需三家真凭据 + 出网；本 lane 无凭据、也不应把凭据落盘 |
| 反代 `client_max_body_size 512m` / 读超时实测 | **未跑** | 属 T44（部署/反代 lane） |
| 浏览器 UI（上游 chat-import 按钮 v4 审计） | **未跑** | 属 T28/T36 客户端面；本 lane 不改 client/** |

## 5. 关键行为与已知取舍

- 401/400/403 均在**读请求体之前**拒绝（不缓冲、不打印压缩包内容/标题）；拒绝响应 `connection: close`，
  响应冲完后掐断未读上传体（与上游 413 分支同款）。
- 408/415 类差异：非 `application/octet-stream` 由上游拒为 **415**（`lib/index.js:1420`），
  47 B16 验收文字写 400——以上游实际为准，本门不重复校验 content-type。
- 记账幂等：`store.sessionOwner(id) !== undefined` 一律跳过——既防重复导入，也**绝不改写他人归属**。
- 对账：响应 finish/close 后按 `workspaceRegistry.get(workspaceId).sessionIds` 补记无主会话；
  registry 缺席/形态漂移 → 降级 0，不抛不阻断。
- 审计 kind=`access.chatImport`，`detail.action ∈ {denied, import.ok, import.rejected, import.cancelled,
  import.failed, gate.install}`；只含 userId/workspaceId/计数/status，无标题与压缩包内容。
- 单行 >64KB 整行丢弃、流继续；坏行不阻断；半行跨 chunk 会拼回。
- 市场门（既有 T6.1，本 lane 只补回归测试）：19 个 RPC + 2 条 detail-file 全 admin-only；
  读取类方法（listBundles/listVersions/search/readIndexes…）同样被前缀门覆盖（既有行为，未改）。