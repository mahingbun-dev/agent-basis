# @basis/extra

L1 收尾插件(T13;设计文档 08 §3 表 #10/#12/#13、12 §4.4、12 §10.3、14 排期 T13)。三个模块:

| 模块 | 文件 | 内容 |
|---|---|---|
| egress 完整版 | `src/domain-whitelist.ts` + `src/egress-wrapper.ts` | 域名白名单判定器(通配域名+端口,fail-closed)+ 出网工具包装器:在 `@basis/governance` egress-lite(工具级白名单+proxy 载荷)之上叠加**域名级**判定,包装 dsh `ToolDefinition`——未列名域名在底层执行前拒掉,放行调用强注 `HTTP(S)_PROXY` |
| reviewer preset | `src/reviewer-preset.ts` | 只读审查 subagent 的 preset 配置产物:`@deepseek-ai/dsh-agent-preset` 行 + `@deepseek-ai/dsh-persona` 行(persona 模板)+ 工具门(`ctx.tools.restrict`,allow = `read`/`grep`/`glob` 即 Read/Grep/Glob 的 DSH 工具名)+ `@deepseek-ai/dsh-tool-subagent` 委派行(provider=spawn + agentPreset);schema 校验 fail-closed |
| tenant realm | `src/tenant-realm.ts` + `docs/tenant-realm.md` + `assets/tenant-realm.template.yml` | 行业→客户两级 Cordis isolate realm 约定:`ind:<行业>` / `ind:<行业>:cust:<客户>` key 语法、`Symbol.for` label 相连性、隔离面词汇表(memory/knowledge/storage 客户级,audit 全局共享)、配置模板加载校验、`cordis:group` 行树生成 |

## egress 完整版:三层判定

```
调用 → ①工具级(governance EgressLite.classify:出网型工具名不在白名单 → 拒)
     → ②域名级(DomainWhitelist.check:参数中 URL 逐个判 host 通配+端口,未列名 → 拒,execute 不触发)
     → ③代理强注(EgressLite.withProxyEnv:放行的出网调用合并 HTTP(S)_PROXY 进 args.env)
```

- 域名通配语义:`example.com` 精确;`*.example.com` 任意深度子域(不含 apex);`api-*.example.com` 标签内通配(不跨点);IPv6 只允许字面量。规则可带 `ports`(缺省任意端口)。
- fail-closed:URL 不可解析 / 非 http(s) 协议 / 出网工具参数找不到目的地(缺省 `unknownDestination: 'deny'`)一律拒。
- 拒绝以结构化值返回(`{ egress: 'denied', tool, reason, layer }`,output schema 扩为 `oneOf(原值 ∪ 拒绝值)`),不中断 turn;渲染为用户可见文本。

## reviewer preset:产物形态

`buildReviewerPreset()` → `ReviewerPresetArtifact`(schema v1)→ `renderReviewerPresetYaml()` 渲染为可直接粘进 profile 的两行:`@deepseek-ai/dsh-agent-preset`(preset 声明,内含 persona 行 + `@basis/extra` 工具门行)与 `@deepseek-ai/dsh-tool-subagent`(委派行,`provider: spawn` + `agentPreset` 指向 preset——独立 preset 仅 in-process spawn 支持,见 dsh subagent README「Child presets」)。`validateReviewerPresetArtifact()` 全量校验(词汇表白名单 + 变更/出网 glob 黑名单双保险,preset 脱钩/档位错整包拒收);`applyReviewerToolGate(host, allow)` 在 agent 作用域挂 `ctx.tools.restrict({ allow })`,返回原生 disposer(effect 配逆)。

## tenant realm:两级约定

`ind:<行业>` 共享 L2 领域包与行业知识;`ind:<行业>:cust:<客户>` 私有 memory/knowledge/storage。承载面全原生:`ctx.isolate(service, tenantRealmLabel(realm))`(label = `Symbol.for('basis:tenant-realm:<key>')`,跨实例同 key 相连)+ `cordis:group` 嵌套行(行业组→客户组)。规范全文见 `docs/tenant-realm.md`,配置模板 `assets/tenant-realm.template.yml`(可被 `loadTenantRealmConfig` 原样加载,有单测钉住)。

## 验收门

```
pnpm --filter @basis/extra run verify   # = oxlint + tsc --noEmit + vitest run
```

单测四件套:域名通配匹配表 / 包装器拒未列名域名(底层 execute 不触发)/ preset 产物 schema 校验(坏形态整包拒收)/ tenant realm 语法+真实模板加载。

## 已知边界(诚实声明)

- egress 包装器是**插件层防线**:包装点之后的底层实现若绕过 `execute`(如进程内直连 socket)不在拦截范围——沙箱级强制见 12 §4.4「强合规行业出现时再升级沙箱层」。
- reviewer preset 的 `@deepseek-ai/dsh-tool-subagent` 行与 persona/preset 组合需真实 DSH host 装载验证(编译期已用已发布 0.2.2-alpha.2 类型钉住,运行时联调后置,见 PROGRESS blockers)。
- tenant realm 的 isolate 是服务作用域隔离,**不是沙箱**(dsh-scope README 原话);跨进程隔离靠部署约定(每租户独立配置目录)。
