# 个人插件全链:T6 装载器 + 自研安装工具 + 转内置真装载(2026-11-18)

> 背景(session-77e8fdd9 用户报告):创造模式(cordis 预设)开发的插件「无法马上生效、不在我的插件出现、只能重启服务/容器」。实证三个断点:①`tool-plugin-manager`/`tool-plugin-market` 被裁(2026-11-09 三方准入裁定)→ 上游 install→热应用闭环断头;②个人层纯记账(`packages/access/src/user-plugins.ts` 原头注「一期边界」:mount 面留后续任务);③转内置止步于拷贝(`plugins-promoted/` 无任何装载器读取)。本批闭合全链:**写完即装、装完即用、启停即生效,全程零重启**。
>
> 用户拍板(2026-11-18):全链 P0→P3;**不回加上游工具行,自研安装工具**(上游 `plugin_manager` 的 `install_bundle` 依赖 profile pnpm+patch 面且全局生效,与多租户双层空间冲突;自研面可钳目录、按归属过滤、免 pnpm)。

## 1. 架构

```
创造模式会话 ──写──▶ workspaces/<账号>/plugins/<dir>/ ──install_personal_plugin──┐
设置弹窗「我的插件」(install/enable/disable/remove/scan) ──────────────────────┤
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

- **受限 ctx**:插件拿到的合成对象只有 `tools.register` 包装面——自动 ①工具名命名空间 `user_<账号>_<原名>`(共享层账号段取 plugin_id 中段);②`when` 谓词归属可见性(个人=仅 owner 会话,`agent.session.id ?? agent.id` 双取径,拿不到会话 id/谓词抛错=不可见 fail-closed;共享=恒可见);③disposer 收管,unmount 全量回收、名字释放。
- **重装=原子替换**:先 unmount 旧挂载,`import(pathToFileURL(entry)?t=<ts>)` 破 ESM 缓存。
- **tools 未就绪**:apply 时点可能未就绪(companion wrap 同款时序),装载器 tools 面惰性取用;bootScan 跳过,由首个 `tools/pre-execute`(companion 身份监听内 `ensureBootScan()`)补扫。
- **失败隔离**:单插件装载失败只记 `stateOf` 错误+审计,绝不炸 boot。

## 3. 面

| 面 | 落点 | 即时语义 |
|---|---|---|
| Agent 工具 `install_personal_plugin` | `packages/access/src/install-tool.ts`;apply 直注(glue knowledge/memory 先例),失败降级审计 | 装完返回装载的工具名清单;免审批(2026-11-10 隔离计划裁定:个人层安装/启停免 admin 审批);无主会话拒绝;目录钳本人 plugins 根 |
| 路由 `/api/my-plugins/*` | `user-plugins.ts`(install/enable/disable/remove/scan/shared/*;installPersonalPlugin 助手与工具共用同一份逻辑) | enable=mount、disable/remove=unmount、转内置=共享行+全局 mount |
| `scan` | 列 `plugins/` 根下未登记目录 | 创造模式产物一键导入(UI「扫描 plugins 目录」按钮) |
| UI「我的插件」 | `client/my-plugins-section.tsx`:装载徽标(`data-eterna-plugin-mount`)+扫描导入 | 启停即生效(hint 文案已改) |
| UI「恒灵插件」共享分区 | `client/plugins-manager.tsx` `SharedSection`(`data-eterna-shared-plugins`) | admin 启停共享工具,即时生效(与上方 @eterna 插件的重启语义显式区分) |

## 4. 边界(诚实声明)

1. 个人/共享层仅承载**工具型**插件;UI 型走管理员 bundle 安装(P3b,本批未做——需容器 pnpm 预检,`installBundle('link:')` 热应用;上游 install_bundle 语义已考证:本地目录=link 进 profile + `dsh.profile.bundles` + hmr reconcileProfile,`application: applied`);PTC/TS 运行时产物不在装载范围。
2. 受限 ctx 非沙箱( tenant-realm.md 既定口径):防线=契约校验+归属可见性+审计+转内置人审。
3. 装载器在 access 插件 apply 内创建(偏离隔离计划「独立 tenant-plugins 包」的命名,理由:access 已 inject tools+持有 store/tenantRoot,免新增装载行/FOROM 漂移;原计划的挂点名即本文件)。
4. `shared_plugins` 表:拷贝制(与个人行解耦,原作者删除不影响共享存续——隔离计划 §T7-B 既定)。

## 5. 验证(2026-11-18 实测)

- 单测:`pnpm --filter @eterna/access run verify` 全绿——**291 测试**(原 278 + 装载器 9 + 路由即时语义 4):契约 fail-closed 矩阵、命名空间/when 双取径+fail-closed、unmount 回收与名字释放、撞名拒载、apply 抛错零残留、bootScan 失败隔离;install 即刻 mount、disable/enable 即时 unmount/mount、scan、shared admin 矩阵、promote-direct 全局装载。
- 门禁:G1-1/G1-2 与容器 E2E 见本文末(待跑记录,跑完回填)。

## 6. E2E / 门禁记录(回填区)

- G1-1(verify-eterna-web):待跑
- G1-2(verify-eterna-super):待跑
- packctl tenant-scan / form-check:待跑
- 容器 E2E p6(个人插件安装→会话真调工具→转内置→第二账号→disable):待跑
