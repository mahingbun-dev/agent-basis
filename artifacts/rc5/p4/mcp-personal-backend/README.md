# B14 个人 MCP 存储 / 路由 / runtime — 证据(T26/T27)

日期:2026-11-20 · 工作树:/Users/sunny/code/agent-basis-rc5(分支 feat/dsh-rc5-merge)
依据:54 §4.6(T26/T27)+ §13.4 第 4 条;50 §3.4.2/§3.4.3;47 §7。证据已脱敏(无密钥/无 headers/env 值)。

## 1. 命令与退出码(原文)

| # | 命令(cwd=仓库根或注明的包目录) | EXIT | 摘要 |
|---|---|---|---|
| 1 | `pnpm --filter @eterna/access exec tsc --noEmit` | 0 | access 全包类型检查通过(空输出) |
| 2 | `pnpm --filter @eterna/access exec oxlint --config ../../.oxlintrc.json .` | 0 | `Found 0 warnings and 0 errors.`(103 files / 87 rules) |
| 3 | `pnpm --filter @eterna/access test` | 0 | **46 test files / 453 tests passed** |
| 4 | `cd packages/access && npx vitest run tests/mcp-personal-routes.spec.ts tests/mcp-personal-runtime.spec.ts tests/mcp-personal-wiring.spec.ts --reporter=verbose` | 0 | **3 files / 43 tests passed**(B14 定向) |
| 5 | `pnpm install --frozen-lockfile --offline` | 0 | 加依赖后锁文件一致性验证通过(`Lockfile is up to date`) |

日志:`access-tsc.log`、`access-tsc.exit`、`access-oxlint.log`、`access-oxlint.exit`、
`access-vitest.log`、`access-vitest.exit`、`mcp-personal-targeted.log`、`mcp-personal-targeted.exit`、`diffstat.txt`。

> 依赖安装说明:首次 `pnpm install --offline --filter @eterna/access` 重写了 `pnpm-lock.yaml`
> (pnpm 版本差异导致大面积 prune)。已用 `git checkout -- pnpm-lock.yaml` 还原,并只手工追加
> `packages/access` importer 的 6 行(`dsh-mcp-client`、`dsh-scope`),`--frozen-lockfile` 复验通过。
> 未 `git reset/clean/stash`,未改其它 importer。

## 2. 接线(54 §13.4 第 4 条)

| 位置 | 事实 |
|---|---|
| `packages/access/src/plugin.ts:190` | `mountPersonalMcp(ctx, ...)` 装配 runtime(store/sessionOwner/config/masterKey/cwdOf) |
| `packages/access/src/plugin.ts:279` | `onLogout` → `runtime.disposeUser(user.id)`(登出摘 scope) |
| `packages/access/src/plugin.ts:536` | `installMcpPersonalFetchRoutes({...}, {fetch: ctx.connection.fetch, onRequest: ensureMux/Sandbox/Terminal})` |
| `packages/access/src/mcp-personal.ts:559` | `registerMcpPersonalRoutes` 五端点实现(catalog/list/upsert/delete/probe) |
| `packages/access/src/mcp-personal.ts:958` | `installMcpPersonalFetchRoutes`:登录门(401 帧)+ RPC 信封 + fetch 注册;内部调用 `registerMcpPersonalRoutes` |
| `packages/access/src/store.ts:184,324` | `migrateMcpPersonalSchema`(user_version 0→1)在 `UserStore` 构造器执行;两表 `mcp_personal_server/mcp_personal_secret` |
| `packages/access/src/routes.ts:68,441` | `AccessDeps.onLogout` 可选钩子;`handleLogout` 调用(异常吞掉不阻断登出) |
| `packages/access/src/mcp-personal-runtime.ts:156` | `mountPersonalMcp`:agent/created|disposed + tools/pre-execute|execute 四监听均 `{global:true}` |
| `packages/access/src/mcp-personal-runtime.ts:325` | `createMcpClientProbe`:`probeServer` 适配(10s) |

## 3. 断言结果(43 条定向测试)

- 401:`未登录` 帧码 `tenant/unauthenticated`。
- 403 与不存在同响应:bob 对 alice 的 id 做 delete/probe/upsert → 与随机不存在 id 完全同帧同文案。
- stdio 只认 catalog_id:自填 `command/args/argv/commandLine` 一律拒绝;目录外 catalogId 拒绝;
  合法目录项由服务端解析 command/args,`serverName=p<uid>_<slug>`(≤32)。
- HTTP:拒 `169.254.169.254`、`[fd00:ec2::254]`、`file:`/`ftp:`/非法 URL;
  `personalHttpHosts=[]` 放行,非空精确/`*.suffix` 白名单,未命中拒绝。
- 密钥:AES-256-GCM 密文落库;错密钥/篡改信封 → undefined;IV 每次不同;
  列表只回 `hasSecret`/`headerNames`;明文不出现在响应/审计;probe 异常文本 `[redacted]`。
- 主密钥:hex/base64/32 字符解析;`ETERNA_MCP_MASTER_KEY` 或 `.secrets/` 内文件
  (`.secrets/` 外路径拒绝);缺席/不可读 fail-closed。
- 限额:第 9 条拒绝;>256KB 配置拒绝且不落库。
- probe:`{ok,toolCount}` 单对象;10s 到点 AbortSignal 被 abort;stdio 工作目录=用户根。
- kill switch:`enabled=false` 五端点 `mcp-personal/unavailable`;缺主密钥同;
  runtime 不挂且 `tools/pre-execute` deny 个人工具。
- 生命周期:delete / `enabled=false` 调 `runtime.disposeUser`;登出 POST `/logout` 调 `onLogout`;
  `disposeUser` 幂等、不影响他人;`agent/disposed`/effect 清理摘 scope。
- 启动预算:单条插件调用超预算(测试缩短为 20ms)→ 只 warn、Agent 创建不被阻塞、空 scope 释放;
  生产值仍为 `MCP_PERSONAL_STARTUP_TIMEOUT_MS=8000`。
- 归属账本异常:agent/created 只 warn 不挂;守卫 deny(异常不穿透到工具管线)。
- 跨租户:同用户子代理(账本归属相同)放行;跨用户/无归属 `tools/pre-execute` deny、
  `tools/execute` 抛错;非个人工具(`mcp__browser__*`)透传。
- 迁移:新库 `PRAGMA user_version=1`、两表存在;重开幂等。
- 接线防漂移:plugin/runtime/store/package.json 调用点与依赖声明存在(5 条源文本断言)。

## 4. 本次修复的真实缺陷

- `store.ts` 的 `mcpSelect(where)` 声明 `?` 占位符但 `.all()` 未绑定参数
  → `listMcpServers/listEnabledMcpServers/getMcpServer` 在 node:sqlite 下必然取不到行;
  已改为变参绑定,并补 `ORDER BY created_at, rowid`(同毫秒插入顺序稳定,4 连接截断可复现)。
- probe 路由此前重复审计(两次 `mcp.personal.probe` 事件)且失败错误未脱敏;已合并为单事件 + 脱敏。

## 5. 遗留(不在本 lane 可闭合范围)

- `scripts/verify-mcp-personal.mjs`(54 §13.4/51 MCPP-001..023)未创建:54 行 594 归 T47(P6 脚本 lane);
  本次只交 access 单测;真实 dsh-mcp-client probe/子进程未经 E2E。
- B14 系统层 T25(tenant.ts `mcp-manager` 命名空间门)属另一 lane,本次未触碰 tenant.ts。
- B14 个人层 UI(T28)与 `lib/client.js` 重建未做(禁改 client/**)。
- 条目删除不清理 `mcp_personal_secret`(ref 按用户复用);跨多次更新可能残留过期 ref,
  建议后续加引用计数/清理。
- “≤4 连接”当前按 50 §3.4.3 的 `rows.slice(0,4)` 解释为**每 Agent**;多 Agent 同用户可超过 4。
  若产品口径是“每用户聚合 ≤4”,需另立拍板并改 runtime 计数。
- kill switch 配置在 apply 时读取,运行时切换需重启(动态开关未做)。