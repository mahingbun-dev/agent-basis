# @eterna/audit — 审计留痕插件(T4 首插件)

设计权威:`docs/design/enterprise-plugins.md`(§2 选型、§3 接口、§3.3 effect 逆闭包、§4 路线表)。

## 能力面(P0 骨架)

| 面 | 内容 | 入口 |
| --- | --- | --- |
| A 审计事件流 | `session/event` → `@eterna/governance` 的 `AuditProjector`(tool/call+result 配对折叠、PII 脱敏、参数截断)→ 按日轮转 NDJSON `.eterna/audit-YYYYMMDD.jsonl` + 可选 `extraSinks` | 插件装载即接线,零配置 |
| C 留痕查询 | `ctx.audit.query(filter & { limit, cursor? })` 分页游标,返回 `{ records, nextCursor? }`;filter 支持 `kinds / tool(glob) / isError / since / until` | panel 与合规报表复用 |
| report 直投 | `ctx.audit.report(detail & { actor? })` — 治理侧事件(预算违规/令牌拒绝/准入)落账,`detail.actor` 提升为记录级 `actor`(pluginId + source,⑧插件粒度归属) | governance/P2 准入直投 |

**B 面(最小权限令牌核验 + `ctx.tools.guard`)按设计 §4 为 P1,本骨架不含**——guard seam 与保护表属于令牌核验工作项。

## 装载

```yaml
# cordis.patch.yml(- insert: 根层追加;裸 id 行会被 applyPatches 丢弃)
- insert:
    - id: eterna-audit
      name: '@eterna/audit/audit-plugin'
```

- `package.json` 带 `dsh.bundle.patch`;dsh 包(cordis / dsh-session)进 **peerDependencies**(插件硬性规范 3),自有库 `@eterna/governance` 进 dependencies;
- **默认关闭按需开启的对立面:审计是纯观察面,装载即生效、不拦任何调用**(不产生 allow/ask/deny,与 governance 的 pre-execute 无顺序耦合,§2.2-3);不需要时把 bundle 行置 `disabled: true` 或移除即可;
- 零 inject:审计必须在无 governance / 无 tools 服务的宿主上可装载(§3.0-2:inject 是硬依赖表)。

## 配置(`defineAuditPlugin(config)`)

| 项 | 缺省 | 说明 |
| --- | --- | --- |
| `dir` | `cwd/.eterna` | 落盘目录 |
| `filePrefix` | `audit-` | 文件名 `<prefix>YYYYMMDD.jsonl` |
| `extraSinks` | — | 第二 sink(追加在文件 sink 后) |
| `argsPreviewLimit` | 200 | 参数预览截断 |
| `piiPatterns` | governance 缺省四类 | PII 模式覆盖;`ctx.governance.pii` 在场时优先复用其实例(机会读取,不 inject) |

## 卸载口径(effect 逆闭包,§3.3)

顺序:摘 `session/event` 监听(停止增量)→ flush 冲账(fire-and-forget,吞错防阻塞宿主)→ 撤 provide。
验收断言用「**卸载后无新增 tool-call 记录**」而非「行数不变」:卸载前已进 pending 的 tool/call,
其 tool/result 在逆②之后到达时无人消费,该调用的 result 记录永不产生(在途窗口边界,设计已声明)。

## 验证

```bash
pnpm --filter @eterna/audit run verify   # oxlint + tsc + vitest
```

宿主级装卸 E2E(装载 → ctx.audit 在场/缺席、无新增 tool-call 口径)按 PLUGIN-AUTHORING §4
file: + symlink 配方进行,属入库提交步骤,不在本包 verify 范围内。
