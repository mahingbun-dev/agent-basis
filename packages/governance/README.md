# @eterna/governance

L1 治理插件核心(设计文档 08 §3、12 §4、14 号 T1):规则引擎、预算守卫、PII 过滤、审计投影、egress-lite。
本包是**策略纯函数层**——不触碰 Cordis ctx 全局(coeffect 全声明由组合层负责);组合层用
`createGovernance()` 的产物以 `ctx.governance` 服务(注册表 + `GOVERNANCE_SERVICE_ID` 唯一 ID)
形态 provide,可交换、可配逆。

## 模块

| 模块 | 入口 | 职责 | DSH seam |
|---|---|---|---|
| 规则引擎 | `src/rules.ts` | YAML 策略 → `evaluate(tool, args)` → `allow\|ask\|deny`;deny 优先;未命中 fail-closed 默认 ask(`default: allow` 在解析期被拒绝) | `tools/pre-execute` waterfall |
| 预算守卫 | `src/budget.ts` | `maxTurns/maxTokens/maxCost` 配置;session 事件记账;超限经 `agent.cancel({kind:'hook'})` 硬截断;耗尽后对一切工具 deny | `agent/turn-stopping` |
| PII 过滤 | `src/pii.ts` | 可插拔正则列表(缺省:手机号/身份证/邮箱/IPv4);`redact` 脱敏 / `assertClean` 拦截(抛 `PiiBlockedError`);供 memory/knowledge 写入前调用 | 纯服务,无 seam |
| 审计投影 | `src/audit.ts` + `src/sink.ts` | session 事件流 → 审计记录(turn-end / tool-call 配对 / usage / governance);`MemoryAuditSink` + `FileAuditSink`(NDJSON)双 sink;参数预览强制 PII 脱敏 | `session/event` 事件流 |
| egress-lite | `src/egress.ts` | 出网工具三态判定(local / outbound-allowed / outbound-denied)+ proxy 环境变量注入载荷(大 小写双形态 + NO_PROXY);白名单外出网工具 deny | `tools/pre-execute` + `tools/execute` 包装器 |
| 组合门 | `src/index.ts` | `createGovernance()`:`preExecute` 分层裁决 = 预算耗尽 → egress 白名单 → 规则引擎,任一 deny 即 deny | — |

## 策略文件示例

```yaml
default: ask          # 只允许 ask | deny(fail-closed)
rules:
  - id: deny-rm-rf
    effect: deny
    tools: ['shell*', 'bash*']   # tool 名 glob(支持 * ?)
    argsContains: ['rm -rf']     # 参数子串(稳定串化后 includes,OR)
    reason: '破坏性命令'
  - { id: allow-readonly, effect: allow, tools: ['read_*', 'grep_*'] }
```

## 预算守卫接线(组合层)

```ts
const guard = new BudgetGuard({ maxTurns: 8, maxTokens: 200_000, maxCost: 5 })
ctx.on('session/event', (_session, event) => { guard.applyEvent(event) })   // 记账
ctx.on('agent/turn-stopping', (e) => { void guard.onTurnStopping(e) })      // 超限 → agent.cancel({kind:'hook'})
// tools/pre-execute:governance.preExecute(call) 已内含 guard.preExecuteGuard(耗尽即 deny)
```

两层截断:turn 维度在 turn-stopping 边界 `agent.cancel`(阻止继续 steer 拉长);
token/cost 维度靠 `preExecuteGuard` 对工具全 deny——工具死循环里 turn-stopping 不触发,
这是唯一可靠截断点(dsh agent-loop README:220 "No built-in turn budget" 明示由插件在此类
lifecycle extension point 上 cancel)。

## seam 钉住(防 DSH pre-stable 破坏)

- 依赖**已发布的** `@deepseek-ai/dsh-{agent,session,tools}` + `@deepseek-ai/cordis`
  (0.2.2-alpha.2,与 deepseek-harness 完全同版,catalog 钉死),仅 `import type`。
- `tests/types.seam-pin.ts`(tsc 消费,vitest 不运行)断言:
  ① `BudgetGuard.onTurnStopping` 可直接赋给 `Events['agent/turn-stopping']`;
  ② `RuleEngine.preExecuteDecision` 的返回可作 pre-execute 决策(`GovernancePreDecision` → 官方 `PreToolDecision`);
  ③ `SessionEvent` 可直接喂 `applyEvent` / `projectEvent`。
  DSH 升级破坏任一形态 → `tsc --noEmit` 即失败。
- `tests/governance.spec.ts` 末段用官方载荷的**运行时结构**(agent/turn/signal、ToolExecution
  额外字段、seq/time 事件包)驱动治理件。

## 已知边界(诚实声明)

- egress-lite 是**引导级**:DSH `tools/pre-execute` 不能改写已记录参数(tools/README.md:197),
  proxy 注入以"载荷 + `withProxyEnv` 包装器"形态供 `tools/execute` 层应用——12 号文档 D-A
  决策(2026-11-03)已知悉并接受;强合规场景由 T13 egress 完整版升级沙箱层。
- 本包未在真实 DSH 运行时(acp 驱动/bundle 挂载)中联调——seam 兼容性靠上述编译期钉住 +
  运行时结构测试保证;需运行时联调(见 PROGRESS.md T1 备注)。
- maxTurns 语义:会话级累计轮数;单轮内 step 数不设限(交由 maxTokens 截断)。

## verify

```bash
pnpm --filter @eterna/governance run verify   # oxlint + tsc --noEmit + vitest run
```
