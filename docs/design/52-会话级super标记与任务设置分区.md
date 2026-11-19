# 52 会话级 super 标记与任务设置分区

> 状态:已实现(2026-11-19),待部署 0.1.46。
> 关联:AGENTS.md 前端铁律 v4 / [frontend-style.md](frontend-style.md) / [49 号](49-上游rc.5合并总设计.md)
> 前置事实基线:[46 号](46-角色模型选择策略.md)、35 号任务内核、44 号附B(治理询问静默)。

## 1. 为什么做(改前事实)

2026-11-19 生产(3210,镜像 0.1.45)实测:super 形态**其实已生效**——容器 `ETERNA_FORM=super`,
`@eterna/tasks` 服务与 `eterna-tasks` 挂载行 active,租户库有完整设置
(`webchat.allowed=[Mr.Ma]`、规则 `eterna-delegation`、`eval.mode=auto`、`maxWorkers=3`),
orchestrator 主会话 `orchestrator-Mr.Ma` 已建,工作台 SSE 快照带 `masterSessionId`。

"感觉没应用"的真实原因是**零可见性/零入口**:

1. 主会话空白且不出现在普通会话列表,唯一入口是工作台工具栏「主会话」;
2. 在任何非主会话里聊天都不会进 super 流程,且会话头无标记,事后无法分辨;
3. 任务设置只能改 sqlite / 模型工具,没有设置弹窗分区。

本次补三条:**会话头角色徽标**、**工作台会话行(主控/执行,可点)**、**任务设置分区(全量设置)**。

## 2. 入口语义(使用者读法)

- **主控会话**:id = `orchestrator-<realm>`,标题固定 `eterna-tasks orchestrator`
  (`packages/tasks/src/plugin.ts` `MASTER_SESSION_TITLE`),由 tasks 启动时引导
  (`stats().masterId`)。**只在这个会话里对话,消息才走 super 流程**(webchat 入口按
  `policy.sources.webchat.allowed` 名单放行,realm 内名单之外的会话不触发委派)。
- **执行会话**:工单开始执行时 tasks executor 建 `worker-<ticketId>`
  (`packages/tasks/src/executor/dsh.ts:42` `workerSessionId`);只在主控委派后产生。
- **普通会话**:不触发 super、无徽标;工作台「会话」区不为其造行(session 面归宿主)。

徽标判定 fail-closed:角色面取不到(未登录/内核缺席/网络失败)就不渲染——宁缺不误标。
普通会话、`worker-<id>-extra` 之类前缀近似 id 均不命中(纯精确匹配)。

## 3. 数据面契约(实现面)

### 3.1 tasks 内核设置面(`packages/tasks/src/policy/face.ts` 新)

`ctx.tasks.settingsFace` 三方法(读/角色/保存;写路径只经既有 `saveSettingsBlock`):

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `read()` | `TasksSettingsSnapshot` | `realm/masterId/masterTitle/paused/policyVersion/settings/revisions/workerSessionIds/health/stats`;纯读投影,不写库 |
| `roles()` | `TasksSessionRoles` | `masterId/masterTitle/workerSessionIds`(登录用户可见的最小面) |
| `save(block, value, revision)` | union | 成功 `{ok:true,saved,changed,revision,settings,policyVersion}`;预期失败 `{ok:false,code:'conflict'\|'invalid',message}`,不跨层抛异常类 |

- 块域 = `pause|policy|eval|executor|budget|gates|source:<name>`;`revisions` 覆盖同域。
- 保存语义原样复用 `saveSettingsBlock`:分块 CAS(`blockRevision`)、无变化不记修订、
  只有策略内容变才 `policyChanged`;`eval.timeoutSeconds`/`executor`/`budget`/`pause`
  不进授权内容 hash(见 `policyContent`)。
- 联合版本:`saveSettingsBlock` 的 `sides` 改为**可选**;省略时版本 = tasks 内容 hash
  (`policyVersion`),与运行时 `wiring.version ?? policyVersion(settings)` 同口径,
  避免首次面板保存把内容 hash 与联合 hash 误判成版本变化。`TasksOptions.jointSides`
  留作 glue 接 governance/hitl 的注入面;`wiring` 为唯一可变实例,orchestrator 工具
  宿主复用 `runtime.wiring`(消除两对象版本漂移)。

### 3.2 access 路由(`packages/access/src/routes.ts` + `plugin.ts`)

Tier1 不 import Tier2:access 经 `ctx.reflect.get('tasks', false)` 结构解析三键
(`read/roles/save` 齐备才算就绪),每次请求现读(与 `eternaWorkbenchStream` 同模式)。

| 路由 | 权限 | 返回/错误 |
| --- | --- | --- |
| `GET /access/api/tasks/session-roles` | 登录即可 | `{ok,masterId?,masterTitle,workerSessionIds}`;匿名 401;内核缺席 503 |
| `GET /access/api/tasks/settings` | admin | `{ok,...read()}`;401/403/503;`cache-control: no-store` |
| `POST /access/api/tasks/settings` | admin | body `{block,value,revision}`;块白名单 `^(pause\|policy\|eval\|executor\|budget\|gates\|source:[a-z][a-z0-9-]*)$`;revision 非负整数;conflict→409、invalid→400 |

审计只落 `access.tasks.settings` 的 `{block,saved,changed}` 或 `{block,code}`——不记设置值
(名单/密钥型来源配置不入 audit)。设置视图 admin-only 而角色面登录即可,是为了徽标对
普通会话可见、设置内容仍只给管理员。

### 3.3 tasks 客户端半边

- `package.json`:`dsh.client {inject:[dsh-client-locale,dsh-client-ui-slots,
  dsh-client-ui-conversation,dsh-client-ui-workspace],platform:'web'}`、`exports['./client']`、
  `build:client`(verify 前置);依赖 `@eterna/ui`,`devDeps` react/@types/react/esbuild(catalog)。
- `src/client/index.tsx`:注册
  - `settings.section`(id `eterna-tasks.settings`,order 47,label「任务与超级智能体」);
  - `conversation.session.header.utilities`(id `eterna-tasks.session-badge`,右对齐状态位)。
- `settings.tsx` 八卡全量表单:运行状态(健康/暂停/主会话入口/版本/计数)、评估
  (mode 三档/超时/角色模型)、执行器(模型/并发/目录/prepare/被禁命令)、预算
  (三档 caps/pricing/credits)、门禁(highRiskRules)、评估规则(增删改)、来源名单+
  准入三格、来源实例(启停 + config JSON)。
- 保存=脏检查 + 单「保存更改」+ 按块**增量合并**提交(`withBlock`:每块只提交该块表单值,
  服务端按块递增修订;全量重复提交会让后续块被判"无变化"、修订不涨)。409 提示并强制
  重载;400 就地展示校验信息;无变化不发请求;保存中防重复点击;删除为即时行删除
  (不用原生 confirm/alert)。
- 配置 JSON 输入本地解析(对象才接受),非法时禁用保存;三格准入档位由 select 限定
  值域,空选择 = 继承来源默认。

### 3.4 工作台会话行(`packages/workbench/src/project/sessions.ts` 新)

live hub 快照 `sessions` 恒空占位(宿主 session 面未接线);客户端派生:

- `masterSessionId` 在场 → 主控行(置首,role orchestrator);
- 非 `queued` 列工单 → `worker-<ticketId>` 执行行(已结束工单不进看板,故天然只覆盖开放工单);
- mock fixture `sessions` 非空时**原样回退**(既有渲染测试行为不变)。

行点击 = 侧栏高亮 + 宿主 `uiWorkspace.openSession`(同「主会话」工具栏入口);角色 chip
「主控/执行」走 `@eterna/ui/icons` + `--et-*` 令牌;普通会话行无 chip。

## 4. 验收与实测(2026-11-19 本机,部署分支 `deploy/tasks-super-01146` @ b328f70)

- `pnpm --filter @eterna/tasks verify`:**51 文件 / 844 测试**全绿(含 build:client)。
- `pnpm --filter @eterna/access verify`:**40 文件 / 383 测试**全绿。
- `pnpm --filter @eterna/workbench verify`:**18 文件 / 215 测试**全绿(含 build:client)。
- `node scripts/lint-ui-tokens.mjs`:17 目录 275 文件通过(任务包客户端样式令牌纪律另按
  豁免清单手检,见 §6)。
- `node tools/packctl/bin/packctl.mjs form-check`:0 finding。
- `node scripts/verify-eterna-super.mjs`:221 host entries、22 行 super 挂载面 active、
  3 presets;新增花名册断言均 PASS——
  `combo 花名册含 @eterna/tasks/client.js`、`任务包 combo 可取且含 factory 注册(id=@eterna/tasks)`。
- **隔离容器 E2E(0.1.46 镜像,全新卷,不碰生产)11 项全绿**:匿名 401;roles 登录 200
  (`masterId=orchestrator-Mr.Ma`);admin GET 全量设置 + 六块修订;非 admin settings 403
  而 roles 200;非法块/非整数修订 400;保存 `eval.timeoutSeconds` 修订 +1 且版本不变;
  重读持久;旧修订 409 +「重新加载」;无变化保存 `saved:true/changed:false` 不记修订;
  规则改动 `policyChanged` + 版本变化;还原规则。
- 容器内工件复核:`/repo/packages/tasks/lib/client.js`(138095 B,`__ModuleLoader__.load`
  + `id:"@eterna/tasks"`)、`/data/profiles/eterna-super/node_modules/@eterna/tasks` 链、
  `/data/sessions/--data-workspaces-Mr.Ma--/orchestrator-Mr.Ma` 主会话目录。
- 3210 部署验收(verify.sh/只读 UI/截图)见 §7。

## 5. 边界与不做

- 单 realm:一份设置属一个租户库;跨 realm 的路由/并发不在本期。
- 设置面 admin-only:普通用户只能看到徽标与角色,不能读设置内容。
- 工作台执行行只覆盖开放工单;已结束工单的 worker 会话不在此列(会话归档归宿主)。
- 角色面 30s 缓存 + 在途去重(会话头每会话一枚徽标,不能一 mount 一发);失败清缓存
  下次重试,不重试风暴。
- 不改 live hub 的 SSE 词汇(不加 `sessions-updated`);派生在客户端,服务端状态机零改动。
- **空白会话头不渲染 utilities**:宿主 `wSkVaW_headerBlank` 态只挂 corner(右侧栏按钮),
  `conversation.session.header.utilities` 在会话有内容后才出现。故新建空白主会话的头徽标
  要等首条消息;工作台「主控」行是该阶段的主入口与标记(实测见 §7-5)。会话行 chip 补上
  列表侧的常驻标识(§5.1)。

### 5.1 会话行标识与候选卡可读化(2026-11-19 补,用户反馈)

用户反馈两点:① 会话列表里无法直观区分主控/执行会话;② 主会话发送后出现「触发排队」,
候选卡以原始 JSON 显示,不知道应该继续对话还是等任务。补:

- 侧边栏 `sidebar.session.row.trailing` 注册「主控 / 执行」紧凑 chip:与头部徽标同源
  (`session-roles`,30s TTL + 在途去重);空白会话头不渲染 utilities 的阶段,会话行 chip
  仍可见(主会话有内容后入列;运行时 `rowResting` 常驻,悬浮时让位给行操作)。
- `conversation.user.text` 整段规则(order 5):识别 `{"kind":"candidate",...}`,把候选
  JSON 渲染为「委派候选 · 来自 X · 可继续对话,系统自动评估」chip。该渲染面被**排队区预览
  与会话正文共用**,两处同时生效;原始 JSON 不再直接暴露。规则只改显示,模型收到的仍是
  原始 JSON,协议零改动。
- 验证:tasks verify **52 文件 / 852 用例**全绿;隔离实例(0.1.48 镜像 + 新 client.js)
  双主题 × 1440/900/390 截图:会话行「主控」chip、头部「主控」、排队预览/正文候选 chip
  均在位,raw JSON 不可见;390 下排队项收敛为「委派候选 · 第 1/2 项」,无溢出。

## 6. 跟进项

1. `scripts/lint-ui-tokens.mjs` 当前仍把 `packages/tasks` 列在 `EXEMPT_DIRS`(该文件工作树
   有并行会话未提交改动,本次不改)。P0 后移除豁免,让任务客户端半边纳入令牌护栏。
2. `jointSides` 仍可选:glue 尚未注入 governance/hitl 两侧内容,联合版本在 super 组合下
   暂按 tasks 内容 hash 记;接入后由 glue 传 `jointSides` 即自动切联合 hash(face 已留缝)。
3. 工作台会话行的「已结束工单归档」需要宿主 session 面投影;本期不猜。

## 7. 部署(0.1.46 → 0.1.47,2026-11-19 已上线 3210)

1. **构建**:干净 worktree `/Users/sunny/code/agent-basis-01146` @ `b328f70`(基线
   `e9160db` 知识融合) → `eterna-agent:0.1.46`(image id `482d36eb758c`)。不用
   `9b1cde8`:其 `autoInstallPeers:false` 锁文件丢 peer 图,容器内 `@deepseek-ai/dsh-scope`
   模块缺失。
2. **停旧**:生产旧容器 image id `daeefd053f63`(0.1.45 tag 已漂移到 `5f432c85ac7b`,
   故回滚须按 image id,不能按 tag)。
3. **切换**:`pre-restart-check.sh` 静默窗通过 → compose `image: eterna-agent:0.1.46`
   → `docker compose -p agent-basis up -d`(不 `--build`)。未动数据卷 `agent-basis_eterna-home`。
4. **verify.sh**:14 过 / 0 败(登录/匿名拒/桥接 redirect/me/插件红线/越权拒/错密码/
   治理活性/知识底座装载 + overview/relay status/下载包/guide)。
5. **容器/路由复核**:`ETERNA_FORM=super`;`/repo/packages/tasks/lib/client.js` 138095 B;
   `…/node_modules/@eterna/tasks` → `/repo/packages/tasks`;patch 行 `id: eterna-tasks`
   (644)/`eterna-tasks-access-bridge`(656);主会话目录在;admin `GET
   /access/api/tasks/settings` 200(realm Mr.Ma、`policyVersion=565427af…`、规则
   `eterna-delegation`、`eval.mode=auto`、`maxWorkers=3`);`session-roles` 200
   (`masterId=orchestrator-Mr.Ma`)。
6. **只读 UI 取证 + 截图**(生产,admin 视角,仅导航):
   - 设置 →「任务与超级智能体」:八卡渲染(运行状态/评估/执行器/预算/门禁/评估规则/
     来源名单与准入/来源实例),底部「重新加载 / 保存更改」常驻;正文与主题跟随 `--dsw-alias-*`。
   - 工作台 → 任务侧栏:「超级智能体主控 · 委派入口」行 +「主控」chip;工单为 0 时无执行行
     (派生只覆盖开放工单,符合预期)。
   - **会话头徽标**:生产主会话为空(空白头不挂 utilities,见 §5),故正例在**隔离实例**
     (同镜像、realm 对齐账号,`ETERNA_ACCESS_ADMIN_USER=Mr.Ma`)首条消息后取证:
     `data-eterna-tasks-role="orchestrator"` +「主控」在头右对齐;普通会话(生产
     「只回复两个字：收到」)utilities 在场而徽标不渲染(负例)。
   - 截图归档 `artifacts/0.1.46-tasks-super/`:`settings-{1440,900,390}-{light,dark}.png`、
     `workbench-{…}.png`(生产)、`badge-testinstance-{…}.png`(隔离实例)。深浅主题经
     CDP `prefers-color-scheme` 驱动(不写用户偏好);390 断点下设置卡单列、工作台视图条横滚、
     内容区不塌。
7. 写路径 E2E 只在隔离实例执行(遵守「测试不动运行中部署」):同一镜像全新卷,11 项全绿
   (§4),容器已删除、卷已清理。
8. **回滚**:compose `image` 改 `sha256:daeefd053f63…` → `docker compose -p agent-basis
   up -d`;数据卷不变。

### 7.1 合并 main 后按 main 重建(0.1.47)

- PR **#128** squash 合并为 `aaf1d68`(合并前 rebase 到 main `8598fad`,全门禁复跑绿)。
  CI 首轮红:prompt-studio registry 锚点 `plugin.ts:1006` 被本 PR 代码位移打断,按
  「改 glue 源码先 grep registry 钉行」纪律修为 **1049**,`@eterna/prompt-studio verify`
  16 文件 / 349 测试全绿后 CI 通过。
- 干净 worktree `agent-basis-main-0.1.47` @ `aaf1d68` → `eterna-agent:0.1.47`
  (image id `fa76f0ca047a`)。隔离容器 boot 探针:client 138095 B、profile 链、
  `session-roles`/`settings` 200。
- compose `0.1.46 → 0.1.47` → `pre-restart-check` 通过 → `up -d` → `verify.sh`
  **14 过 / 0 败**;容器探针(ETERNA_FORM=super、patch 行 644/656、主会话目录、
  admin GET settings 200)与 0.1.46 一致,`policyVersion=565427af…` 未变(设置跨重建持久);
  只读 UI 复验主控行 + 设置八卡。
- 回滚:0.1.47 → 0.1.46 image id `sha256:482d36eb758c…` → `up -d`。

### 7.2 主会话 400 热修(0.1.48)

- 现象与根因:主会话首轮 400 INVALID_REQUEST,触发者 `submit_plugin_to_market` 的
  **裸 properties 映射**——顶层 `title`/`description` 参数名撞 JSON Schema 注解关键字,
  provider 拒绝整个请求。完整取证/修复/验证见
  [dev/master-session-tool-schema-400.md](../dev/master-session-tool-schema-400.md)。
- PR **#130** → `b93e592`;干净 worktree `agent-basis-main-0.1.48` →
  `eterna-agent:0.1.48`(image id `8e9ddd5612cc`);`pre-restart-check` 通过 →
  `up -d` → `verify.sh` **14 过 / 0 败**;`session-roles`/`settings` 200,
  `policyVersion=565427af…` 未变。
- 回滚:0.1.48 → 0.1.47 image id `sha256:fa76f0ca047a…` → `up -d`。

### 7.3 会话行标识 + 候选卡可读化(0.1.49)

- PR **#132** → `6e97ca8`;干净 worktree `agent-basis-main-0.1.49` →
  `eterna-agent:0.1.49`(image id `a57d711252a7`);client bundle **142628 B**
  (`data-eterna-tasks-candidate` 5 处、`session-row-badge` 1 处)。
- 首次 `pre-restart-check` 被另一会话(`session-fab59d78…`)120s 内活动拦下,
  等静默窗后通过 → `up -d` → `verify.sh` **14 过 / 0 败**。
- 生产只读取证(刷新后):侧边栏 `eterna-tasks orchestrator` 行出现紧凑「主控」chip
  (`data-eterna-tasks-compact="true"`),头部「主控」同在;页面 DOM 无
  `"kind":"candidate"` 原文。历史候选消息未落正文(当时只在排队区出现),故候选 chip
  的正例在隔离实例(同镜像+新 client.js)取证:排队预览与正文两处均渲染,
  raw JSON 不可见(截图 `artifacts/0.1.49-session-markers/`)。
- 截图:双主题 × 1440/900/390 共 6 张 + 隔离排队态 + 生产只读取证。
- 回滚:0.1.49 → 0.1.48 image id `sha256:8e9ddd5612cc…` → `up -d`。