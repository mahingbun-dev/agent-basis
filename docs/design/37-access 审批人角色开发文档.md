# 37 - access 审批人角色开发文档（WS-C：用户表角色字段 + mux 过滤 + 用户管理 UI + 可见性规则）

> 状态：开发实施文档（任务级规格，供 workflow 编排直接消费；每条任务两列可追溯——依据条款 / 验收门禁）。r2（2026-11-17）：经评审意见逐条修订——① 34 号引用节号更正 §6→§5（5 处，原文在 34 号 §5「与 access / governance / interact / channels 的接线点」:292，§6 为开放问题:325）；② M-5 静态锚门禁由「评审项」测试化（`tests/role-expansion-anchor.spec.ts`，33 §2.1【T】形态）并补录 §5 汇总表；③ M-3「不能改自己角色」自设护栏入 §7 缺口 10 待评审；④ M-1 迁移形态与 §7 缺口 4 显式互链；M-4 排期拆分（评审认定已披露不计违反，维持原文）与核实通过项（备案，无改动）
> 日期：2026-11-17
> 上游拍板：[[30-Subagent工作台与可视化监控]] §7-3（Q3 方案 b，三处改动）、§4.5（多租户与角色）；[[33-开发总工作流与门禁]] §1.3 WS-C（G2-C1～C5）；[[32-最终态开发方法-工作流与里程碑]] §2 WS-C 行
> 关联：[[23-记忆多租户分库设计]]（access realm / accountOf 单真值 / fail-closed 纪律）、[[34-tasks包详细设计-草案]] §5 access 接线点（角色字段供 Attention 定向；本轮评审修正节号：原文在 §5「与 access / governance / interact / channels 的接线点」（:292），§6 为开放问题（:325））、`docs/PLUGIN-AUTHORING.md` §1.1（多租户与隔离铁律）、[[24-主动工作体系融合设计-任务内核与chat-demo范式]] §7.2（五角色定义）、[[24a-融合设计决策速览]] 第三轮拍板 Q3
> 纪律：禁止发明设计文档之外的任何行为；发现设计缺口写入 §7 开放问题，不自行补设计。本文档 §1 代码事实截至 2026-11-17 逐条核实（file:line 可跳转）；§5 门禁命令全部在本机实跑过一遍（基线绿）。

---

## 0. 一句话结论

WS-C = 在 `packages/access` 落「审批人」第三角色：**用户表角色字段扩值 + 存量库 CHECK 约束迁移**（store.ts）＋ **mux 策略角色感知 + 可见性谓词单真值**（mux.ts，内容绑定三角色一律 fail-closed 不放宽）＋ **用户管理分区分配/收回角色 + 审计 + mux 即时生效**（routes.ts / client）——「审批人见全租户待人项」的**数据面**（工作台待人项）属 WS-A/WS-D（P2），本批只立角色模型与过滤 seam（33 号 G2-C3 排 M3「工作台实接前」正因此；30 §7-3「B2 领域专家角色后续共用此机制——一次立住角色模型」）。

## 1. 现实基线（代码事实，2026-11-17 核实）

### 1.1 用户表与角色（`packages/access/src/store.ts`）

- `UserRole = 'admin' | 'user'`（store.ts:13）；users 表建表语句带 `role TEXT NOT NULL CHECK(role IN ('admin','user'))`（store.ts:77-87），**SQLite 的 CHECK 约束不可 ALTER——存量库加 'approver' 值必须按 SQLite 官方 twelve-step 表重建流程**（见 §3 M-1）。
- `UserStore` 构造器 `CREATE TABLE IF NOT EXISTS` 一次性建六表（users/workspaces/approvals/notifications/user_plugins/sessions，store.ts:77-126），无任何 schema 版本化/迁移先例（仓内最近先例 = 23 号 §3.3 memory 数据迁移脚本 `packages/memory/scripts/migrate-to-per-account.mjs`，属数据迁移非 schema 迁移）。
- users.db 落 `ETERNA_ACCESS_DIR`（默认 `$DSH_HOME/access`，卷上；plugin.ts:38 注、plugin.ts:145-148 构造），**插件每次启动即执行构造器——迁移必须幂等**。
- 角色消费点：`insert`（store.ts:149-150 直接写 role 列）、`verifyLogin`/`getUserById`/`listUsers` 透出（store.ts:178-226）、删除护栏仅对 admin（LastAdminError，store.ts:263-277）、`notifyAdmins` 按 `role='admin'`（store.ts:446-449）。**无任何 setRole/setUserRole 写面**。
- 外键事实（迁移关键约束）：workspaces/sessions/approvals/notifications/user_plugins 五表 `REFERENCES users(id)`，node:sqlite 默认开 FK 强制（store.ts:260-262 注）——users 表重建期间必须按官方流程处理 FK pragma（`PRAGMA foreign_keys` 在事务内是 no-op，必须事务外设置）。

### 1.2 mux 流隔离（`packages/access/src/mux.ts`，276 行）

- 隔离机制 = admit 换血（mux 升级请求 → per-user Peer，principal=`{kind:'eterna-user',userId}`，mux.ts:33-36/249-263）+ `registerPolicy('eterna-user', { bindings })`（mux.ts:244-246）。
- `bindingsFor(deps, userId)`（mux.ts:200-217）：**当前完全无角色概念**——任何用户都是 1 个 GLOBAL 绑定 + 本人 sessions 绑定 + 本人 workspaces 绑定（账本 `store.sessionsOfOwner/workspacesOfOwner` 为唯一事实源）。admin 与普通用户的 mux 绑定**今天就没有区别**（都不见他人会话）。
- `MuxPolicyDeps = { store: Pick<UserStore,'sessionsOfOwner'|'workspacesOfOwner'>, session }`（mux.ts:171-174）——加角色读取需扩此 Pick。
- 动作清单常量：GLOBAL/SESSION/WORKSPACE × STREAM/UNARY + SESSION_EVENT（mux.ts:49-162）；防漂移测试断言清单与上游 typert 流方法表差集=∅、流/一元互斥（mux.ts:27、tests/mux-drift.spec.ts）。**清单中不存在任何「待人项」类动作**——上游无 person/* 工单流端点。
- 策略绑定回调为惰性函数 `(principal) => bindingsFor(deps, principal.userId)`（mux.ts:245），mux.ts:243 注释「每用户绑定动态读账本；归属变更由调用方 invalidate」——**上游 registerPolicy 是否每次 decide 重算回调、还是缓存，未核实**（本批 TS-37-1 核实项，见 M-3）。
- 装配点：`ensureMux` 惰性安装（首个守卫请求时；plugin.ts:246-273），per-user Peer 缓存 ≤20 常驻（mux.ts:248-262）。

### 1.3 用户管理面（routes + client）

- 端点（`handleAccessRequest`，routes.ts:67-107）：`GET/POST /access/api/users`（admin-only，routes.ts:365-402）、`DELETE /access/api/users/<id>`（admin-only，routes.ts:404-419）。**建号角色校验写死两值**：`if (roleRaw !== 'admin' && roleRaw !== 'user') return errorReply(400, '角色仅支持 admin/user')`（routes.ts:381-385）。**无角色变更端点**。
- 审计先例：`access.user.add` 带 `detail:{role:'admin',requested}` / `access.user.delete`（routes.ts:395-400/417）；审计经 `reportAccessAudit` 直投 audit（缺席降级不阻塞，audit.ts:24-43）。
- 客户端半边：设置弹窗分区 `settings.section`（AGENTS.md 前端铁律 1；参考实现即本包）。角色分支在 `client/index.tsx:408-414`——`fetch('/access/api/me')` 后 `registerSections(me.role === 'admin' ? 'admin' : 'user')`；admin 分支多注册用户管理（order 41）+ 审批队列（order 44）+ 恒灵插件管理页签（index.tsx:376-405）。**approver 落入 'user' 分支 = 不见任何 admin 面（天然 fail-closed，无需改此行即成立）**。
- `UsersSection`（sections.tsx:257-327）：建号表单角色下拉两档（sections.tsx:302-305，宽 110px）、角色标签两态 `ea-tag brand`（admin）/`ea-tag`（user）（sections.tsx:316；样式 styles.ts:101-103）。
- 类型面：`client/api.ts` 的 `Me.role`/`UserRowView.role`/`createUser` 参数均为 `'admin' | 'user'`（api.ts:10/18/65）。
- i18n：`users.roleUser`「普通用户」/`users.roleAdmin`「管理员」中英双语（index.tsx:83-84/196-197）。
- 身份胶囊：账户菜单 admin 徽标 `me?.role === 'admin'`（account-menu.tsx:296，i18n `menu.admin`）。

### 1.4 测试与门禁现状（本机 2026-11-17 实跑，全绿基线）

| 命令 | 结果 |
|---|---|
| `pnpm --filter @eterna/access run verify` | ✅ 退出码 0（build:client + oxlint + tsc + vitest：24 文件 199 测试全过） |
| `pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/mux-peer-drift.spec.ts tests/mux-policy.spec.ts tests/gateway-role-gate.spec.ts` | ✅ 4 文件 26 测试全过 |
| `node tools/packctl/bin/packctl.mjs tenant-scan` | ✅ `tenant-scan: 0 finding(s)` |

- `tests/mux-policy.spec.ts`（3 用例）：直接断言 `bindingsFor` 形状（GLOBAL/session/workspace 绑定与动作清单）——**扩 approver 用例的天然落点**。
- `tests/gateway-role-gate.spec.ts`（7 用例）：settingsController 实例 wrap 的 admin 判定（P2-T1.7a，principal 判定先例）——**G2-C3 指名扩审批人用例的落点**。
- `tests/store.spec.ts`（13 用例）：建号/后缀/护栏；`tests/routes.spec.ts`（23 用例）：含非法 role 400 断言（routes.spec.ts:268-271，`role:'root'` → 400）。

## 2. 拍板依据原文（精确引用，实施的一切行为边界）

| # | 出处 | 原文 | 对本批的约束 |
|---|---|---|---|
| B1 | 30 号 §7-3 拍板表第 3 行（:102） | 「可见性 = access 新增『审批人』角色（方案 b）／审批人见全租户待人项；普通用户仅自己的；管理员全量。access 改动：**用户表角色字段 + mux 过滤 + 用户管理 UI 三处**；**B2 领域专家角色后续共用此机制**（一次立住角色模型）」 | 三处改动 = 本批 M-1/M-2/M-3；可见性三档 = M-4 谓词；B2 共用 = M-5 |
| B2 | 30 号 §4.5（:63） | 「工作台数据按 access realm 钳制——普通用户仅自己的工单；审批人（新角色，§7-3 拍板）见全租户待人项；管理员全量」 | 可见性规则的**作用对象是工作台数据**（待人项），不是 WS mux 会话内容流（见 §7 缺口 3） |
| B3 | 30 号 §1 角色表（:18-24）+ §2 五视图（:34） | 审批人/主管「看『等谁的』清单、答复 Attention」（工作监控视图）；工作监控 = 工单按阶段看板（`person/*`、`working/queued`、`idle` 分列）；「面板只显示需要人的东西」（:26） | 「待人项」语义 = `person/*` 阶段工单/Attention；该数据面属 tasks Engine（P1）与工作台（P2） |
| B4 | 24 号 §7.2（:244-252） | 「**审批人**（主管/合规/财务）｜ Attention 卡（站内横幅 + 飞书卡片 + 邮件链接）｜ 批 / 拒 / 要求改；R3 双确认与冷静期｜ 每周数次，**只在红线处**」 | 角色职责边界与操作面定义（审批人操作面 = Attention 卡，**不是** admin 管理面） |
| B5 | 33 号 §1.3 WS-C（:144-152） | G2-C1 包级 verify；G2-C2 mux 防漂移 + 「审批人角色经 mux 过滤正确」；G2-C3 「审批人见全租户待人项；普通用户仅自己的工单/会话；管理员全量——三角色断言走响应体 JSON 特征字段（禁全页文本子串断言，`docs/USER-GUIDE.md:50-51`）」排 **M3（工作台实接前）**；G2-C4 新端点 diff 必含 tenant.ts 或 routes.ts 行 + tenant-scan；G2-C5 「用户管理界面可分配/收回审批人角色；操作进审计 jsonl（actor/时间/对象）；**角色变更对 mux 可见性即时生效**」 | 每条任务的门禁与排期直接对齐此五行 |
| B6 | 32 号 §2 WS-C 行（:32） | 「WS-C access 审批人角色｜用户表角色字段 + mux 过滤 + 用户管理 UI（30 号 §7-3 拍板）｜无（依赖）｜小；B2 与工作台共用」 | 无前置依赖、体量小、先行立角色模型 |
| B7 | 23 号 §3.1（:55-57）+ §3.2（:69）+ Q3（:105） | 「面板/SRC 侧从 mux principal（access 守卫后）取」；「两路解析收敛为一个 `accountOf()` helper」；「**fail-closed**：账号解析失败……绝不退回全局库——宁可丢一条记忆，不可跨账号写」；Q3「workspace 目录与账号的映射键 = **access 账号 id**（稳定）」 | mux principal → 账号/角色是唯一真值源；本批可见性同样 fail-closed：**宁可少可见，不可多可见** |
| B8 | PLUGIN-AUTHORING §1.1（:28-37） | T1 持久化在 DSH_HOME 语义下；T2 路由面独占（「纯展示页走 access 的 `/access/*` 面」）；第 6 条 mux 流隔离：「策略绑定按归属账本动态返回……**新上游流端点落地时必须同步加入动作清单（测试即红）**」；§1.1 引言「unary `/api` 端点由租户守卫按登录归属判定，`/api` 之外的 Web 面（登录/配置/管理页）由 access 独占」 | 新角色端点走 routes.ts 的 `/access/api` 面（webServer.register prefix，plugin.ts:238）；mux 改动不得绕过动作清单防漂移 |
| B9 | 34 号 §5 access 接线点（:296-299；节号经本轮评审核实更正——原引 §6 有误，34 号 §6 为开放问题（:325）） | 「`tenant.ts` + `mux.ts`：principal → realm 解析，是 `TasksRealmRouter` 的唯一账号真值来源（与 23 号 `accountOf()` 同一实现复用）」；「用户表：……★30 号 Q3 新增『审批人』角色字段同样供 tasks 的 Attention 定向」 | 角色字段与谓词的**下游消费者**（tasks/工作台）；接口形状须可被 34 号复用 |
| B10 | 30 号 §7-3 同行 + 26 号 §7-1（:186 待拍板项 6）+ 33 号 G2-F4（:189） | 「B2 领域专家角色后续共用此机制」；26 号「领域专家的维护界面……是否需要经 prompt-studio / panel 提供受控编辑面（走 R3 审批）」为待拍板；G2-F4「领域专家角色复用 WS-C 审批人角色机制……专家仅见编辑面不见审批队列等 admin 面的断言不回归」 | 本批**不加**专家角色值；机制须留单点扩展位（M-5） |

## 3. 任务分解（每条两列可追溯：依据条款 → 验收门禁）

> 排期对齐 33 号：M-1/M-2/M-3 的包内测试随 G2-C1/G2-C2 在 M1 先行；G2-C3 三角色待人项断言与 G2-C5 的 E2E 段在 M3（工作台实接前）收口。

### M-1 用户表角色字段扩值与存量库迁移（`packages/access/src/store.ts`）

**改动**：

1. `UserRole` 扩为 `'admin' | 'approver' | 'user'`（store.ts:13）。命名沿现有英文小写枚举先例（'admin'/'user'，store.ts:13），中文「审批人」仅在 UI 文案层（M-3）。
2. 建表语句 CHECK 改为 `CHECK(role IN ('admin','approver','user'))`（store.ts:83）——新库直接生效。
3. **存量库迁移**（本任务的技术难点，SQLite CHECK 不可 ALTER）：构造器内、建表语句之后执行幂等迁移 `migrateRoleConstraint(db)`——**运维形态未拍板（§7 缺口 4，评审第四类边缘项）**：「构造器内静默幂等迁移」系本批在拍板「用户表角色字段」于 SQLite CHECK 不可 ALTER 下的必要技术后果中**自选的默认形态**（fail-loud、事务内可回滚），与 23 §3.3/§4 Q4 部署窗口+卷快照先例构成两形态对照，未获拍板即实施；评审若定后者，本函数前移为显式脚本（代码同源，可复用）：
   - 判定：`SELECT sql FROM sqlite_master WHERE type='table' AND name='users'`，SQL 文本不含 `'approver'` 即视为旧形态（新库/已迁移库跳过，幂等）；
   - 重建：按 SQLite 官方 ALTER TABLE §7 十二步流程的必要子集——事务外读 `PRAGMA foreign_keys` 存原值并 `OFF` → 事务内 `CREATE TABLE users_m(...)`（新 CHECK，列集与现表一致，store.ts:77-87）→ `INSERT INTO users_m SELECT id,account,nickname,password_hash,password_version,role,avatar,avatar_mime,created_at FROM users`（**显式列名，禁 `SELECT *`**——两表列序若漂移即错位）→ `DROP TABLE users` → `ALTER TABLE users_m RENAME TO users` → 提交 → `PRAGMA foreign_key_check` 核对 → 恢复原 foreign_keys 值。任何一步失败抛出（fail-loud，不吞——启动失败优于静默半迁移库）；
   - 子表（workspaces/sessions/approvals/notifications/user_plugins）**不动**：重建仅换父表壳，行 id 与 FK 引用不变。
4. `CreateUserInput.role?: UserRole` 类型随之放宽（store.ts:44-49）；`insert`/`createUserWithSuffix` 无需改（透传 role）。
5. 删除护栏不变：LastAdminError 仅对 admin（store.ts:267-269）；approver 删除无特殊护栏（无拍板依据加护栏，沿普通用户路径）。
6. `verifyLogin`/`getUserById`/`listUsers`/`meView`/`publicView` 的 role 透出类型自然放宽（store.ts:178-226、routes.ts:216-229）——无逻辑改动。

| 依据条款 | 验收门禁 |
|---|---|
| 30 §7-3「用户表角色字段」（B1）；33 G2-C1/G2-C5（角色可分配的前提=值域先立）；34 §5「用户表……审批人角色字段同样供 tasks 的 Attention 定向」（B9） | `pnpm --filter @eterna/access exec vitest run tests/store.spec.ts`——扩用例：① 新库建 approver 用户成功且读回 role='approver'；② **迁移用例**：先用旧 CHECK 建表 SQL 手工构造存量库（tmp 目录，复用 gateway-role-gate.spec.ts:22-26 的 mkdtemp 先例）→ `new UserStore(path)` 触发迁移 → 旧三列数据（含 admin/user 各一）完整读回 + 可写入 approver + `PRAGMA foreign_key_check` 空 + 子表 FK 行数不变；③ 幂等：对已迁移库再 `new UserStore` 无副作用（sqlite_master SQL 不再变）；④ 非法 role 仍被 CHECK 拒绝（constraint error 冒泡）。全部随 `pnpm --filter @eterna/access run verify`（G2-C1）收口 |

### M-2 mux 角色感知过滤 + 可见性谓词单真值（`packages/access/src/mux.ts`）

**改动**：

1. `MuxPolicyDeps.store` 的 Pick 增 `getUserById`（mux.ts:171-174）——bindings 回调内按 `principal.userId` 现查角色（**不得在 installMuxIsolation 时缓存角色**——G2-C5「角色变更对 mux 可见性即时生效」依赖动态读账本，与 mux.ts:243 注释同一语义）。
2. **可见性谓词（本批核心导出，30 §4.5 三档的代码化单真值）**：

   ```ts
   /** 30 号 §4.5：工作台数据可见性档位——普通用户仅自己；审批人全租户待人项；管理员全量。
    *  消费面：P2 工作台数据端点（待人项过滤）与 G2-C3 三角色断言。mux 内容绑定不消费此谓词（见下）。 */
   export type VisibilityScope = 'self' | 'tenant-pending' | 'all'
   export function visibilityScopeOf(role: UserRole): VisibilityScope
   // 'user' → 'self'；'approver' → 'tenant-pending'；'admin' → 'all'；exhaustive switch，default fail-closed 判 'self'
   ```

   位置放 mux.ts（拍板文本「mux 过滤」的正位；34 号 B9 亦锚定 tenant.ts+mux.ts 为 realm 真值源）。`UserRole` 从 store.ts import（mux.ts 现已 import UserStore 类型，mux.ts:30）。
3. **内容绑定不放宽（fail-closed 不变式）**：`bindingsFor` 对三角色返回**完全同构**的本人内容绑定（GLOBAL + 本人 sessions + 本人 workspaces）——拍板只授权审批人见「待人项」（工作台数据面），未授权跨租户会话/工作区内容流（§7 缺口 3）；admin「全量」同样是工作台数据语义（B2），mux 内容流无放宽依据。 bindingsFor 仅新增角色读取以驱动未来待人项动作分支的判定点，本批不添加任何新动作/绑定（上游流方法表无待人项端点，B8 第 6 条：动作清单以测试即红防漂移——**无上游端点即不登记动作**）。
4. mux.ts:243 注释「归属变更由调用方 invalidate」的存疑语义固化为 TS-37-1 核实项（见 M-3 即时生效验收）。

| 依据条款 | 验收门禁 |
|---|---|
| 30 §7-3「mux 过滤」+ §4.5 三档（B1/B2）；33 G2-C2「审批人角色经 mux 过滤正确」（B5）；23 §3.1 fail-closed 纪律「宁可丢……不可跨账号」（B7，同构迁移为「宁可少可见，不可多可见」）；PLUGIN-AUTHORING §1.1 第 6 条动作清单纪律（B8）；34 §5 principal→realm 唯一真值（B9） | `pnpm --filter @eterna/access exec vitest run tests/mux-policy.spec.ts`——扩用例：① `visibilityScopeOf` 三角色映射 + 未知值 fail-closed 判 'self'；② approver 用户的 `bindingsFor` 与同资源的 user 用户**逐项全等**（内容绑定零放宽不变式）；③ 角色动态性：同一 store 内 `setUserRole` 改 approver→user 后再次调用 bindings 回调，绑定与谓词随新角色（即时生效的 node 级断言面）。防漂移不回归：`pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/mux-peer-drift.spec.ts`（G2-C2 原断言全绿——动作清单零新增即零破坏） |

### M-3 用户管理分区：分配/收回审批人角色 + 审计 + mux 即时生效（routes.ts + client）

**改动**：

1. **服务端新端点**（routes.ts `handleAccessRequest` 登记面，plugin.ts:238 的 `/access/api` prefix 自然覆盖）：
   - `POST /access/api/users/<id>/role`：admin-only（沿 handleUserCreate 的 `admin.role !== 'admin'` 403 判定，routes.ts:373-375）；body `{ role }`，**值域仅 `{'approver','user'}`**（G2-C5 只拍板「分配/收回审批人」；admin 角色在线变更无拍板依据，不扩——§7 缺口 7）；目标不存在 404；不能改自己角色返回 400——**自设护栏（§7 缺口 10，本轮评审第四类意见）**：30 §7-3/§4.5、33 G2-C5、24 §7.2 均无此条款（G2-C5 仅拍板「可分配/收回审批人角色」），系沿 SelfDeleteError 自操作护栏**精神**的类推、设计文档之外新增的限制性行为约束，方向 fail-closed 本批保留，去留待评审拍板（放开则删此判并同步用例⑥）；落库 `store.setUserRole(id, role)`（新方法：requireRow + `UPDATE users SET role=?`，store 层不判角色语义，沿 setPassword 形态 store.ts:237-245）；
   - 审计：`kind: 'access.user.role'`，`account`=操作者，`detail: { target: <目标账号>, from: <旧角色>, to: <新角色> }`（满足 G2-C5「actor/时间/对象」——actor=account 字段、时间=audit 侧时间戳、对象=detail.target；沿 access.user.add 先例 routes.ts:395-400）。
   - 建号端点角色校验放宽：`roleRaw` 合法集改三值，400 文案「角色仅支持 admin/approver/user」（routes.ts:381-385）。
2. **客户端**（交互细节逐条见 §4 对照表）：
   - `client/api.ts`：`Me.role`/`UserRowView.role`/`createUser` 参数类型放宽为 `UserRole`；新增 `setUserRole(id, role)`（api.ts:10/18/65）；
   - `sections.tsx` `UsersSection`：建号角色下拉增「审批人」档（sections.tsx:302-305）；用户表角色列三态标签——admin=`ea-tag brand`（不变）、**approver=`ea-tag`（默认档，不新增视觉语言）+ 文案「审批人」**、user=`ea-tag`「普通用户」（sections.tsx:316）；行内角色变更：非本人行提供角色 select（当前角色预选，改选即调 `setUserRole`，失败行内错误提示沿 msg 面先例 sections.tsx:325）——「分配/收回」两向同控件；
   - `client/index.tsx`：registerSections 角色分支**不改**（`me.role === 'admin' ? 'admin' : 'user'` 对 approver 天然落入 user 分支 = 不见用户管理/审批队列/恒灵插件管理任何 admin 面，G2-F4「专家仅见编辑面不见审批队列等 admin 面」的同构前提先立于此）；i18n 增 `users.roleApprover`（zh「审批人」/en「Approver」，index.tsx LOCALES 两块）。
3. **mux 即时生效**（G2-C5 第二判据）：角色读取在 bindings 回调内动态执行（M-2 改动 1）即满足「账本/角色为唯一事实源」。TS-37-1（实施前置核实，对齐 19 号 §8 spike 方法）：核实上游 `registerPolicy` 的 bindings 回调求值时机——若上游按 principal 缓存绑定快照，则须在角色变更后使该用户 per-user Peer 失效重建（peers Map，mux.ts:249-262 已有 dispose 面）；核实结论回填本文档 §7，未核实前 M-3 的 E2E 段（M3 里程碑）不得宣告。

| 依据条款 | 验收门禁 |
|---|---|
| 30 §7-3「用户管理 UI」三处之一（B1）；33 G2-C5 全部三判据（分配/收回 + 审计留痕 + mux 即时生效）+ G2-C4（diff 必含 routes.ts 行 + tenant-scan 绿）（B5）；PLUGIN-AUTHORING §1.1 T2（access 独占 `/access/*` 面，B8）；24 §7.2 审批人操作面=Attention 卡、**非 admin 管理面**（B4——UI 上审批人不获得任何 admin 分区） | `pnpm --filter @eterna/access exec vitest run tests/routes.spec.ts`——扩用例：① admin 建号 role='approver' 201 + 响应 `user.role==='approver'`；② admin POST role 端点 user→approver→user 两向 200 + 响应体 JSON 断言；③ 审计断言：fake audit 收到 `access.user.role` 且 detail 含 target/from/to；④ 非法值（'admin'/'root'）400；⑤ 普通用户/审批人调端点 403（**审批人无权分配角色**——无拍板依据授予）；⑥ 改自己 400（**§7 缺口 10 自设护栏**，随该缺口拍板联动——评审放开则本用例改判）。角色变更后 mux 即时生效（node 面）已由 M-2 用例③覆盖；E2E 段（分配→可见性变化）= 33 号 G2-C5 E2E，M3 收口（见 M-4）。门禁命令汇总过 G2-C1（全量 verify）；`node tools/packctl/bin/packctl.mjs tenant-scan` 保持 0 findings（G2-C4，新端点在 routes.ts 的 access 面内，不触 T2 红线） |

### M-4 可见性规则：三档谓词断言 + G2-C3 两阶段（`tests/gateway-role-gate.spec.ts` 扩 + M3 的 E2E）

**改动（分两阶段，严格对齐 33 号排期）**：

- **M1 阶段（本批随 WS-C 交付）**：`gateway-role-gate.spec.ts` 扩审批人用例——三角色对现有数据面的**响应体 JSON 特征字段**断言（禁全页文本子串断言，B5 引 `docs/USER-GUIDE.md:50-51` 纪律）：① `/access/api/me` 三角色 `role` 字段正确；② mux `bindingsFor`：普通用户/审批人/管理员内容绑定同构（仅本人资源，零放宽不变式，M-2 用例②在此文件以角色门视角复述）；③ admin 面端点对 approver 403（用户列表/建号/删号/角色变更/插件启停）——「审批人≠管理员」。
- **M3 阶段（工作台实接前，33 号 G2-C3 排程）**：待人项三档断言（`self`/`tenant-pending`/`all`）——**断言对象（工作台待人项端点）与 JSON 特征字段名今日不存在**（工作台=P2/WS-D，B3 数据面），本批只保证谓词与角色就位；届时断言写法：审批人视角待人项列表含他人 realm 条目、普通用户仅含本人、管理员全量。E2E 脚本（G2-C3/G2-C5 的「+ E2E 脚本」）**文件名 33 号未指定**，仓内也无 access 角色 E2E 先例（scripts/ 目录核实，§1.4）——见 §7 缺口 1。

| 依据条款 | 验收门禁 |
|---|---|
| 30 §4.5「工作台数据按 access realm 钳制——普通用户仅自己的工单；审批人见全租户待人项；管理员全量」（B2）+ §7-3（B1）；33 G2-C3 全文与 M3 排程 + JSON 特征字段纪律（B5）；23 号 realm 语义（access 账号 id 为键，B7） | M1 段：`pnpm --filter @eterna/access exec vitest run tests/gateway-role-gate.spec.ts`（7+新增用例全绿）。M3 段（工作台实接前收口，本批不宣告）：同文件扩待人项三档断言 + E2E 脚本（分配→可见性变化闭环，G2-C5 后半） |

### M-5 B2 领域专家角色共用机制预留（零行为改动，静态锚以测试验收）

**改动**：不加值、不加面；唯一新增物 = 静态锚测试文件 `tests/role-expansion-anchor.spec.ts`（随本批建——本轮评审修正：原「静态锚核对（评审项，随 PR diff）」不可机器验收，违反 33 §2「每条门禁必须落为命令/测试/产物三形态之一」，改落【T】测试形态）。三锚不变：① `UserRole` 单点定义（store.ts:13，B2 复用时只改此联合类型 + CHECK 迁移函数参数化）；② `visibilityScopeOf` exhaustive switch（加专家值即编译红，防漏配档）；③ client 角色分支单一（index.tsx:412 一处三元）。26 号 §7-1 第 6 项（受控编辑面）仍是待拍板项，专家角色的档位/面**不得在本批预设**（B10）。

| 依据条款 | 验收门禁 |
|---|---|
| 30 §7-3「B2 领域专家角色后续共用此机制（一次立住角色模型）」（B1）；33 G2-F4（专家复用机制、不见 admin 面断言不回归，M4-M5）（B5）；26 号 §7-1 待拍板项 6（B10）；33 §2.1 门禁可验收性三形态（:219-227，【T】=测试文件+断言——静态锚核对须测试化） | `pnpm --filter @eterna/access exec vitest run tests/role-expansion-anchor.spec.ts`【T】（本批新建）——读源/运行时断言三处无专家值旁路：① store.ts 源文本 `export type UserRole` 恰一处，且 UserRole 联合值集与 users 建表 CHECK 值集逐字一致（旁路单点加值即红）；② `visibilityScopeOf` 运行时三档映射 + 未知值 fail-closed 判 'self'（exhaustive switch 行为面；编译面由 verify 链 tsc 承担）；③ client/index.tsx 源文本 registerSections 角色分支恰一处（`me.role === 'admin' ? 'admin' : 'user'` 形态，无第二处角色分支三元/switch）。随 `pnpm --filter @eterna/access run verify`（G2-C1）收口；G2-F4 用例（专家角色）属 M4-M5 批次，本批不建 |

## 4. 交互细节对照表（M-3 前端/交互任务专用）

> 范围=「用户管理 UI 分区」该处。逐条列 24/26/27/28/29 号中**对该处**的已拍板交互细节（状态/文案/断点/a11y/主题/降级态）并标注实现位置；无细节的文档显式记「无该处条目」（已逐号 grep 核实：审批/角色/待人/管理员/设置/管理 关键词全扫）。30/33 号与仓规（AGENTS.md、frontend-style）条目另列补充表——它们是工作台/全仓 UI 的直接约束源，但非本表五号之义。

### 4.1 五号设计文档对该处的已拍板细节

| # | 出处（号§节:行） | 已拍板交互细节 | 实现位置（本文档任务） |
|---|---|---|---|
| 1 | 24 §7.2:249 | 角色**文案**：「审批人」角色名固定（与「主管/合规/财务」为同一角色的列举说明，UI 不拆分三身份） | i18n `users.roleApprover`=「审批人」（M-3 改动 2c） |
| 2 | 24 §7.2:249 | 角色**职责边界（状态语义）**：审批人操作面=Attention 卡（批/拒/要求改；R3 双确认与冷静期），频率「每周数次，只在红线处」——**审批人不获得 admin 管理面** | client/index.tsx:412 角色分支不改：approver 落 user 分支，不见用户管理/审批队列/恒灵插件管理（M-3 改动 2c）；admin 面端点对 approver 403（M-4 ③） |
| 3 | 24 §7.2:248-252 | 五角色并立（发起人/审批人/领域专家/平台管理员/审计合规）——用户管理分区的角色枚举是**全角色模型的 access 承接点**，普通用户/审批人/管理员三档为当前已拍板子集 | 建号角色下拉三档（M-3 改动 2b）；B2 专家档后续共用（M-5） |
| 4 | 24 §6 P2 行:218 | UI 形态铁律：「严守 AGENTS.md：走 **slots 扩展点，不建独立页面**」 | 沿 `settings.section` slot 注册（sections.tsx:257 现状即合规，本批零新增页面/弹窗） |
| 5 | 24 §6 P2 行:218 | 验收纪律：「**深浅主题截图自查通过；移动端可用**」 | UI PR 附深浅双主题截图（沿 AGENTS.md:15 全仓规）；表格横向滚动/640px 由既有 `ea-table-wrap` 承接（styles.ts，本批不新增布局件） |
| 6 | 26 号全文 | **无该处条目**（grep 核实：26 号「审批/设置/管理/角色」命中均为工具面/插件改造/待拍板项 6，无用户管理 UI 交互细节） | — |
| 7 | 27 号全文 | **无该处条目**（命中为 worker 组织层与冲突升级机制，:109「升级为人：Attention 结构化提问、面板 stop/retry、审批」属工作台面板，非用户管理分区） | — |
| 8 | 28 号全文 | **无该处条目**（:128「摘要模型按角色分档」为模型分档非界面角色） | — |
| 9 | 29 号全文 | **无该处条目**（全文无审批/角色/待人相关 UI 条目，grep 零命中） | — |

### 4.2 补充：30/33 号与仓规对该处的直接约束（非五号之义，防遗漏）

| # | 出处 | 细节 | 实现位置 |
|---|---|---|---|
| S1 | 30 §4:59-62（经 AGENTS.md:5-15 铁律化） | 令牌只 `--et-*`（经 `--dsw-alias-*` 桥接）禁字面色值；图标走 `@eterna/ui/icons`；中文 UI；a11y（语义标题/focus 光圈/`prefers-reduced-motion`）；响应式 1100/760/640 | 本批 UI 仅在既有 `UsersSection` 内加下拉档/标签/行内 select，全部沿用既有 `ea-input`/`ea-tag` 令牌类（styles.ts），零新增样式面 → 天然合规 |
| S2 | frontend-style §5 检查清单 | 「破坏性操作两击确认」「触控目标 ≥36px」「按钮/输入有 `:focus-visible`」 | 行内角色 select 非破坏性删除类（收回=权限变更可逆，重赋即可）——是否需两击确认未拍板（§7 缺口 5），本批取即选即改+失败行内回滚提示；select/option 复用 `ea-input`（既有 focus/触控规格随类） |
| S3 | 33 G2-D2（:150，对全部 UI PR 的 D2 纪律类推） | 深浅双主题截图入库 `docs/design/prototypes/<id>/prs/<PR号>/` | M-3 的 UI PR 附双主题截图（原型先行流程 30 §5 对**新增原型四件**适用；本批为既有分区的档位扩展，不触发新原型件——若评审认定角色三态标签为新视觉件则补原型，列 §7 缺口 5 附带项） |
| S4 | 30 §7-3 + 24a 第三轮 Q3 | 「一次立住角色模型」——UI 角色枚举与后端值域同源（`UserRole`），不得 UI 层另造字符串 | 建号下拉/标签/行内 select 的值全部来自 api.ts 放宽后的 `UserRole` 类型（M-3 改动 2a） |
| S5 | 降级态（本批语境） | 审批人登录后**无任何新增可见面**（工作台 P2 未到）= 预期降级态而非缺陷；`/access/api/me` 401/网络失败时分区不注册（index.tsx:408-414 现状 fail-closed 保持） | 无改动（现状即合规）；E2E 验证点列入 M3 阶段 G2-C3 |

## 5. 验收门禁汇总（命令均于 2026-11-17 本机实跑过基线，见 §1.4）

| 门禁 | 命令 | 基线（改动前） | 收口里程碑 |
|---|---|---|---|
| G2-C1 包级 verify | `pnpm --filter @eterna/access run verify` | ✅ 24 文件 199 测试过、退出码 0 | M1（每批 PR） |
| G2-C2 mux 防漂移+角色过滤 | `pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/mux-peer-drift.spec.ts tests/mux-policy.spec.ts` | ✅ 全绿（26 测试内含） | M1 |
| M-1 store（含迁移） | `pnpm --filter @eterna/access exec vitest run tests/store.spec.ts` | ✅ 13 用例过（扩 4+ 用例） | M1 |
| M-3 routes/审计 | `pnpm --filter @eterna/access exec vitest run tests/routes.spec.ts` | ✅ 23 用例过（扩 6 用例） | M1 |
| M-4 角色门（M1 段） | `pnpm --filter @eterna/access exec vitest run tests/gateway-role-gate.spec.ts` | ✅ 7 用例过（扩审批人用例） | M1 |
| M-5 B2 扩展锚（静态锚核对） | `pnpm --filter @eterna/access exec vitest run tests/role-expansion-anchor.spec.ts`（本批新建，§3 M-5——本轮评审补录：原门禁为不可执行的「评审项」，已测试化并收录本表） | 未建（锚①③ 现状即真：store.ts:13 单点定义、index.tsx:412 单分支；锚② 待 M-2 谓词落地后可断言） | M1 |
| G2-C4 角色面登记 | `node tools/packctl/bin/packctl.mjs tenant-scan`（涉改 PR diff 必含 routes.ts 行） | ✅ 0 findings | M1 起持续 |
| G2-C3 可见性 E2E + G2-C5 E2E 段 | `tests/gateway-role-gate.spec.ts` 待人项三档断言 + E2E 脚本（**待建**，§7 缺口 1） | 未跑（断言对象工作台端点未存在） | **M3（工作台实接前）** |

## 6. 实施顺序与依赖

```
M-1 store 值域+迁移（无依赖，先行）
   └→ M-3 服务端角色端点（依赖 M-1 的 setUserRole 与值域）
        └→ M-3 客户端分区（依赖 api 类型放宽；build:client 进 verify）
M-2 mux 谓词+角色感知（与 M-3 并行；依赖 M-1 的 UserRole 扩值）
   └→ M-4 M1 段角色门断言（依赖 M-1/M-2/M-3 全落）
        └→ M-4 M3 段待人项断言 + E2E（外部依赖：WS-A tasks Engine / WS-D 工作台，非本批）
M-5 零行为改动，随本批新建 tests/role-expansion-anchor.spec.ts（静态锚测试化，§3 M-5）
```

TS-37-1（M-3 前置核实）：上游 `registerPolicy` bindings 回调求值时机（缓存 or 每 decide 重算）——决定「角色变更即时生效」是否需补 per-user Peer 失效面；核实法：读上游 dsh-api-remote-access 源码（node_modules 内）+ 以 stub registerPolicy 捕获回调调用次数的单测；结论回填本文档 §7。

## 7. 开放问题（设计缺口，如实记录——本批一律 fail-closed 不放宽，待评审拍板）

| # | 缺口 | 现状处理 |
|---|---|---|
| 1 | **「待人项」数据面缺位**：30 §4.5 三档可见性的作用对象是工作台数据（`person/*` 工单/Attention，B3），该数据面属 tasks Engine（P1）与工作台（P2）；当前代码无任何待人项端点，G2-C3 的待人项断言对象与「响应体 JSON 特征字段名」均不存在；33 号 G2-C3 的「+ E2E 脚本」未指定文件名，仓内无 access 角色 E2E 先例（§1.4） | 本批只立角色模型+谓词+「不放宽」不变式；待人项断言与 E2E 脚本 M3 补（工作台实接前），字段名待 WS-D 定 |
| 2 | **审批人与既有两个「待人」面的关系未拍板**：(a) 插件转内置审批队列（`/api/approvals/pending` + ApprovalQueueSection，现 admin-only，my-plugins-section.tsx:156-197）；(b) 工具审批桥（`/access/api/approvals/tool-pending`，现仅本人，approval-bridge + routes.ts:125-140）。审批人是否可见/可决这两面，30/24/24a/33 均无条款 | 不放宽（两面维持 admin-only/本人-only）；待评审 |
| 3 | **「管理员全量」的边界**：拍板文本（B2）指工作台数据全量；WS mux 会话/工作区**内容流**对管理员是否放宽（如 admin 见他人 session/follow）无任何条款；同理审批人的待人项若需经 mux 会话列表元数据（event:api-session/*）呈现亦未拍板 | mux 内容绑定三角色一律仅本人（M-2 不变式）；待工作台数据面设计（WS-D）时一并拍 |
| 4 | **存量 users.db 迁移的运维形态**：构造器内静默幂等迁移（本批方案）vs 部署窗口+卷快照（23 §3.3/§4 Q4 对 memory 库的纪律先例）未拍板；users.db 在卷上，容器重启即触发 | 取构造器幂等迁移（fail-loud）+ 事务边界内可回滚；若评审要求卷快照纪律，则迁移前置为显式脚本——两形态代码同源（§3 M-1 的迁移函数可被脚本复用） |
| 5 | **角色收回的确认形态与文案**未拍板（frontend-style §5 两击确认限定「破坏性操作」，权限收回是否属之无定论）；附带：三态角色标签是否构成新视觉件而触发 30 §5 原型先行 | 即选即改+失败行内提示；若评审判破坏性则加 TwoClickButton（confirm-button.tsx 现成件） |
| 6 | **审批人身份标识**：账户菜单身份胶囊（account-menu.tsx:296 的 admin 徽标先例）是否为审批人加徽标未拍板 | 不加（fail-closed）；待评审 |
| 7 | **admin 角色在线变更**：现仅建号可设 admin，角色变更端点是否放开 'admin' 值未拍板（涉及末位 admin 护栏的在线化语义） | 端点值域限 {'approver','user'}；admin 变更仍走建号/删号（实施：目标现为 admin 的请求一并 400「管理员角色不可在线变更」——routes.ts handleUserRoleSet；用例 routes.spec WS-C ⑥b） |
| 8 | **B2 领域专家角色的值域名/档位/面**：26 号 §7-1 第 6 项仍待拍板（受控编辑面已选、角色承载未细化）；CHECK 约束届时需二次迁移（本批迁移函数已参数化缓解） | 本批零预设（M-5）；G2-F4 批次（M4-M5）落 |
| 9 | **TS-37-1 核实项**：上游 registerPolicy 绑定回调求值时机未知（mux.ts:243 注释「归属变更由调用方 invalidate」语义存疑） | **已核实（2026-11-17，WS-C 实施时回填）**：dsh-api-remote-access `lib/index.js` 的 `bindingsOf`（:326-329）在每次 `decide`（:227）与 `allows`（:259）时直调 `entry.policy.bindings(principal)`，**无 per-principal 快照缓存**（:212 注释「bindings() is called once per decision」；:245 注释长 coursing 流逐检查重读绑定）——角色读取放 bindings 回调内动态执行即满足 G2-C5 即时生效，**无需补 per-user Peer 失效面**；`invalidate`/follower 推流仅在绑定形变（未来待人项动作落地）时才需要 |
| 10 | **「不能改自己角色」系自设行为约束（本轮评审第四类意见·轻微）**：M-3 角色变更端点对 actor==target 返 400——30 §7-3/§4.5、33 G2-C5、24 §7.2 均无此条款（G2-C5 仅拍板「可分配/收回审批人角色」）；系沿 SelfDeleteError（store.ts:264→routes.ts:425）自操作护栏**精神**的类推，属设计文档之外新增的限制性行为，方向 fail-closed 且 M-3 行内已披露 | 本批保留 fail-closed 默认（防自降级/自提权误操作面）；待评审拍板去留——放开即删该判并同步 M-3 用例⑥ |

## 8. 与既有文档的关系

```
30 §7-3/§4.5（拍板原文）──本文是其 access 侧实施展开（三处改动+可见性）
33 §1.3 WS-C（G2-C1~C5）──本文任务的门禁与排期骨架
32 §2 WS-C 行──无依赖、先行、B2 与工作台共用
23（realm/accountOf/fail-closed 纪律）──principal→账号/角色唯一真值的方法论来源
34 §5 access 接线点──角色字段与谓词的下游消费者（tasks Attention 定向/TasksRealmRouter）
24 §7.2（五角色）──「审批人」的职责与操作面定义
PLUGIN-AUTHORING §1.1（T1/T2/mux 第 6 条）──路由面与动作清单纪律
26 §7-1 待拍板项 6 + 33 G2-F4──B2 共用机制的后续拍板位
```

本文档不改任何架构决策；工作台（WS-D）待人项实接时，其数据端点消费 `visibilityScopeOf` 与本批角色模型，不再改 store/mux 的角色语义。
