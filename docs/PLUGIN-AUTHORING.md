# 插件开发指南(创造模式 / 本地开发 → 入库 agent-basis)

> 面向:想为 agent-basis 开发 DSH 插件(基座能力包 / 领域包 / 独立工具)的贡献者。
> 前置:Node ≥ 24(原生 TS type-stripping)、pnpm ≥ 10、`npm i -g @deepseek-ai/dsh@alpha`(可选,本地装载验证用)。

## 0. 先回答:你的东西应该放在哪

| 你要做的东西 | 放哪 | 形态 |
|---|---|---|
| 基座能力(治理/记忆/知识…) | `packages/<name>`(`@eterna/<name>`) | 服务库 + glue 插件 |
| 模型面工具(单工具或小工具集) | `packages/<name>/src` 或领域包内 | `defineTool` + 插件包装 |
| 行业领域包(persona/skills/工具/金集) | `packs/<行业名>`(`@<行业>/pack`) | `packctl init` 骨架 |
| 可执行 CLI(评测/脚手架) | `tools/<name>` | 独立 Node 程序 |

**铁律:零内核改动。** 一切能力经 DSH 官方 seam 承载(ctx.tools / ctx.slots / ctx.approval / events);不 fork、不 patch 官方源码。

## 1. 插件硬性规范(违反 = CI/packctl 拦截)

1. **模块 default 导出插件实例**(`export default defineXxxPlugin()`)——DSH bundle loader 取的是实例,不是工厂。漏写 = 静默不装载(E2E 实测教训)。
2. **list 槽注册必须带 `options.id`**(`list slot "..." requires options.id`)。
3. **dsh 包声明为 peerDependencies**(不进 dependencies)——避免与宿主内置副本单例分裂。例外:peer 声明写 `catalog:` 会被宿主兼容门按 semver range 校验判为 incompatible 强制 disabled(2026-11-07 T7 实测,证据见 docs/dev/t7-prompt-studio.md §2),此时与 packages/panel 同款放 `dependencies` + `catalog:`。
4. **客户端插件必须声明 `dsh.client.inject`**(消费的客户端包清单)+ `dsh.bundle`;**任何包被 plugin-manager 管理也必须有 `dsh.bundle`**("未声明组合包"→ 插件页显示异常)。
5. **Cordis 三纪律**:effect 配逆闭包 / coeffect 全声明 / provide 可交换接口(注册表+唯一 ID,命名空间 `@eterna/*`、`@<行业>/*`)。
6. `apply(ctx)` 返回的 disposer 收全全部逆(定时器/连接/注册),卸载零残留。
7. UI 只用官方语义令牌(`--dsw-alias-*` / `--dsw-radius-*`),不发明令牌。
8. **产品内功能=设置弹窗分区插件**(`settings.section` slot,参考 `packages/access/src/client/`;AGENTS.md 强制)——禁止自建独立页面;UI 用 DSH 官方语义令牌(`--dsw-alias-*`),资料合并保存/密码独立、两击确认替代原生对话框,深浅主题自动跟随。

### 1.1 多租户与隔离铁律(2026-11-10 起,`packctl tenant-scan` 强制)

EternaAgent 部署为多账号门禁形态(eterna-access):unary `/api` 端点由租户守卫按登录归属判定,`/api` 之外的 Web 面(登录/配置/管理页)由 access 独占。新插件违反以下任一条 = `packctl tenant-scan` 拦截(CI 已接入):

1. **T1 持久化必须在 DSH_HOME 语义之下**。部署契约 `working_dir=$DSH_HOME`(容器),持久化一律 cwd/env 相对基路径(audit 先例 `join(process.cwd(), '.eterna')`);**禁止硬编码容器绝对路径**(`/data/...`、`/root/...`)与 `os.tmpdir()` 持久化。每用户工作区目录由守卫分配在 `$DSH_HOME/workspaces/<账号>/`,插件的用户态数据派生自 workspace 路径。
2. **T2 路由面独占**:插件不得自行调用 `webServer.register*` / `registerFallback` / `registerUpgrade` / `connection.fetch.register` / `connection.rpc.handle|intercept`——绕过租户守卫的路由 = 隔离失效。新增数据端点的唯一正路:在 `packages/access/src/tenant.ts` 的守卫清单登记(归属校验+直调+记账),纯展示页走 access 的 `/access/*` 面。上游自有路由面(WS mux `/api/remote.mux` 等)不在插件控制内,勿仿写。
3. **T3 workspace 登记册独占写**:workspace 增删必须经 `workspaceController`(守卫层才有归属记账点),禁止直读写 `storages/workspace.json`。
4. **启停语义**:L1 插件必须登记进 `packages/access/src/routes.ts` 的 `TOGGLEABLE_PLUGINS`(或红线清单);admin 停用 = 重启后 patch 行被 entrypoint 渲染管线裁剪——插件必须可缺席(audit 缺席降级纪律同样适用于启停)。红线默认:治理/审计/出网/门禁。
5. **mux 流隔离(原 R12,2026-11-11 已关闭)**:WS mux 流端点(`workspace/follow` 等)经 eterna-access 的 principal 换血+registerPolicy 过滤——mux 升级按 eterna_session 换血 per-user Peer(`packages/access/src/mux.ts`),策略绑定按归属账本动态返回,流 open 越权抛 `remote-access/denied`、列表按 `allows()` 逐项过滤(T2 E2E 容器实证:跨用户列表 0 命中、盗开会话流被拒)。防漂移:`packages/access/tests/mux-drift.spec.ts` 断言上游全部流方法∈策略动作清单。**新上游流端点落地时必须同步加入动作清单(测试即红)。** 新端点设计时仍避免把敏感数据放进列表元数据(过滤按资源归属,非字段级)。

### 1.2 提示词登记铁律(2026-11-11 起,`packctl prompt-scan` 强制)

提示词工作室(ps-v2)是**全产品提示词唯一管理面**:三层全景可查可改、版本化、审批生效。反面强制 = 涉及提示词工程而未登记的插件/包被 CI 拦截(计划书成功标准 4)。**登记真值 = `packages/prompt-studio/src/registry.ts` 的 `PROMPT_REGISTRY_ENTRIES`**(对账文档 `docs/dev/ps-v2-registry-ledger.md`,条目型别/锚点/风险标注见 T1.3)。新插件/包触碰以下任一面 = 先登记再提交:

1. **patch 层 prompt 型 config 键**:cordis.patch.yml 里 `system-prompt` 的 `personaPrefix`、persona 插件的 `prefix`、plan-mode 插件的 `section`(profiles/packs/packages/market 四处都在扫描面)——注册表按 yaml 定位(file+rowId+pluginPath+configKey)精确匹配才算已登记。
2. **packs persona**:领域包根的 `persona.md`(06 号 SOP S1 分诊:角色/语气/全局硬约束)必须有对应领域层条目。
3. **运行时注入**:源码用 `ctx.systemPrompt.section(...)`(memory 形态)或 `inject: { systemPrompt: true }` 声明(glue 形态)必须有运行时注入型条目;T2.6 起改造为 section 文本从注册表读(登记制落地,缺席降级不炸宿主)。

**白名单与豁免标注**:确属豁免面(如注册表管理面本体、生成产物)在 `tools/packctl/src/prompt.ts` 的 `PROMPT_SCAN_WHITELIST` 登记,每条必须写 `reason`——缺标注的条目本身产出 warning 且退出码 1(豁免决定必须可审查)。已知边界:块标量正文里形似 `key: value` 的行可能误报(走白名单)、`systemPrompt` 别名调用静态不可见。

### 1.3 内核 frozen-args 合同(2026-11-13 起;违反 = 生产事故)

内核在 `createExecution` 时对工具参数做 snapshot + `deepFreeze`(`@deepseek-ai/dsh-tools` pipeline.js:331),且合同**明确禁止改写输入**:pre-execute 监听器返回值只能是裁决(`allow/deny/ask/cancel`,contracts.d.ts:312-336 "Input rewriting is excluded"),`tools/execute` 只许换 `exec.signal`,同名重复注册 fail-loud(egress-plugin.ts:8-11 记载)。**在 pre-execute 里原地写 `exec.arguments` 必炸**——2026-11-12 生产事故:access 插件瀑布末段写 `args._eternaToken`,`mcp__browser__*` 全灭(`Cannot add property _eternaToken, object is not extensible`)。

需要"服务端给工具调用附加凭据/上下文"时的唯一正路:**`ToolsService.executable` 分发边界实例 wrap**(dispatchToolBody 经它取 ToolDefinition 后才调 execute)。要点:

1. 对冻结 args **展开成新对象**再注入,绝不触碰原件(`{ ...args, token }`);
2. 实例级 in-place wrap 是既有先例(access `installSandboxBoundary` 的 `sandboxPolicy.resolve` wrap);wrap 要做工具名前缀短路(executable 是热路径)与 WeakMap 缓存,disposer 还原;
3. deny 语义 = throw(内核 `toolErrorResult` 物化为 `Error: ${message}`,与 pre-execute deny 形态一致,turn 不中断);
4. 凭据因此不进内核日志/审计/工具 schema(presenters 走 `ToolsService.get` 拿原定义)——"审计不落令牌值"依赖这一点。

参考实现:`packages/access/src/companion-inject.ts`(含 fail-closed deny 与未知会话 passthrough 语义)。另:pre-execute 瀑布仍是**判定**的正位(先于人审;egress/沙箱钳制同款),本节只禁止用它**改写参数**。

## 2. 环 A:DSH 创造模式(agent 帮你写,你审查)

```bash
# 以 agent-basis 仓库为工作区启动 Web(创造模式在会话头部切换)
cd /path/to/agent-basis
LITELLM_API_KEY=<key> dsh --profile <你的profile> web
```

- 浏览器打开会话,模式切「**创造**」(该模式挂 plugin_manager / plugin_market 工具)。
- 对 agent 说:「在 packages/<name> 开发一个 XX 插件,遵守 README 的插件规范」。
- agent 会:写 TS 源(带 `.ts` 后缀 import)→ 你审查 diff → 按第 4 节验证 → 你确认后 git 提交。
- 安装态验证:插件页「添加插件」支持 `link:` 本地路径与 git 源;plugin_manager 安装需逐次批准 + build-script 审批(官方安全机制,别绕)。

**审查红线**(不信任即打回):agent 声称完成 ≠ 完成;必须 `pnpm --filter <包> run verify` 真过 + 装载冒烟(见 §4)。

## 3. 环 B:本地手动开发

```bash
cd agent-basis
pnpm install                       # workspace 自动纳管 packages/* 与 tools/*
# 建包:packages/<name>/(package.json + tsconfig.json + src/ + tests/ + vitest.config.ts)
# 照抄 packages/governance 的四件套;dependencies 里 dsh 包写 peerDependencies
pnpm --filter @eterna/<name> run verify
```

包 `package.json` 最小模板:

```jsonc
{
  "name": "@eterna/<name>",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "verify": "oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run" },
  "dependencies": { "yaml": "catalog:" },          // 仅非 dsh 运行时依赖
  "peerDependencies": { "@deepseek-ai/cordis": "catalog:", "@deepseek-ai/dsh-tools": "catalog:" },
  "devDependencies": { "@types/node": "catalog:", "typescript": "catalog:", "vitest": "catalog:" }
}
```

插件模块骨架(注意最后一行):

```ts
export const XXX_PLUGIN_NAME = 'eterna-xxx'
export function defineXxxPlugin(config: XxxConfig = {}) {
  return {
    name: XXX_PLUGIN_NAME,
    inject: { tools: true } as never,
    apply(ctx: Context): () => void {
      /* 注册/装配;返回总 disposer */
    },
  }
}
export default defineXxxPlugin()   // ← loader 取 default export 实例,必须写
```

## 4. 装载验证(file: + symlink 配方)

```bash
# 独立验证宿主(已有 ~/.dsh/profiles/eterna-web 或自建)
cd ~/.dsh/profiles/eterna-web
pnpm add file:/abs/path/to/agent-basis/packages/<name>
# file: 依赖若被复制进 node_modules,改 symlink(Node 24 type-stripping 不允许 node_modules 下 .ts)
for p in <name>; do rm -rf node_modules/@eterna/$p; ln -s "$PWD/packages/$p" node_modules/@eterna/$p; done
pkill -f "profile eterna-web"; sleep 2
(LITELLM_API_KEY=<key> nohup dsh --profile eterna-web > /tmp/eterna-web-app.log 2>&1 &)
sleep 15; grep -icE "skipping|incompatible" /tmp/eterna-web-app.log   # 0 = 装载干净
```

## 5. 入库提交

1. `pnpm -w run verify`(全包)+ 新包 verify + 装载冒烟(§4)。
2. commit 信息以任务/模块开头;`docs/` 若有行为变更同步更新。
3. push → CI 绿(verify + packctl lint + replay 冒烟)。
4. **市场分发**(可选):`market/index.json` 加条目(官方格式 1,`source: git` 固定 commit + `path` 指向包目录),版本号 bump——别人的 DSH「发现」页填仓库索引 URL 即可一键安装/更新。

## 6. 创造模式专属须知

- plugin_manager 安装**需逐次审批**;build-script(pnpm approve-scripts)同审;`compatibility.json` 豁免需显式 accept-risk。
- 无 HMR 的 profile 改动报 `restart-required`——重启后生效,不是 bug。
- 自修改/装卸插件是**高危面**:生产 profile 建议禁用 plugin_manager 行(bundles 里 `disabled: true`),只在开发 profile 开放。
