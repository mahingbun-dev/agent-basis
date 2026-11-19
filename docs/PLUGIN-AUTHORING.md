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
4. **T4 memory 物理分库**(2026-11-13 起,M-M1 T5):`eterna-memory` 的 dbPath/portrait 路径必须落在 workspace 派生目录(`$DSH_HOME/workspaces/<账号>/` 语义;部署契约 working_dir=cwd,故默认派生=cwd 基 `join(cwd, '.eterna/memory.sqlite3')` + 与库同目录 `portrait.md`);禁 cwd 逃逸(`..` 段、join/resolve 混入绝对路径字面量、`os.tmpdir()` 基)。`packctl tenant-scan` 双面断言:逃逸面扫全部 packages 源码的 memory 持久化路径派生行(`tenant/memory-persist-escape`);派生锚 fail-closed 钉住 glue 插件与 `scripts/gen-portrait.mjs` 的默认派生形态(`tenant/memory-persist-anchor-missing`)——重构改道必须同步 `tools/packctl/src/tenant.ts` 的 `MEMORY_PERSIST_ANCHORS` 与本条再对账。测试 profile 的隔离目录经 config 注入(`config.dbPath`),不在静态判定面。
5. **启停语义**:L1 插件必须登记进 `packages/access/src/routes.ts` 的 `TOGGLEABLE_PLUGINS`(或红线清单);admin 停用 = 重启后 patch 行被 entrypoint 渲染管线裁剪——插件必须可缺席(audit 缺席降级纪律同样适用于启停)。红线默认:治理/审计/出网/门禁。
6. **mux 流隔离(原 R12,2026-11-11 已关闭)**:WS mux 流端点(`workspace/follow` 等)经 eterna-access 的 principal 换血+registerPolicy 过滤——mux 升级按 eterna_session 换血 per-user Peer(`packages/access/src/mux.ts`),策略绑定按归属账本动态返回,流 open 越权抛 `remote-access/denied`、列表按 `allows()` 逐项过滤(T2 E2E 容器实证:跨用户列表 0 命中、盗开会话流被拒)。防漂移:`packages/access/tests/mux-drift.spec.ts` 断言上游全部流方法∈策略动作清单。**新上游流端点落地时必须同步加入动作清单(测试即红)。** 新端点设计时仍避免把敏感数据放进列表元数据(过滤按资源归属,非字段级)。
7. **knowledge 物理分库(2026-11-17,与 T4 同源;2026-11-19 融合后锚迁到 `@eterna/knowledge-admin` 单宿主)**:`eterna-knowledge` 普通账号的知识库必须落 `<tenantRoot>/<账号>/`(wiki=`knowledge.wiki`,索引=`.eterna/knowledge.sqlite3`,tenantRoot 缺省 `$DSH_HOME/workspaces`);**admin 角色路由全局库**(cwd 基 `knowledge.wiki` + `.eterna/knowledge.sqlite3`,即"管理员看全局"的既定语义;面板与 Agent 工具的 admin 缺省目标同样是全局库 `*`);账号解析失败 fail-closed(Denied service,检索空/写入拒),**绝不退回全局库**。账号状态面 `'eterna-knowledge-accounts'`(panel 非 admin 唯一读入口)与单池分库路由(`BackendPool`,按绝对路径 keyed;禁止第二池)不得移除。`packctl tenant-scan` 锚钉:`tenant/knowledge-persist-anchor-missing`(`tools/packctl/src/tenant.ts` 的 `KNOWLEDGE_PERSIST_ANCHORS`,锚文件 = `packages/knowledge-admin/src/{paths,routing,service,types,index}.ts`)——改道须同步锚表与本条再对账。**写入门禁**:Agent 五工具(`knowledge_search/read/status/propose` + `knowledge_admin`)只能落 pending,`review` 已移出工具面;直接发布/审批只认 access 守卫铸出的真人 caller(`human:true`)。**面板与工坊的后端隔离必须落在 access 守卫层**(2026-11-17 部署实证):unary SRC 通道 `invocation.principal` 恒 owner(mux 换血只作用流通道),宿主侧 principal 判定在 unary 兜不住——敏感读/写端点须在 `packages/access/src/tenant.ts` 注册同路径守卫路由(cookie 身份):`/api/eternaPanel/snapshot` 按身份组装(admin 全局、普通账号本人记忆/知识库/会话,panel 包经 `'eterna-panel-accounts'` 提供组装面);`/api/eternaPanel/{review,reviewForAccount,trackCorrection}` 裸网关直调 admin-only;`/api/loopPrompt/*`(13 端点)非 admin 一律 `tenant/denied`。**面板与工坊的后端隔离必须落在 access 守卫层**(2026-11-17 部署实证):unary SRC 通道 `invocation.principal` 恒 owner(mux 换血只作用流通道),宿主侧 principal 判定在 unary 兜不住——敏感读/写端点须在 `packages/access/src/tenant.ts` 注册同路径守卫路由(cookie 身份):`/api/eternaPanel/snapshot` 按身份组装(admin 全局、普通账号本人记忆/知识库/会话,panel 包经 `'eterna-panel-accounts'` 提供组装面);`/api/eternaPanel/{review,reviewForAccount,trackCorrection}` 裸网关直调 admin-only;`/api/loopPrompt/*`(13 端点)非 admin 一律 `tenant/denied`。

#### 1.1.1 公共面路由映射(铁律 T2 的唯一豁免口)

个别**公开静态资源**在架构上无法走 access 的 `/access/*` 面,也拿不到 `webServer.tapIndex`(上游静态面对非 index 文件按通用文件路径原样返回,没有 transform 钩子)。这类资源可登记豁免,门槛硬性、四项缺一不可:

1. 公开静态资源(对任何访问者字节等价);
2. 不含任何用户/租户数据;
3. 无写操作(纯 GET/HEAD);
4. 不承载鉴权语义(既不判定也不旁路登录态)。

| 包 | 路径 | 性质 | 登记理由 |
| --- | --- | --- | --- |
| `brand` | `/manifest.webmanifest` | PWA 清单(站点名/图标引用) | 上游 `dsh-host-frontend-static` 的 `serveStatic` 对非 index 文件无 transform 钩子,品牌化只能以同路径 `kind: 'exact'` 路由接替 |

豁免实现于 `tools/packctl/src/tenant.ts` 的 `PUBLIC_SURFACE_ROUTES`,匹配**精确到包 + 调用块内 `kind: 'exact'` + 该路径字面量**三项同时成立。不做通配、不做子串放宽——否则任何插件在注册行捎带一个已登记路径字符串即可绕过门禁。防漂移用例:`tools/packctl/tests/tenant.spec.ts` 的「公共面豁免不得被滥用」(错包/错路径/prefix/fallback 四类仍判违规)。

新增条目 = 改 `PUBLIC_SURFACE_ROUTES` + 本表 + PR 说明,三者必须同期到位。

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
5. shadow 定义必须**浅拷贝透传原定义全部字段**(`{ ...def, execute }`,execute 是唯一换面):内核对**成功**结果走 `createSuccessResult` → `tool.output.schema` 校验 + `output.render` 投影(dsh-tools pipeline.js:712)——只返回 `{ execute }` 时成功调用必炸 `Cannot read properties of undefined (reading 'schema')`(2026-11-13 生产事故:副作用已发生、结果丢失;错误路径不碰 output,形成"部分调用正常"的误导对照)。

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
4. **市场分发**(可选):插件发布到独立官方仓库 [eterna-plugins](https://github.com/mahingbun-dev/eterna-plugins)(format 1 索引 + 自包含 bundle + 零漂移校验)——按其 `docs/PUBLISHING.md` 六步走:bundle 自包含化(只发 .js)、commit 钉版、索引追加版本条目、`node scripts/validate.mjs` 全绿。仅需随本仓演示/离线内嵌的条目才留在本仓 `market/index.json`(同款 format 1,勿重复上架同一插件)。

## 6. 创造模式专属须知

- **EternaAgent 部署中 plugin_manager/plugin_market 已裁切(2026-11-09 三方准入红线;2026-11-18 用户裁定不回加)**——上游 `install_bundle` 指令在本部署不可执行。个人工具型插件走 `install_personal_plugin`(进程内即时装载,免审批免重启,仅本人会话可见),契约见 `references/personal-tools.md`(品牌技能 fork)与 `docs/dev/tenant-plugins.md`;最小模板 `packages/brand/skills/cordis-plugin-development/templates/personal-tool/`。
- 全员可用 = 设置弹窗「我的插件」发起「转内置」(admin 审批/直转),通过后即刻全员生效(共享工具分区可启停)。
- UI/bundle 型插件不在个人层装载范围,需管理员手工 bundle 安装(上游 installBundle 语义:本地目录 link 进 profile + hmr 热应用;容器缺 pnpm 时不可用,诚实边界见 docs/dev/tenant-plugins.md §4)。
- plugin_manager 在上游非裁切部署中安装**需逐次审批**;build-script(pnpm approve-scripts)同审;`compatibility.json` 豁免需显式 accept-risk。
- 无 HMR 的 profile 改动报 `restart-required`——重启后生效,不是 bug。
- 自修改/装卸插件是**高危面**:生产 profile 建议禁用 plugin_manager 行(bundles 里 `disabled: true`),只在开发 profile 开放。
- **一键发布到官方插件市场(2026-11-19)**:agent 工具 `submit_plugin_to_market` 把本人 plugins 根下的工具插件自动送进 [eterna-plugins](https://github.com/mahingbun-dev/eterna-plugins)——bundle 化改写(清单重写/wrapper 入口/insert 补丁行)→ 仓库分支两段 commit(bundle+索引,索引钉 bundle SHA)→ `validate.mjs` 零漂移校验 → push 分支 → 开 PR。**main 有分支保护,永不直推**;CI(validate)绿 → 人工合并 PR → 发现页刷新即可给全员安装。范围边界:仅工具型(UI 型 dsh.client 拒发);TS 源拒发(个人层契约本就要求纯 JS);凭据走 `ETERNA_MARKET_GITHUB_TOKEN`(.env 注入,缺席=发布停在本地 commit 并返回手动 PR 链接)。实现:`packages/access/src/market-publish.ts` + `publish-tool.ts`。

## 7. Web 插件市场(发现页)现状

- **组成**:上游「发现」tab 由实验 bundle `@deepseek-ai/dsh-experimental-plugin-market-bundle` 提供(shipped profile **默认不装**);安装器服务 `plugin-manager` 本就在 dsh-base 宿主行,`ui-plugin-manager`(已安装页)在 web-app。启用发现页 = profile `dsh.profile.bundles` 追加该实验 bundle + `pnpm add` 该包——配置级变更在支持 HMR 的宿主(`dsh --profile`,带 profileContext,`dsh-base` 默认开配置重载)即时重组合,无 HMR 宿主重启生效(2026-11-19 实测:发现 tab、索引源添加、搜索、安装、启停全链贯通;插件首装/启停 `applied` 即时,替换已装载模块代码需重启)。
- **agent 面工具链维持裁切**:`tool-plugin-manager`/`tool-plugin-market` 在标准/创造预设均 `disabled: true`(2026-11-09 三方准入红线,2026-11-18 裁定不回加)——Web 面开放不改变此裁定;会话内 agent 仍不能自装 bundle。
- **✅ 市场面 admin-only(T6.1 已落地,2026-11-19)**:计划文档 §堵洞先行要求的「pluginManager/pluginMarket RPC 与 detail-file 路由 admin-only」实现在 `packages/access/src/mux.ts`:admit 包装(全部 `/api` 请求必经点,`dsh-client-connection lib/index.js:1049`)对 `MARKET_ADMIN_PREFIXES` 四前缀(`/api/pluginManager/`、`/api/pluginMarket/`、`/api/plugin-manager/`、`/api/plugin-market/`)按 eterna 会话收口——无会话 401(**即使持 owner 级 dsh 浏览器 cookie 也拒**,fail-closed)、非 admin 403、admin 走原 admit;角色逐请求现查(升降权下一次请求即生效)。同一策略对非 admin 不下发 `pluginManager/listBundles` UI 门(`ADMIN_ONLY_UNARY_ACTIONS`),插件页整页自然隐藏。admit 包装随插件 apply 首装(不等 remote-access 晚挂载,无「首请求前无门」窗口)。
  实测(2026-11-19,隔离宿主 eterna-web profile 双账号无头 E2E,**17/17 断言**):admin `listBundles` ok=true、`installBundle` 抵达安装器(参数层错误信封);bob(role=user)对 listBundles/installBundle/pluginMarket·setIndexes/plugin-market·detail-file **四面全 403**;仅持 dsh 浏览器 cookie、无 eterna 会话 → 401;非市场面(`/api/session/list`、`/api/my-plugins/list`)不受影响。单元面:mux-peer-drift(市场门 7 例)+ mux-policy(角色分派)+ gateway-role-gate(内容面同构豁免)。
  **残余边界(如实登记)**:①门在 access 插件内实现——部署若不含 eterna-access,市场无门(同 mux 隔离缺席语义);②审批人(approver)亦按非 admin 拒绝(市场装/卸是宿主级动作,裁定 admin-only);③agent 面 `tool-plugin-manager`/`tool-plugin-market` 维持裁切,不受本门影响。
- 索引源必须允许浏览器直连(CORS):raw.githubusercontent.com 可用;内网静态托管需带 `Access-Control-Allow-Origin`。
