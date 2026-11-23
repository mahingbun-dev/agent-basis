# 个人插件全链:T6 装载器 + 自研安装工具 + 转内置真装载(2026-11-18)

> 背景(session-77e8fdd9 用户报告):创造模式(cordis 预设)开发的插件「无法马上生效、不在我的插件出现、只能重启服务/容器」。实证三个断点:①`tool-plugin-manager`/`tool-plugin-market` 被裁(2026-11-09 三方准入裁定)→ 上游 install→热应用闭环断头;②个人层纯记账(`packages/access/src/user-plugins.ts` 原头注「一期边界」:mount 面留后续任务);③转内置止步于拷贝(`plugins-promoted/` 无任何装载器读取)。本批闭合全链:**写完即装、装完即用、启停即生效,全程零重启**。
>
> 用户拍板(2026-11-18):全链 P0→P3;**不回加上游工具行,自研安装工具**(上游 `plugin_manager` 的 `install_bundle` 依赖 profile pnpm+patch 面且全局生效,与多租户双层空间冲突;自研面可钳目录、按归属过滤、免 pnpm)。

## 1. 架构

```
创造模式会话 ──写──▶ workspaces/<账号>/plugins/<dir>/ ──install_personal_plugin──┐
侧栏「插件」页 ›「我的插件」标签(install/enable/disable/remove/scan) ────────────┤
                                                                                ▼
                                              T6 装载器(packages/access/src/tenant-plugins.ts)
                              装载契约校验 → 动态 import(破 ESM 缓存) → 受限 ctx.apply
                              → ctx.tools.register(def, {when}) [命名空间+归属可见性]
                                                                                │
转内置(个人申请→admin 审批/直转) ──▶ plugins-promoted/ ──recordSharedPlugin+mount──┘
                                              共享行 = 全员可见(when 缺省)
```

- 装载机制 = 上游 `tools.register` 可后于 apply 调用、disposer 注销即从下一步目录消失(core/tools ScopedLayers;先例 `packages/tasks/src/plugin.ts:696-708` 的 `when` 谓词 + `ctx.effect` 收管)。**不改 patch 行、不进 profile、不 pnpm** → FORM001 零扰动、无 entrypoint/模板变更。
- 持久化 = users.db 账本(`user_plugins` 个人行 / `shared_plugins` 共享行);重启后 `bootScan()` 按 enabled 行重挂——不依赖 hmr/patch。

## 2. 装载契约(fail-closed)

| 校验 | 拒载文案要点 |
|---|---|
| `package.json` 存在且可解析 | 缺少/解析失败 |
| `main` 指向 `.js`/`.mjs` 且文件存在(CJS/ESM 皆可;TS 拒) | 「main 必须指向纯 JS 入口」 |
| 入口导出 `apply(ctx)`(命名或 default 对象) | 「入口缺少 apply(ctx) 导出」 |
| `inject` 缺省或 `['tools']` | 「inject 越权」 |
| manifest 无 `dsh.client` / `dsh.bundle.patch` | 指引管理员 bundle 安装(UI/bundle 非个人层承载面) |
| 工具名 `^[\w][\w.-]{0,63}$` + 全局不撞名(装载后名) | 「工具名非法 / 撞名」 |

- **受限 ctx**:插件拿到的合成对象只有 `tools.register` 包装面——自动 ①工具名命名空间分层——个人 `user_<账号>_<原名>`、共享 `shared_<原名>`(同 pluginId 双副本不撞名);②`when` 谓词归属可见性(个人=仅 owner 会话,`agent.session.id ?? agent.id` 双取径,拿不到会话 id/谓词抛错=不可见 fail-closed;共享=恒可见);③disposer 收管,unmount 全量回收、名字释放。
- **重装=原子替换**:先 unmount 旧挂载,`import(pathToFileURL(entry)?t=<ts>)` 破 ESM 缓存。
- **tools 未就绪**:apply 时点可能未就绪(companion wrap 同款时序),装载器 tools 面惰性取用;bootScan 跳过,由首个 `tools/pre-execute`(companion 身份监听内 `ensureBootScan()`)补扫。
- **失败隔离**:单插件装载失败只记 `stateOf` 错误+审计,绝不炸 boot。

## 3. 面

| 面 | 落点 | 即时语义 |
|---|---|---|
| Agent 工具 `install_personal_plugin` | `packages/access/src/install-tool.ts`;apply 直注(glue knowledge/memory 先例),失败降级审计 | 装完返回装载的工具名清单;免审批(2026-11-10 隔离计划裁定:个人层安装/启停免 admin 审批);无主会话拒绝;目录钳本人 plugins 根 |
| 路由 `/api/my-plugins/*` | `user-plugins.ts`(install/enable/disable/remove/scan/shared/*;installPersonalPlugin 助手与工具共用同一份逻辑) | enable=mount、disable/remove=unmount、转内置=共享行+全局 mount |
| `scan` | 列 `plugins/` 根下未登记目录 | 创造模式产物一键导入(UI「扫描 plugins 目录」按钮) |
| UI「我的插件」 | `client/my-plugins-section.tsx`:装载徽标(`data-eterna-plugin-mount`)+扫描导入 | 启停即生效(hint 文案已改);页签全员可操作(个人层不经 admin) |
| UI「恒灵插件」共享分区 | `client/plugins-manager.tsx` `SharedSection`(`data-eterna-shared-plugins`) | admin 启停共享工具,即时生效(与上方 @eterna 插件的重启语义显式区分);非 admin 只读(T6.2) |

## 4. 边界(诚实声明)

1. 个人/共享层仅承载**工具型**插件;UI 型走管理员 bundle 安装(P3b,本批未做——需容器 pnpm 预检,`installBundle('link:')` 热应用;上游 install_bundle 语义已考证:本地目录=link 进 profile + `dsh.profile.bundles` + hmr reconcileProfile,`application: applied`);PTC/TS 运行时产物不在装载范围。
2. 受限 ctx 非沙箱( tenant-realm.md 既定口径):防线=契约校验+归属可见性+审计+转内置人审。
3. 装载器在 access 插件 apply 内创建(偏离隔离计划「独立 tenant-plugins 包」的命名,理由:access 已 inject tools+持有 store/tenantRoot,免新增装载行/FOROM 漂移;原计划的挂点名即本文件)。
4. `shared_plugins` 表:拷贝制(与个人行解耦,原作者删除不影响共享存续——隔离计划 §T7-B 既定)。
5. 上游四个插件页签(已安装/发现/恒灵插件/全局蒸馏)对**所有角色可见**(T6.2,2026-11-24):服务端按方法名放行读、拒写(`packages/access/src/mux.ts` 的 `MARKET_MEMBER_METHODS` / `MARKET_ADMIN_METHODS`),前端把写控件置灰并拦点击(`client/plugin-page-guard.ts`)。「我的插件」是我方自绘页签,不受该门影响,全员可操作。

## 5. 验证(2026-11-18 实测)

- 单测:`pnpm --filter @eterna/access run verify` 全绿——**298 测试**(原 278 + 装载器 10 + 路由即时语义 4 + 客户端信封 5 + 双层共存 1):契约 fail-closed 矩阵、命名空间/when 双取径+fail-closed、unmount 回收与名字释放、撞名拒载、apply 抛错零残留、bootScan 失败隔离;install 即刻 mount、disable/enable 即时 unmount/mount、scan、shared admin 矩阵、promote-direct 全局装载。
- **G1-1**(verify-eterna-web)PASS:206 host entries / 3 presets / cut rows inactive / kept rows active——装载器+工具接线后真 boot 零 failed。
- **G1-2**(verify-eterna-super)PASS:220 host entries / super 挂载面 21 行 active。
- **form-check** 0 error(FORM001 零扰动——本批不改任何 patch 行;唯一 WARNING=40 号 §9 Q1 在案的 base 形态漂移,存量)。
- **brand verify** 绿(技能 fork 文档面)。
- 存量断点(非本批,如实登记):①仓根 `pnpm run verify` 被并行会话 tasks 包未提交 WIP lint 挡住(`src/sources/webchat.ts` member-delimiter 等,归属并行任务);②`packctl tenant-scan` 2 findings 在 `glue/src/plugins/channels-plugin.ts:71,164`(T2 路由逃逸,来自 a412357 渠道绑定提交,本批零涉 glue)——均按「不得静默放红」在此显式登记,归属对应任务收口。

## 6. E2E / 门禁记录(2026-11-18 实测)

### 6.1 容器 E2E(`scripts/team-platform-gates/p6-e2e-personal-mount.mjs`)

独立测试容器 `eterna-tp-t6`(3213 端口 + 独立卷,零生产接触),镜像由部署线 worktree(`d8ba0e7`)+ 本批 access/brand 检出构建。**全链 PASS**(`acceptance/team-platform/p6/evidence/personal-mount/record.json`,exit=0):

| 检查 | 结果 |
|---|---|
| `install`(路由)→ 即刻装载 | `mount.ok=true`,`tools=['user_Mr_Ma_greet']`(账号 `Mr.Ma` 命名空间化为 `Mr_Ma`) |
| `list` 下发装载态 | `mounted=true`,同一工具名 |
| `scan` 发现未登记目录 | `items=['stray']` |
| `disable` → `enable` 即时卸载/重挂 | 两步均 `true` |
| `promote-direct` 转内置 = 共享行 + 全局装载 | `mount.ok=true`,共享层工具名 `shared_greet` |
| `shared/list` 装载态 | `mounted=true`,`enabled=true`,`tools=['shared_greet']` |
| 转内置后个人行退场 | 个人行 `enabled=false`(共享版接管) |
| `shared/disable` 即时卸载 | `becameDisabled=true`,`becameUnmounted=true` |
| 容器重启后 `bootScan` | 个人行 `mounted=false`(已停用),共享 `sharedStaysUnmounted=true` |
| 重启后 `shared/enable` | `true`(账本为真源,不依赖 hmr/patch) |

零模型调用:`mount.ok` 即宿主 `ctx.tools.register` 真实接受的进程内证据。

### 6.2 GUI 深浅两主题(`scripts/team-platform-gates/p6-gui-shots.mjs`)

入口 = **侧栏「插件」→ 页签**(2026-11-11 起「我的插件」自设置弹窗迁入 `plugins.tab`;旧脚本点设置齿轮只会截到首页)。脚本同时做真实点击链路断言——**纯截图不断言会漏掉客户端信封缺陷**。PASS(`badRpc=[]` 两主题):

- `my-plugins-{light,dark}.png`:个人行 `user:Mr.Ma:hello` + 装载徽标 + 扫描导入 + 手填安装
- `my-plugins-{light,dark}-mounted.png`:点「启用」后徽标 → `mounted`(`已装载 1 个工具`),证明浏览器 RPC 真通
- `shared-plugins-{light,dark}.png`:共享工具分区(`shared_greet`,`已装载 1 个工具`,admin 开关)
- `manage-{light,dark}.png`:整页上下文(恒灵插件页签)

### 6.3 本批修复的两个实证缺陷(浏览器路径首次被真验证)

E2E 手写 RPC 信封直打 HTTP,恰好绕过了客户端缺陷——两个分区在**真实浏览器里从未加载过数据**:

1. **客户端 RPC 信封缺失**:`my-plugins-section.tsx`/`plugins-manager.tsx` 的私有 `postJson` 发裸 body,服务端 `unpack()`(tenant.ts:138-146)判 `400 invalid client-request message` → 分区永不渲染、静默空态。这正是用户「在我的插件里发现不了、管理不了」的直接成因之一。修复=抽 `client/rpc.ts` 单一信封构造(`postRpc`),新增 `tests/client-rpc.spec.ts` 5 例锁信封形状。
2. **个人/共享双层挂载互相拆台**:装载器原按 `pluginId` 单键控,而个人行与共享行共享同一 `pluginId`——停用个人行会把共享装载一并卸掉(GUI 实证:`已启用(未装载)`)。修复=①挂载键改 `层:pluginId`;②共享层命名空间独立 `shared_<原名>`(避免同插件双副本撞名);③转内置成功后个人副本自动退场(共享版接管),共享装载失败则保留个人可用。新增「双层共存」回归用例。

单测:`pnpm --filter @eterna/access run verify` **298 测试全绿**(原 291 + 客户端信封 5 + 双层共存 1 + 转内置退场断言)。

### 6.4 门禁(2026-11-18 复跑)

- **G1-1** PASS:206 host entries / 3 presets / cut rows inactive / kept rows active。
- **G1-2** PASS:220 host entries / super 挂载面 21 行 active。
- **packctl form-check** 0 error(唯一 WARNING = 40 号 §9 Q1 在案的 base 形态漂移,存量)。
- **packctl tenant-scan** 2 findings:glue `channels-plugin.ts:71,164`(T2 路由逃逸,a412357 渠道绑定提交引入,本批零涉 glue)——存量红,归属对应任务收口。
