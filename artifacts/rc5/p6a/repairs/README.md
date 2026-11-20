# P6a · W5 门禁修复（第 1 轮）

- 工作树：`/Users/sunny/code/agent-basis-rc5`（分支 `feat/dsh-rc5-merge`，HEAD `02f4857`）
- 时间：2026-11-20 01:05–01:24Z
- 边界：未 `git push/merge`；未停/改生产容器（`eterna-agent` 未动）；未写 deepseek-harness；
  未碰 `/Users/sunny/code/agent-basis`；未用 `reset/clean/stash/全量 checkout`；
  凭据只从 0600 账号文件读入内存，证据内无口令/cookie/token 值。

## 0 结论

| 门禁 | 修前 | 修后 |
|---|---|---|
| `scripts/verify-terminal-guard.mjs` | PASS=5 **FAIL=4** NOTRUN=3，EXIT=1 | **PASS=11 FAIL=0 SKIP=0 NOTRUN=1**（仅 TERM-005 静态项），EXIT=0 |
| `scripts/verify-chat-import.mjs` | PASS=7 **FAIL=1** SKIP=4，EXIT=1 | **PASS=8 FAIL=0 SKIP=4 NOTRUN=0**，EXIT=0 |

修前/修后完整输出：TERM 修前取 E1 报告 `artifacts/rc5/E1/TERM/RC5-TERM-004/terminal-guard-report.json`
（2026-11-19T23:19:48Z，计数与门禁失败原文逐项一致；本轮先修后跑，未重跑修前态）；IMP 修前为本轮实跑
`repro-chat-import-before.log/.json`；修后见 `final-terminal-guard.log/.json` 与 `final-chat-import.log/.json`
（另有同一轮较早的 `after-*.log/.json`，内容一致）。

## 1 TERM-004 根因（三条独立失效叠加，P0 跨租户）

### 1.1 rc.5 身份形态漂移：`invocation.principal` → `invocation.peer.principal`

`packages/access/src/terminal.ts` 旧守卫读 `terminalService.ctx?.invocation?.principal`。
rc.5 的 `GatewayInvocation` 只有 `request/service/peer/signal/uplink_` 五个字段（无 `principal`），
身份在 `peer.principal`；上游自己的取值器是 `principalOf = invocation?.peer.principal`
（`dsh-typert-protocol/lib/index.js:294`）。旧读法恒 `undefined` → `if (principal?.kind ===
'eterna-user')` 永不成立 → 守卫对任何调用都放行（静默失效，无日志无审计）。

补充：服务实例自身的 `ctx` 是装配侧上下文，恒无 `invocation`；网关以
`receiverContext.extend({invocation})` 作为 `this` 调方法（cordis ctx 追踪，
`createShadowMethod`/`tracker.property='ctx'`），所以身份必须从**调用点 `this.ctx`** 读
（上游 terminal-controller `lib/index.js:1316` 同读法）。

### 1.2 `/api/terminal/*` 一元请求恒 owner Peer：网关整段跳过 decide

rc.5 `connection.admit` 对浏览器 cookie 一律返回 `browserPeer`，principal 恒
`{kind:'owner'}`（`dsh-client-connection/lib/index.js:714`、`:790-800`）；而
`prepareInvocation` 只在 `peer.principal.kind !== 'owner'` 时才做
`remoteAccess.decide`（`dsh-api-gateway/lib/index.js:1204`）。旧 admit 包装只对
`/api/remote.mux` 换血（`packages/access/src/mux.ts` 旧 §2），terminal 一元面因此
既无租户身份、也无网关判定 → B 读到 A 的 `cwd`/`shells`（本轮 FAIL 实测）。

### 1.3 缺少会话级动作授权：终端六方法的资源是逐会话

rc.5 `terminal/{environment,shells,list,create,close,rename}` 描述符首参是
`source:'lookup', lookup:'agent'`（`dsh-api-terminal-controller/lib/typert.host.js` 各方法
`parameters[0]`），`list` 是具名 `sessionId`；agent lookup 的 resource 是 `session`
（core/agent `lib/index.js:452`），`list` 由 session 解析器按参数名直读
（`dsh-api-session-controller/lib/index.js:3495-3506`）。`remote-access.evaluate` 对资源
做 `sameResource` 严格匹配（`dsh-api-remote-access/lib/index.js:338`）——global 绑定
永不命中 session 资源，所以这些动作必须授在**会话绑定**上（只授 global 会让本人
终端也恒 no-allow）。

## 2 TERM-004 修法

| 文件 | 改动 |
|---|---|
| `packages/access/src/mux.ts:109-145` | 新增 `TERMINAL_UNARY_PATH_PREFIX` / `isTerminalUnaryPath` / `TERMINAL_UNARY_ACTIONS`（六动作，注释含资源逐会话的证据链） |
| `packages/access/src/mux.ts:453` | 会话角色动作清单并入 `TERMINAL_UNARY_ACTIONS`（本人会话放行） |
| `packages/access/src/mux.ts:557-565` | admit 包装：`/api/terminal/*` 按 eterna_session 换血 per-user Peer（与 mux 同用户缓存）；无会话 401；策略面未就绪先 `retryPolicy()`，仍缺席 **503 fail-closed**（绝不退回 owner） |
| `packages/access/src/terminal.ts:28-45,72-84` | 身份面：`invocation.peer.principal` 优先、旧 `invocation.principal` 兜底；从调用点 `this.ctx.invocation` 读（`invocationOf`） |
| `packages/access/src/terminal.ts:112` | 上游本体改 `Reflect.apply(target, this ?? terminalService, args)`——保留调用点 `this`，否则 attach/retain 的 `this.ctx.invocation` 退化为 undefined（"Terminal attachment requires a Remote invocation"） |
| `scripts/verify-terminal-guard.mjs:69-86` | `denied()` 接受上游一元拒绝码 `remote-access/denied`（唯一一元跨租户拒绝码；拿到数据一律判非拒绝，判定强度不变） |

防漂移/回归锚（新增测试）：

- `tests/mux-drift.spec.ts`：新增 `upstreamTerminalUnaryMethods()`——断言
  `TERMINAL_UNARY_ACTIONS` 与上游 `typert.host.js` 非流方法表**双向相等**；
  断言它们不在流清单/GLOBAL 清单，且会话绑定实名含六动作。
- `tests/mux-peer-drift.spec.ts`：终端路径换血（六路径逐个）、同用户复用缓存、无/坏
  cookie 401、近形路径不误伤、策略未就绪 503 + 服务挂载后现场补注册即放行。
- `tests/mux-policy.spec.ts`：会话角色动作清单含 `TERMINAL_UNARY_ACTIONS`。
- `tests/terminal-tenant.spec.ts`：rc.5 `peer.principal` 形态下本人放行/他人拒绝；
  调用点 `this` 原样透传给上游本体。

## 3 RC5-IMP-005 根因（环境态，非产品代码缺陷）

现象：导入返回 `outcome.sessionIds=10`、审计 `access.chatImport import.ok sessions:10`，
但脚本读库 `delta=0`、`allImportedPresent=false`。

取证（`imp005-rootcause-proc-fd.txt`）：

```
lrwx------ 30 -> /data/access/users.db
lrwx------ 33 -> /data/access/users.db-wal (deleted)
lrwx------ 34 -> /data/access/users.db-shm (deleted)
users.db mtime 2026-11-19 22:09（此后不再变化）
```

长连接仍持有**已被删除**的 WAL/SHM inode：`recordSession` 写进已 unlink 的文件，
写入对任何新连接（宿主或容器内）都不可见——所以审计计数对、落盘行对不上。
同一数据根曾被多个测试容器（`rc5-e1suite` / `-boot8` / `-super`，均 mount
`eterna-data/test-rc5/e1`）共用，最后一次 checkpoint/删除把在跑容器的 WAL 摘掉。

修法：用当前工作树重建镜像后**重建** `eterna-rc5-e1`（新连接重新打开真实文件）：

```
docker build --progress=plain -t eterna-agent:rc5-test .            # EXIT=0 → 48d82af(48782afaf8ba)
docker compose -p rc5-test-e1 --env-file <0600 .env.e1> \
  -f docker-compose.yml -f <compose.e1.override.yml> up -d --force-recreate eterna-agent   # EXIT=0
```

重建后 fd 面为 `users.db` / `users.db-wal` / `users.db-shm`（均无 `(deleted)`，
`e1-post-recreate-state.txt`）；门禁 `delta=10 allImportedPresent=true`。
产品代码零改动。

## 4 验证命令与结果（本机实跑）

| 命令 | EXIT | 结果 |
|---|---|---|
| `cd packages/access && npx vitest run tests/{terminal-tenant,mux-peer-drift,mux-policy,mux-drift}.spec.ts` | 0 | 43 passed（`unit-vitest-targeted.log`） |
| `cd packages/access && npx vitest run` | 0 | **49 files / 504 tests passed**（`unit-vitest.log`） |
| `cd packages/access && npx tsc --noEmit` | 0 | 无错误（`unit-tsc.log`） |
| `cd packages/access && npx oxlint --config ../../.oxlintrc.json .` | 0 | 0 warnings / 0 errors（`unit-oxlint.log`） |
| `docker build --progress=plain -t eterna-agent:rc5-test .` | 0 | 镜像 `48782afaf8ba`（2026-11-20T01:14:31Z 本地） |
| `docker compose ... up -d --force-recreate eterna-agent` | 0 | healthy（`StartedAt` 01:15:29Z） |
| `node scripts/verify-terminal-guard.mjs --json …/final-terminal-guard.json` | **0** | PASS=11 FAIL=0 SKIP=0 NOTRUN=1 |
| `node scripts/verify-chat-import.mjs --json …/final-chat-import.json` | **0** | PASS=8 FAIL=0 SKIP=4 NOTRUN=0 |

补充探针（辅助证据，不替代官方用例）：

- `probe-terminal-positive.log`：A 自己的 environment/list 成功；`terminal/create` 仍是
  **上游**错误 `gateway/internal: session.snapshotEvents is not a function`（与换血无关，
  修前 A/B 同错；见遗留 R-TERM-CREATE）。
- `probe-terminal-no-eterna.log`：只有 dsh-auth、无 eterna_session 的
  `/api/terminal/{environment,list}` → **401 unauthorized**（fail-closed）。
- `probe-terminal-streams.log`：真实 `/api/remote.mux` 打开帧——A attach 自己会话到达
  控制器（`terminal/unavailable`，"Terminal no longer exists in this Session"，证明
  `this.ctx` 透传未破坏流面）；B attach/retain/watch A 的会话全部
  `remote-access/denied`（TERM-005 的真实 WS 证据；官方脚本仍按设计记 NOTRUN）。

## 5 遗留

见 `../summary.json`（`leftovers`）。要点：上游 `terminal/create` 的
`session.snapshotEvents` 断裂（TERM-002/003/006/012 依赖）；TERM-005 官方脚本未执行
WS 面（P6 必跑，本次探针只提供方向性证据）；同一数据根被多容器共用会再次摘掉 WAL
（建议每 suite 独立数据根 + prepare 前置 fd 检查）。