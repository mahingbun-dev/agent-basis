# TODO · 每日执行清单

> 用途：把 `docs/design/47-上游DSH-0.2.2-rc.5合并评估与开发方案.md`（下称 **47**）与
> `docs/design/48-容器数据持久化目录改造方案.md`（下称 **48**）落成每天可勾选的执行清单。
>
> 状态（2026-11-19）：**方案评审阶段，未开发、未改生产**。
> **已拍板**：rc.5 直接上生产；mcp-manager/office 纳入；普通用户可增删 MCP（个人层，
> HTTP 接受 http/白名单暂关）；v1 线进本分支；数据根 `$HOME/eterna-data`；基于
> `origin/main` 干净 worktree；terminal-panel 全量应用、WebWorker 不产品化（见 §2）。
> 本文件是活文档：开工前勾当日项，收工补「每日记录」，未完成项顺延到次日，不删除历史。

## 0. 使用规则

- 每天只从「今日」一节取任务，不跨节乱抓；当日完不成就在记录里写明原因并顺延。
- 每个勾选必须附证据（命令输出、测试名、截图路径、容器/镜像 tag），不接受“感觉好了”。
- 涉及生产的步骤（改 compose、停容器、迁数据、升镜像）**必须单独确认**后执行。
- `git push` 单独确认；不把并行会话的未提交改动卷进本分支。

## 1. 关联文档与前置

- [47 上游合并方案](../design/47-上游DSH-0.2.2-rc.5合并评估与开发方案.md)
- [48 持久化方案](../design/48-容器数据持久化目录改造方案.md)
- 现有升级 SOP：`docs/upgrade-gate.md`
- 工作树现状：存在其它会话的未提交修改与未跟踪的 v1 内核目录。P0-6 已定：
  基于 `origin/main` 新建干净 worktree；v1 线按 P0-5 完整入库（B11），不从脏树直接带入。

## 2. 决策与待拍板（未决前不进入对应阶段）

| # | 决策 | 影响阶段 | 建议 | 状态 |
|---|---|---|---|---|
| P0-1 | rc.5 是否上生产（当前是 npm `next` 预发布） | 全部 | **已拍板：上生产**（2026-11-19）；按 47 §5 Phase 6 全门禁 + 旧镜像回滚 | 已拍板 |
| P0-2 | 两段升级（rc.1 检查点 → rc.5）还是一次到 rc.5 | Phase 1 | **已拍板：直接 rc.5**（2026-11-19）；不设 rc.1 检查点，Phase 2 并入 Phase 1 | 已拍板 |
| P0-3 | 宿主持久化根路径与迁移窗口 | 数据轨 | **已拍板：家目录专用文件夹**（2026-11-19）；固定 `$HOME/eterna-data/<instance>` 整树单挂载 | 已拍板 |
| P0-4 | mcp-manager / office 家族是否纳入 | Phase 3 | **已拍板：纳入**；mcp-manager 系统层 admin 专属 + 个人层按用户；office 补字体/Python 库 | 已拍板 |
| P0-5 | v1 `@basis/*` / `@core/*` 是否纳入本次分支 | Phase 4 | **已拍板：进本分支**（2026-11-19）；B11 必做，`core/cordis` re-vendor 4.1.0，补 `bundle-core` 缺口（H15） | 已拍板 |
| P0-6 | 干净 worktree 的路径与并行会话协调方式 | Phase 0 | **已拍板：基于远程 `main`**（2026-11-19）；`git worktree add ../agent-basis-rc5 -b feat/dsh-rc5-merge origin/main` | 已拍板 |
| P0-7 | B14/B15 的安全/镜像配套是否按 47 设计执行 | Phase 3/6 | **已确认：不缩减**（2026-11-19）；B14 两层 + B15 镜像清单全做 | 已确认 |
| P0-8 | `deepseek-chat-import` 是否纳入 | Phase 3/5 | **已拍板：支持**；按 47 B16 四道门（access 路由/流式记账/失败对账/审计） | 已拍板 |
| P0-9 | ACP 部署形态 | Phase 3/6 | **已拍板：加入**；独立 `eterna-acp` profile + 独立 service，仅运维本机、无端口 | 已拍板 |
| P0-10 | 上游实验 bundle 默认集 | Phase 3/5 | **已拍板：按 chat-import/session-search/plugin-market 默认开**（2026-11-19 确认）；其余可开/不可用 | 已拍板 |
| P0-11 | hero 品牌浮层 | Phase 5 | **已拍板：合入**；`@eterna/brand` 占 `conversation.hero.frame` + `hero.brand.mark` | 已拍板 |
| P0-12 | terminal-panel / WebWorker | Phase 3/5 | **已拍板：terminal-panel 全量应用（web+super），WebWorker 接受不产品化**（2026-11-19） | 已拍板 |
| P0-13 | `dsh-commands` | Phase 3/5 | **已具备**（base/web-app 自 rc.1 已有）；只做斜杠命令验收，不新增行 | 已确认 |
| P0-14 | 普通用户能否增删 MCP 服务器 | Phase 3/5（B14） | **已拍板：能**（2026-11-19）；只限个人层；**HTTP 接受 `http:`/任意 host、白名单暂关**（元数据仍拒） | 已拍板 |

## 3. 总排期（草案，按实际开工日顺延）

| 里程碑 | 内容 | 预估 | 完成定义 |
|---|---|---:|---|
| M0 | 评审 + 拍板 + 基线冻结 | 0.5 天 | 决策有记录、基线日志齐全 |
| M1 | **上线必含集**：版本族 + peer + H1/H2 + profile 迁移 + v1 线/cordis 4.1.0 + MCP 两层 + office 安全配套 + chat-import 租户桥 + ACP profile/service + 默认 bundle + hero 品牌层 + terminal-panel | 19–25 天 | 47 §6 关键门禁 + MCP/office/chat-import/ACP/terminal E2E |
| M2 | **推荐集**：+ skills/compaction/client 重建/mcp-client/检索/安装回归 | 22–30 天 | 产品面不退化 + 浏览器 E2E |
| M3 | **完整集**：+ agent-team/Dockerfile/llm-openai | 24–32 天 | 47 §6 全门禁绿 |
| M4 | 数据持久化迁移 | 与 M1–M3 并行 | 48 §10 验收清单全绿 |

> 47 的总评工作量为 **L+（约 4 周，推荐集 22–30 人日）**；48 的迁移必须在
> FUSE 浸泡与 integrity_check 通过后才执行。单段升级（P0-2）已把原 Day 1–4 的
> 两段版本迁移压成一段，但 H1/H2/行为项一件不能少。

## 4. 今日（2026-11-19）

只做评审与冻结准备，**不开发**。

- [x] 记录拍板（2026-11-19）：mcp-manager/office 纳入；rc.5 上生产
- [x] 记录 v5 拍板（2026-11-19）：chat-import 支持；commands 已具备；cordis 强制更新；
      ACP 加入；实验 bundle 默认化；hero 品牌浮层合入
- [x] 记录 v6 决议（2026-11-19）：直接 rc.5；数据根 `$HOME/eterna-data`；v1 线进本分支；
      `origin/main` 干净 worktree；普通用户可增删 MCP（个人层）
- [ ] 评审 47 v7：确认 B14 两层、B11/H15、B20 终端、H14/H16 与 §4 T6 结论无异议
- [ ] 评审 47：确认 A/B/C/T 分类（A11/B19/C8/T4）与硬阻断无异议
- [ ] 评审 48 v2：确认整树单挂载（方案 A）、家目录根路径与 FUSE 先测后迁
- [x] 确认 P0-2/P0-3/P0-5/P0-6，结论已写回 §2
- [ ] 确认 P0-7（B14 两层/B15 配套不缩减）、P0-10 默认集、P0-12（terminal/WebWorker）
- [ ] `git status` + `git branch --show-current` 记录工作树现状；确认哪些改动属于其它会话
- [ ] 建干净 worktree：`git fetch origin && git worktree add ../agent-basis-rc5 -b feat/dsh-rc5-merge origin/main`
  （先把 47/48/TODO 从当前树迁入/提交到该分支，避免方案文档丢在脏树）
- [ ] 建回滚点：旧镜像 tag + 生产 `/data` 冷备（单段升级无 rc.1 中间点）
- [ ] 记录基线（只读）：
  - [ ] `pnpm -w run verify` 结果
  - [ ] `node scripts/verify-eterna-web.mjs` / `verify-eterna-super.mjs` 结果
  - [ ] 生产镜像 digest、`dsh --version`、`/data` 顶层清单
  - [ ] `profiles/*/package.json` 快照
- [ ] 输出 `docs/dev/baseline-2026-11-19.md`（版本/测试数/通过率/截图路径）
- [ ] 确认 48 的测试实例方案：独立端口 + `$HOME/eterna-data/test-<date>`，绝不复用生产容器

**今日完成标志**：P0 决策全部有结论；基线文档落盘；未动任何生产与代码。

## 5. 逐日排期（Day 1 = 实际开工日）

> v6 变更（直接 rc.5 / v1 进分支 / MCP 两层）使原两段式 Day 1–4 压缩为单段，
> 原 Day 3–4 的 rc.5 版本与类型工作并入 Day 1–2；v1 线（B11）从「可选」改为 Day 9 必做。
> 个人 MCP（B14 个人层）与 terminal-panel（B20）使 Day 11/13 工作量增加，整体预计
> 顺延 **4–6 天**；逐日表是骨架，按实际人日 22–30 顺延，不把日期当承诺、不把未跑项标绿。

### Day 1 · Phase 0 收尾 + Phase 1 依赖（单段 rc.5）

- [ ] 基于 `origin/main` 建干净 worktree 与分支（见 §4）；确认 `git status` 干净
- [ ] 把 47/48/TODO/basis.yml 等方案文件迁入该 worktree 并提交（不丢在脏树）
- [ ] catalog 全族 → `0.2.2-rc.5`（20 个 `dsh-*` + cordis 4.1.0 + cosmokit 1.9.0 +
      schemastery）
- [ ] 根 devDeps、llm-openai、packs、market、basis-minimal 对齐 rc.5
- [ ] `tools/evals` 的 `dsh-session`/`dsh-user-approval` 改 `catalog:`
- [ ] `audit/extra/governance` 的 loader/include 对齐 rc.5 实测版本
- [ ] 根 `engines.node` → `>=24.9.0`
- [ ] 补 peer：`dsh-error`、`dsh-agent-preset-registry`、`dsh-typert-registry`、
      `dsh-timeout`、`dsh-credentials`、`dsh-mcp-manager`、`dsh-mcp-client`、`dsh-scope`
- [ ] `pnpm install` 刷新 lockfile；`git diff` 逐文件过目，只应有版本与锁文件变化
- [ ] `pnpm install --frozen-lockfile` 自洽

**门禁**：install 绿；锁文件无范围符/意外包；版本残留扫描旧版号=0（历史文档豁免）。

### Day 2 · Phase 1 必做适配（H1/H2 + 行为项）

- [ ] H1：`compaction/src/basic/summarizer.ts:166,207`、`memory/src/extraction.ts:253`、
      `llm-openai/src/adapter.ts:105` 改 `LlmError.fromFailure` / 内置错误码
- [ ] H2：`tasks/src/executor/background.ts:24-26,58,159-161` 迁
      `waitForTreeWork/listDescendants/drainDescendants`，`sendMessage` 改树内寻址
- [ ] 修 `GenerateOptions` 泛型、`ToolGuardDenial`、subagent/plugin-manager 类型、
      `PluginTabProps.update()`、`Menu` API 引用
- [ ] 全仓搜日志级别数值比较，按 `LoggerLevel INFO=2/WARN=1` 复核
- [ ] 投影帧 `{seq,changes[]}` 消费点复核
- [ ] 全仓 `pnpm -w run verify`；逐条修红
- [ ] `pnpm --filter @eterna/llm-openai typecheck`（该包无 verify，不能漏）
- [ ] tasks worker 真回执 E2E（证明 H2 不再 TypeError）

**门禁**：全仓 verify + llm-openai typecheck + tasks E2E 全绿；否则不进 Day 3。

### Day 3 · Phase 1 收尾（boot/漂移/回滚边界）

- [ ] 双形态真 boot：`verify-eterna-web.mjs` / `verify-eterna-super.mjs`
- [ ] access 漂移测试：`mux-drift` / `mux-peer-drift`
- [ ] `packctl form-check`
- [ ] LoggerLevel 行为测试；投影帧回归
- [ ] 记录 rc.5 写入 `team/mode` 后的回滚边界（H7）：新会话只在 rc.5+ 打开
- [ ] 若红：整提交 revert + 旧镜像/旧卷回滚；不半截前进

**门禁**：Phase 1 全绿；单段升级的唯一回滚点（旧镜像 + 冷备）已演练可用。

### Day 4 · Phase 1 冻结 + v1 线入库准备

- [ ] 打 Phase 1 检查点 commit/tag（仅内部标记，不是可回滚运行版本）
- [ ] v1 线预检：`git ls-files` 现状、`pnpm-lock` 覆盖、`bundle-core` 缺口（H15）
- [ ] 决定 `basis.yml` 删除 `bundle-core` 行（47 B11 方案 A）并记录
- [ ] 运行态文件检查：`git status` 无 `.eterna-*home*`、无凭据、无 node_modules
- [ ] 开始 `core/cordis` 4.1.0 re-vendor 的差异阅读（不要求当日完成）

**门禁**：v1 入库清单与删除项明确；无运行态文件混入。

### Day 5 · Phase 3 profile/preset 重放（1/2）

- [ ] 从 rc.5 两个 bundle patch 重读行集，更新 5 份模板/清单
- [ ] 新增行决策落地（2026-11-19 拍板）：
  - [ ] `agent-team` / `tool-agent-team` / `ui-agent-team`：开
  - [ ] `ui-file-actions` / `ui-context-menu`：开
  - [ ] `mcp-manager`：**开**（系统层空 servers + admin 专属配置面 + 全局守卫；
        个人层表 `mcp_personal_server`/`mcp_personal_secret` 随 access schema 迁移）
  - [ ] `office-kit` / `skill-office`：**开**；`tool-office` 进 standard/ptc preset
  - [ ] `deepseek-chat-import`：**开**（config 按 47 B16；access 门 Day 11 补）
  - [ ] `workspace-dependencies`：显式禁（web 形态 Desktop 专属）
  - [ ] `ui-account-notifications`：禁
- [ ] preset-standard：`tool-office` 开、`interrupt:false` 补、`customSkillDirs` 改品牌
- [ ] preset-cordis：persona 第三行 + `interrupt:false` 重放并品牌化
- [ ] 删死行 `account-controller`；删 `office-to-pdf` 并换 office-kit/skill-office 启用行
- [ ] **B18 默认 bundle**：`docker/profile/package.json` 加 chat-import/session-search/plugin-market
- [ ] **B20 terminal**：profile bundles 加 `@deepseek-ai/dsh-experimental-terminal-bundle`；
      web/super patch 设 `preferredShells:['bash']`、`readUserTerminals:false`（ACP 不加）
- [ ] **B17 ACP profile 文件**：`package.acp.json`、`cordis.acp.patch.yml.template`、
      `profiles/eterna-acp/cordis.patch.yml`（只覆写 base/acp-app 实际行）

### Day 6 · Phase 3 profile/preset 重放（2/2）

- [ ] 更新 `verify-eterna-web/super` 的 CUT_ROWS / HOST_KEPT_ROWS / 版本串
- [ ] B1：`scripts/profile-upgrade-check.mjs` 预检脚本
- [ ] B1：迁移 `dsh-experimental-agent-team-profile`（删除 + 留痕）
- [ ] **B14/H9**：`docker/profile/migrate-mcp-servers.mjs` 接入 entrypoint
      （prompt 移植后、relay sed 前）；升级前后 `mcp-manager.config.servers` 键集合一致
- [ ] **B14 个人层 schema**：access 迁移新增 `mcp_personal_server` / `mcp_personal_secret`；
      旧库 `user_version` 升级；行数/属主在 `/data/access` 迁移后一致
- [ ] **B18/H11**：`docker/profile/migrate-profile-bundles.mjs` 接入 entrypoint
      （manifest 渲染后）；`.eterna-default-bundles.json` opt-out 标记；旧卷只追加一次
- [ ] 启动 stderr 检查：无 `disabling profile plugin`；未知行 id=0
- [ ] 双形态真 boot；用户装品（hello-market / knowledge-admin）仍在
- [ ] **B17**：ACP profile 真 boot（`dsh --profile eterna-acp --help` 不占 stdin/stdout）

**门禁**：profile 重放全绿；用户装品不丢；form-check 绿。

### Day 7 · Phase 3 锚点同步（H6）

- [ ] 先定稿 `profiles/eterna-web/cordis.patch.yml` 行序
- [ ] 重算 `prompt-studio/src/registry.ts` 10 个锚点（line + contains）
- [ ] 重算 prompt ledger 23 个 `文件:行` 锚
- [ ] 跑 `registry.test.ts` / `boot-migrate.test.ts`
- [ ] 工坊写回 E2E
- [ ] CI 加 anchor 自检（按行号读文件必须命中 contains）

**门禁**：锚点测试全绿；写回不错位。

### Day 8 · Phase 4 fork 合并（1/2）

- [ ] B2：brand skills 基线切到 rc.5 `dsh-doc`（43 文件）
- [ ] B2：重放品牌替换（16 个 references；`@deepseek-ai/*` 保留）
- [ ] B2：品牌扫描 0 命中（除包名/官方 URL）
- [ ] B3：compaction `fromFailure` 之外的语义对照测试
- [ ] B3：复验 session 批量 append 对 seq/surface 断言的影响
- [ ] B10：llm-openai 适配器类型与错误码回归

**门禁**：compaction/memory/brand/llm-openai verify 绿。

### Day 9 · Phase 4 v1 线入库 + cordis 4.1.0（B11 必做）

- [ ] 入库 `core/{cordis,contracts,runtime}`、`basis.yml`、6 个 `@basis/*`
- [ ] `basis.yml` 删除 `bundle-core` 行并删空目录（方案 A）；v1 最小集 = 6 插件
- [ ] `core/cordis` re-vendor 4.1.0：按 README 重做 12 项 strip-types 变换
- [ ] 更新 NOTICE 版本/日期；`tsc --noEmit` + smoke + 与 npm 4.1.0 行为对照
- [ ] `pnpm install` 让 `@basis/*` / `@core/*` 全量进锁
- [ ] `pnpm -r verify` 纳入 v1；`basis` CLI 离线单 turn smoke（无网络 fake LLM）
- [ ] CI 增 `v1-lane`（独立失败信号，仍阻塞合并）
- [ ] `git ls-files` 审计：无运行态文件/凭据/node_modules

**门禁**：v1 车道全绿；`basis.yml` 6 插件全装载；`@core/cordis`=4.1.0。

### Day 10 · Phase 5 能力与客户端（1/2）

- [ ] B4：agent-team 试点（super 优先，Team mode 默认 off）
- [ ] B4：`team_*` 工具纳入审计
- [ ] B5：启用 ui-file-actions / ui-context-menu
- [ ] B5：**重建 10 个 `build-client.mjs` 的 `lib/client.js`**
- [ ] B5：`access/src/client/index.tsx:423` 补 `update()`
- [ ] B5：v4 令牌桥接复核
- [ ] B5：双主题 × 1440/900/390 截图
- [ ] **B19**：`@eterna/brand` 注册 `conversation.hero.frame`（`hero=false` 直返 children）
- [ ] **B19**：`conversation.hero.brand.mark` 复用恒灵标；`ui-brand-official` 保持禁用
- [ ] **B19**：品牌层 `display:contents` 外框 + `z-index:-1` + `pointer-events:none`；
      `prefers-reduced-motion`；双主题三视口截图
- [ ] **命令面**：`/` 菜单、`/model` 弹窗、`/compact` 结算；不重复注册

**门禁**：浏览器 roster 含全部 client.js；页面不空白；截图人工通过；hero 输入/滚动可交互。

### Day 11 · Phase 5 能力与客户端（2/2）

- [ ] B7：deepseek / mimo / glm 三路由 `web_search` + `web_fetch`
- [ ] B8：插件发现/安装/更新/卸载/双层键控 E2E
- [ ] B8：T6.1 admin 门仍在
- [ ] B12：`terminal/watch` → SESSION_STREAM
- [ ] B12：`workspaceFiles/search` → 视 UI gate 定 SESSION_UNARY
- [ ] B12：漂移差集清零；`mcpManager/watch` 盲区登记（B14 启用前必须补）
- [ ] **B14 系统层五道门**：mcp-manager Settings 命名空间 admin-only（HTTP + 实例 wrap 两层）
- [ ] **B14 读面**：非 admin 的 `settings/describe` / `openSettingsDocument` 过滤 mcp-manager 命名空间
- [ ] **B14**：`mcpManager/watch` → GLOBAL_STREAM + 新增 ADMIN_ONLY_STREAM 收窄
- [ ] **B14**：`restart/probe` → GLOBAL_UNARY + ADMIN_ONLY_UNARY
- [ ] **B14**：admin-only 流/一元不变式测试（⊆ 全量、无资源绑定动作）
- [ ] **B14**：新增 `mcp-manager-drift.spec.ts`（方法表恰为 watch/restart/probe）
- [ ] **B14**：拒绝/成功写入审计（不含 config 内容/凭据）
- [ ] **B14 个人层路由**：access 端点 `/api/mcp-personal/{list,upsert,delete,probe}`
      + RPC 信封 + 登录门 + 属主校验（跨用户 id 403，不区分不存在/无权限）
- [ ] **B14 个人层传输**：stdio 只认管理员目录（用户自填 command 400）；
      HTTP 接受 `http:`/`https:` 任意 host（白名单暂关；元数据地址仍拒）；
      `personalHttpHosts` 空=放行、非空=白名单；upsert 与 probe 同规则
- [ ] **B14 个人层密钥**：AES-256-GCM 存 `mcp_personal_secret`；日志/审计/错误 redacted；
      主密钥只从 `.secrets/`/env 读
- [ ] **B14 个人层挂载**：`createScope(ctx, agent)` + 每 Agent 挂 `mcp-client`，
      `serverName='p<uid>_<slug>'`；`tools/execute` 按 session 属主校验（同用户子代理放行）；
      删除/登出/会话关闭即 dispose
- [ ] **B14 个人层 UI**：`settings.section` 双 tab（全局 admin / 我的）；密钥 write-only；
      删除两击；v4 令牌 + 1100/760/640 截图
- [ ] **B14 限额**：8 条/4 连接、8s 启动/60s 调用、reconnect 3 次、256KB 配置
- [ ] **B20 terminal 守卫**：`terminal/{attach,close,create,environment,list,rename,retain,shells,watch}`
      九个动作登记 access；`watch`→SESSION_STREAM，其余→SESSION_UNARY；按 sessionId 查属主
- [ ] **B20 terminal 配置**：`readUserTerminals:false`；`preferredShells:['bash']`；
      6 个 `terminal_*` 工具可见；侧栏旁观/接管 UI 走 v4 令牌
- [ ] **B16 路由门**：`admit` 拦 `/api/deepseek-chat-import/archive`；未登录 401、
      跨用户 workspaceId 403；workspaceOwner 校验
- [ ] **B16 记账**：NDJSON pass-through 解析 `outcome.sessionIds` → `recordSession`；
      失败/取消按 workspaceRegistry 对账；审计不含标题/压缩包
- [ ] **B16 容量**：512MiB 合成包浸泡；反代 `client_max_body_size ≥ 512m`
- [ ] **B16 UI**：上游按钮/对话框 v4 审计；不过则产品自有 client 半边替换
- [ ] **B17**：entrypoint `ETERNA_FORM=acp`（日志全 stderr，不启动 relay/web）+ compose
      `eterna-agent-acp`（`profiles:["acp"]`、stdin_open、无端口）
- [ ] **B17**：ACP SDK `initialize/session/new/prompt/cancel/close`；stdout 只含 JSON-RPC；
      治理 ask 走 `session/request_permission`
- [ ] **B18**：默认集 E2E（chat-import/session-search/plugin-market）；session-search 跨用户
      cwd deny；plugin-market 写仍 admin-only

**门禁**：三路由、安装链、access 守卫（含 terminal 9 动作）、MCP 两层安全门、
chat-import 租户门、ACP stdout 全绿。

### Day 12 · Phase 6 容器构建

- [ ] B9：Dockerfile workaround 逐项移除实验（peer 改写 / node 直跑 / 三个 ENV）
- [ ] 保留 python3/make/g++（node-pty 需要）
- [ ] **B15 镜像依赖**：runtime 补 `fonts-noto-cjk` + `fonts-liberation`/`fonts-dejavu`
- [ ] **B15 Python 库**：预装 `python-docx`/`openpyxl`/`python-pptx`（apt 优先，否则 venv+pip）
- [ ] 构建期探针：`python3 -c 'import docx, openpyxl, pptx'` + `fc-list` 有 Noto CJK
- [ ] Dockerfile 只装 `dsh@0.2.2-rc.5`，不再单独装 mcp-client
- [ ] entrypoint 改链 `$DSH_PKG/node_modules/@deepseek-ai/dsh-mcp-client`
- [ ] 启动自检打印 mcp-client / agent-preset 版本
- [ ] **B17 镜像**：`dsh-acp-app` 可达；`ETERNA_FORM=acp` 分支；ACP service 无端口
- [ ] **B16 部署**：反代 body size/read timeout；部署 README 写明 512MiB 限制
- [ ] 构建 `eterna-agent:<新tag>`；记录 digest 与镜像体积增量

**门禁**：镜像构建成功；`dsh --version` 正确；symlink realpath 正确。

### Day 13 · Phase 6 双形态测试容器

- [ ] 起独立测试容器（独立端口 + 独立数据根，不碰生产）
- [ ] 新卷首启 + 旧 `/data` 卷升级重启
- [ ] 双形态 boot
- [ ] `verify.sh` 12 项
- [ ] 浏览器：登录/会话/插件/工坊/中继
- [ ] **B14 系统层 E2E**：admin 增删 MCP 服务器；非 admin 写 mcp-manager 命名空间 403；
      `watch/restart/probe` 归位；审计两条；重启后服务器仍在
- [ ] **B14 个人层 E2E**：用户 A 新增 HTTP 测试服务器 → A 会话出现 `mcp__p<A>_*`；
      B 会话看不到/调不到；B 用 A 的 id 请求 403；stdio 自填 command 400；
      `http://localhost` 可连；`http:`/私网放行；元数据地址拒绝；
      删除/登出后工具消失；A/B 并发同名条目不冲突；重启后条目仍在
- [ ] **B20 E2E**：web/super 终端 group active；6 个 `terminal_*` 工具；侧栏旁观/首次按键接管；
      A/B 跨会话 `terminal/{watch,attach,list}` 403/deny；长进程跨 turn 存活；24h fd/内存检查
- [ ] **B15 E2E**：docx/xlsx/pptx 各一轮 render/convert/recalculate；中文 `missingFonts` 检查；
      输出落 `/data/office-kit/outputs` 并可清理
- [ ] **B16 E2E**：owner 导入成功；跨租户 403；未登录 401；失败/取消对账；512MiB 反代实测
- [ ] **B17 E2E**：ACP stdio 全流程；web+ACP 同卷并发；无端口；治理 permission 往返
- [ ] **B18 E2E**：旧卷首启追加默认集一次；用户关闭后不回加；再升级只追加新项
- [ ] 旧会话可打开；sqlite integrity_check
- [ ] 回滚演练：回旧镜像后旧数据仍可 boot（记录 H7 边界）

**门禁**：Day 13 全绿才允许谈生产推广。

### Day 14 · 数据轨：FUSE 浸泡与完整性

- [ ] 在测试实例用 bind mount 起新容器（方案 A）
- [ ] 启动 24h 浸泡（持续会话写入 + 压缩任务）
- [ ] 期间做一次非正常停止（kill）测试
- [ ] 24h 后全库 `PRAGMA integrity_check`
- [ ] 对比 named volume 基线（性能/延迟/错误日志）
- [ ] 结论：通过 → 继续；不通过 → 方案 A-alt（DB 留 named volume）或 A-linux

**门禁**：integrity_check=ok；无 WAL 损坏；性能可接受。

### Day 15 · 数据轨：迁移演练

- [ ] 按 48 §7 runbook 在测试实例演练：冷备 → 复制 → 停 → 改 compose → 起 → 验证
- [ ] 演练回滚
- [ ] 记录耗时、目录大小、硬链接数（7362）校验
- [ ] 校验 `DSH_AGENTS_HOME=/data/agents` 生效
- [ ] 校验 `/data` 挂载预检会拒绝非挂载启动

**门禁**：演练两遍通过；回滚可用。

### Day 16 · 生产窗口（仅 P0-1/P0-3 拍板后）

- [ ] 干净 worktree 构建 + sha 比对
- [ ] `pre-restart-check`
- [ ] 冷备生产 `/data`
- [ ] 停容器 → 改 compose → 起容器
- [ ] `verify.sh` + 浏览器关键路径
- [ ] 观察 24h；异常按 48 §7.6 回滚

**门禁**：生产验收全绿；回滚预案在手。

## 6. 门禁速查

```bash
pnpm install --frozen-lockfile
pnpm -w run verify
node tools/packctl/bin/packctl.mjs form-check
node scripts/verify-eterna-web.mjs
node scripts/verify-eterna-super.mjs
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay
pnpm --filter @eterna/llm-openai typecheck
```

补充检查：

- boot stderr 无 `disabling profile plugin`
- `mux-drift` / `mux-peer-drift` 差集=∅
- 10 个 `lib/client.js` 全部重建
- `commands`/`ui-commands` active；`/`、`/model`、`/compact` 浏览器实测
- prompt registry 10 锚 + ledger 23 锚命中
- mcp-manager 方法表 `{watch,restart,probe}` 与策略清单一致
- 非 admin 写 `mcp-manager` 命名空间 403 / `watch` deny
- `mcp-manager.config.servers` 升级前后一致
- 个人 MCP：A/B 双用户互不可见/不可调；跨用户 id 403；stdio 自填 command 400；
  `http://localhost` 测试服务器可连；`http:`/私网放行；元数据地址拒绝；
  删除/登出后工具消失；密钥日志 redacted
- 个人 MCP 限额：8 条/4 连接；8s 启动/60s 调用；个人表随 `/data/access` 迁移一致
- terminal：group active；6 个 terminal_* 工具；9 个 terminal/* 动作有属主守卫；
  A/B 跨会话 403/deny；24h 无 fd/内存泄漏
- v1 车道：`git ls-files` 全覆盖；`pnpm-lock` 全量；`pnpm -r verify` 绿；
  `basis.yml` 6 插件全装载；`@core/cordis`=4.1.0
- chat-import：未登录 401 / 跨租户 403 / 记账正确 / NDJSON 不缓冲 / 审计不含内容
- chat-import：512MiB 合成包不 OOM；反代 body size ≥ 512m
- 默认 bundle：旧卷追加一次、用户关闭不回加、再升级只追加新项
- ACP：`eterna-acp` profile 只含 base+acp-app；stdout 只含 JSON-RPC；无端口
- hero：`hero=false` 无额外 DOM；`hero=true` 输入/滚动可交互
- `python3 -c 'import docx, openpyxl, pptx'` 通过；`fc-list` 有 Noto CJK
- docx/xlsx/pptx render/convert/recalculate 各一轮
- 双主题 × 1440/900/390 截图
- sqlite `PRAGMA integrity_check`
- `/proc/mounts` 中 `/data` 是挂载点
- 数据根 `$HOME/eterna-data/<instance>` 存在且 0700；备份/导出不挂进容器

## 7. 每日记录（追加，不回填）

### 2026-11-19

- 计划：评审 47/48，确认决策，冻结基线。
- 执行：产品拍板——**mcp-manager / office 家族纳入；rc.5 上生产**。
  47 升 v4（B14/B15、H9、SOP 例外）、upgrade-gate §7 修订、TODO 同步。
- 追加拍板（v5）：**chat-import 支持；commands 已具备（只验收）；cordis 强制更新；
  ACP 加入；实验 bundle 默认化；hero 品牌浮层合入**。
  47 升 v5（B16–B19、H10–H13、T1/T6 分析、18–24 人日）、TODO §2 与逐日任务同步。
- v6 决议：**直接 rc.5；数据根 `$HOME/eterna-data`；v1 线进本分支；`origin/main`
  干净 worktree；普通用户可增删 MCP（个人层）**。47 升 v6（B14 两层、B11/H15、H14、
  20–27 人日、Phase 2 并入 Phase 1）；48 升 v2（根路径拍板）；TODO 同步。
- v7 决议（2026-11-19）：**MCP 个人层 HTTP 接受 `http:`/任意 host、白名单暂关**；
  **P0-7 不缩减**；**P0-10 默认集确认**；**terminal-panel 全量应用（web+super）、
  WebWorker 不产品化**（T1→B20、T6 关闭）。47 升 v7（B20、H16、22–30 人日）；
  TODO §2/§3/§5/§6 同步。
- 文档产出（2026-11-19）：**49 总设计、50 开发落地、51 测试用例（164 条）** 已写入
  `docs/design/`，三份互链；结构=总纲/施工/验收，未改任何代码。50/51 已标注
  `tenant-scan` 基线 2 条（glue webhook）与 `prompt-scan` 基线（v1 agent-loop），
  由 WP5-2/B13 清零。
- 证据：`docs/design/47-...md` v6/v7；`docs/design/48-...md` v2；
  `docs/design/49/50/51-...md`；本文件 §2。
- 未完成 → 次日：评审 49/50/51（重点：B14 挂载生命周期、terminal 9 守卫、
  v1 入库范围、DATA 迁移演练）；开工前把 47/48/49/50/51/TODO 迁入干净 worktree 并提交。

### 2026-11-20

- 开工：rc.5 开发窗（worktree `/Users/sunny/code/agent-basis-rc5`，分支
  `feat/dsh-rc5-merge`，HEAD `02f4857`）。P0 基线证据包落地
  `artifacts/rc5/p0/`（`summary.json` + `baseline.md`），依据 54 §2.2/§12.1、
  48 §7、51 §0.3。
- 本地基线（实跑）：`pnpm install --frozen-lockfile` EXIT=0（Already up to date）；
  `pnpm -w run verify` **EXIT=1**——18 包 Done，`@eterna/access` 16 条 oxlint 错误
  全部在 L4 未提交改动（12 条未跟踪 `src/mcp-personal.ts` + 4 条已修改
  `src/store.ts`），其余包被 fail-fast 中止；双形态真 boot（临时 DSH_HOME、
  `--port 0`、无凭据）`verify-eterna-web` 17/17 PASS（229 entries）与
  `verify-eterna-super` 21/21 PASS（235 entries）；`dsh-evals replay`
  pack=event-planning **30/30 pass，EXIT=0**。
- 生产只读盘点：容器 `eterna-agent` / 镜像 `eterna-agent:0.1.51`
  （`sha256:3ca0d660…1a7b`）/ 卷 `agent-basis_eterna-home`
  （2026-11-09 创建）；`/data` 约 77MB；profile manifest 与 patch 指纹已快照
  （super 151 行 / web 143 行）。生产 `deploy/verify.sh` 只跑免凭据只读子集
  （8/8 ✅）；登录/me/插件红线/KB 运行时探针需凭据，**未跑**。
- 回滚点：镜像 `eterna-agent:0.1.50`（`sha256:6b306037…b2052`）在册；冷备
  `$HOME/eterna-data/backups/rc5-2026-11-20/eterna-home-20261120-013829.tgz`
  （26,559,638 B，sha256 `df48d7e1…b71640`，6/6 SQLite integrity_check ok）。
- 证据：`artifacts/rc5/p0/{summary.json,baseline.md,local/,prod/,backup/}`。
- 未完成 → 次日/交接：P0-01 L4 收口 verify；P0-02 verify.sh 只读模式归 L5；
  P0-03 镜像仍 alpha.3 内核须 L5 改 Dockerfile；P0-05 冷备恢复演练未做。
- 边界：未 push/merge、未停改生产容器、未改 compose、未碰
  `/Users/sunny/code/agent-basis` 与 `deepseek-harness`。
- **P0 复跑复核（02:12–02:20，证据根 `artifacts/rc5/p0/run2/`）**：本轮全部重测，
  不引用上一采旧件。`pnpm -w run verify` 仍 **EXIT=1**，但 Done 包数由上轮 18 升至
  **22**；`@eterna/access` 仍 16 条（12 条 `mcp-personal.ts` 未跟踪 + 4 条
  `store.ts` 已修改），其余 16 个 workspace 被 fail-fast 中止。双 boot
  `verify-eterna-web` 17/17 PASS（229 entries）/ `verify-eterna-super` 21/21 PASS
  （235 entries，22 条 @eterna 行 active）；`dsh-evals replay` 30/30。生产只读盘点与
  上轮一致（0.1.51 / `3ca0d660…` / 77MB / super 151 行 / web 143 行），并在容器内实测
  dsh=**0.2.2-alpha.3**。冷备重做：`eterna-home-20261120-021802.tgz`
  （26,566,225 B，sha256 `5976686f…d281`，10,466 条目，**16/16 SQLite ok**）。
  工作树采集期仍在被其它 lane 写入（脏条目 56→72），见遗留 P0-08。
- **P6a 门禁修复（W5 round1，01:05–01:24Z）**：`verify-terminal-guard` 修前
  PASS=5/FAIL=4 → 修后 **11/0/0/1**（NOTRUN 仅 TERM-005 WS 面）；`verify-chat-import`
  修前 7/1/4 → 修后 **8/0/4**；access `vitest` 49 files/504 tests、tsc/oxlint 全 0。
  根因：rc.5 `GatewayInvocation` 无 `principal` 字段（改读 `peer.principal`）、
  `/api/terminal/*` 一元面恒 owner Peer（admit 换血 + 503 fail-closed）、
  终端六动作需会话绑定；IMP-005 为测试容器持有已删 WAL 的环境态，重建容器后
  `delta=10 allImportedPresent=true`。证据 `artifacts/rc5/p6a/repairs/`。
- **T50/T52 证据收口（01:25–01:27Z）**：`artifacts/rc5/acceptance-matrix.md`
  164 行 = **PASS 130 / FAIL 8 / MISSING 26**（P0 未通过 16：FAIL 8 + MISSING 8）；
  `p0`–`p7` 阶段 summary 齐 54 §7.3 键；TERM-004 按修后复跑改判 PASS。
  自检 `node artifacts/rc5/p6a/verify-matrix.mjs` → ALL_ASSERTIONS_PASS；
  T52 复核日志 `artifacts/rc5/p7/t52-recheck.{log,md}`。仍未判绿：FAIL 8（全部 P0）、
  MISSING 26（P0 8）、24h 浸泡未满、P7 全量复跑未执行。
- **分组提交（T52，54 §13.8）**：G-A `67aac03`、G-B `6930e92`、G-C `7daf9c5`、
  G-H `5b91c5f`（P4 客户端，§13.2 之后新增）、G-D `e5231cb`、G-E `e71e33d`、
  G-I `ccd9380`（P5 部署，§13.2 之后新增）、G-F `a72d187`（脚本/夹具/证据）、
  G-G 本次 docs(rc5)。提交前扫描：禁入路径 0、高置信凭据 0
  （`artifacts/rc5/p7/check-commit-hygiene.mjs`）。
- 未完成 → 下一批：P7 全量 164 复跑（P6 清零后）、PR/合并/生产窗口、24h 浸泡满窗复核；
  FAIL 8 修复（workspaceFiles/mcp-manager 守卫 + 上游 terminal/create）。

<!-- 新的一天复制上面四行，日期改为当天；不要删除旧记录。 -->

## 8. 明确不做

- 不在当前脏工作树直接开工；不把并行会话改动卷进本分支。
- 不改 `deepseek-harness` 源仓库（只读）。
- 不为测试改动运行中的生产容器/部署。
- 不把凭据写入跟踪文件、镜像、日志或 argv。
- 不在未拍板前升级生产或迁移数据；生产放行按 47 Phase 6 全门禁执行。
- 不绕过 admin 门启用 mcp-manager 全局表；不把 `mcp-manager` 命名空间对普通用户开放。
  普通用户只在**个人层**增删；个人层不得写全局 `config.servers`、不得自填 stdio command。
- 不把个人 MCP 条目挂成全局工具；不做跨用户可见/可调；不把个人密钥存入明文或日志。
- 个人 MCP HTTP 按 v7 拍板允许 `http:`/任意 host（白名单暂关），但仍不得放开云元数据
  地址（`169.254.169.254`/`fd00:ec2::254`）；不得把 `personalHttpHosts` 的收紧开关删掉。
- 不把 terminal 的 9 个 `terminal/*` 动作漏出 access 守卫；不启用 `readUserTerminals`
  （共享容器无租户归属）；不把 terminal 当工作台任务引擎替代品。
- 不把 v1 线「半成品直接 add」：先补 `bundle-core` 决策、全量入锁、独立车道（H15）。
- 不把 v1 线塞进 Docker 镜像或生产 profile；v1 与 `eterna` 运行入口分离。
- 数据根不放网络文件系统；不把 `backups/`/`exports/` 挂进容器；不使用相对路径。
- 不把 office 输出目录写进工作区；不调大上游默认的输入/输出/并发上限。
- 不把 WebWorker 当产品运行时；不为了“无服务器”裁剪多租户/Office/终端能力。
- 不直接开 chat-import 行而不补 access 路由门/workspaceOwner/导入后记账（H10）。
- 不把 ACP 暴露端口或发给终端用户；ACP 只允许运维/管理员本机启动（H12）。
- hero 浮层禁止全屏遮罩、字面色值、`font-weight:500` 正文与新增断点。
- 不编造测试结果与截图；未跑就写“未跑”。