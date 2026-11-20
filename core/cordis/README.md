# @core/cordis — 自持 cordis 内核

本包是 agent-basis 的**内核区唯一成员**:cordis 插件容器(effect/coeffect 运行时、fiber 生命周期、事件总线、注册表)。仓库的"一切皆插件"由它承载——agent loop、LLM、工具注册表等全部是挂在本内核上的普通插件。

## NOTICE(vendor 出处与许可)

- **来源**:`@deepseek-ai/cordis` **4.1.0**(上游 tag `dsh-v0.2.2-rc.5` = `9c2670d3bce5275e0d1610272958121af87787bb`,目录 `vendor/cordis`)
- **上游仓库**:https://github.com/deepseek-ai/deepseek-harness,作者 Shigma(Shigma <shigma10826@gmail.com>)与 DeepSeek-AI
- **许可**:MIT(保留原版权声明,见 `LICENSE`;本仓库发行物同样以 MIT 对外)
- **vendor 日期**:2026-11-20(上游 4.1.0 发布提交 `60d811de43`,2026-11-04)

## 相对上游的机械化改造(全部为可机械验证的等价变换)

上游 `src/` 含 Node 原生 type-stripping 不支持的语法(参数属性 / `const enum` / 值承载 namespace)。为延续本仓库"无构建、源码即出口"的惯例,做了以下**等价改造**;除此之外逐字节保留上游源码:

| # | 位置 | 上游形态 | 改造形态 |
|---|---|---|---|
| 1 | `fiber.ts` `Fiber` 构造器 | `public parent / public inject / public runtime` 参数属性 | 显式字段声明 + 构造体首行赋值 |
| 2 | `fiber.ts` `FiberState` | `export const enum`(数值) | `const` 对象 + 同名数值 union 类型 |
| 3 | `fiber.ts` `CordisError` | `public code` 参数属性 + `namespace CordisError.Code` | `code` 显式字段;`Code` 表改为类静态字段;`CordisErrorCode` 类型别名 |
| 4 | `events.ts` `EventsService` 构造器 | `private ctx` 参数属性 | 显式字段 + 首行赋值 |
| 5 | `logger.ts` `LoggerLevel` | `export const enum` | `const` 对象 + 同名 union 类型 |
| 6 | `logger.ts` `Logger` 构造器 | `private service` 参数属性 | 显式字段 + 首行赋值 |
| 7 | `reflect.ts` `ReflectService` 构造器 | `public ctx` 参数属性 | 显式字段 + 首行赋值 |
| 8 | `registry.ts` `RegistryService` 构造器 | `public ctx` 参数属性 | 显式字段 + 首行赋值 |
| 9 | `registry.ts` `namespace Inject { resolve }` | 值承载 namespace(与 `Inject` 类型别名/装饰器函数三重合并) | `resolveInject()` 模块函数 + `InjectStatic` 类型化引用;`Inject.resolve` 名称退役 |
| 10 | `service.ts` `Service` 构造器 | `protected ctx` 参数属性 | `protected ctx!: Context` 显式字段(赋值仍走 `self.ctx = ctx`) |
| 11 | 5 处 `declare module './context.ts'` | 相对路径自增强 | 改为 `declare module '@core/cordis'` 包名自增强(包内解析靠 tsconfig `paths` 自映射;产物 d.ts 增强可被消费方合并) |
| 12 | 5 处类型注补 | — | `state: FiberState` 字段注解、`resolveConfig` 结果窄化 cast、`task` catch cast、`getTraceable` hasOwn cast、`_updateState` 组合 cast(语义等价,仅为 tsc 空值检查) |

type-only namespace(`Plugin` / `Property` / `LoggerService.Intercept`)经实测原生可擦除,**原样保留**。

### 4.1.0 复核(2026-11-20)

逐文件 diff `4.0.6-alpha.1 → 4.1.0` 后,上表 12 项仍是全集:新版没有引入新的不可擦除语法(无新参数属性 / `const enum` / 值 namespace),因此**未新增变换项**。落点变化:

- `registry.ts` / `service.ts` / `index.ts` 与 4.0.6-alpha.1 逐字节相同,沿用上一版已改造文件;
- 变更集中在 `context.ts` / `events.ts` / `fiber.ts` / `logger.ts` / `reflect.ts` / `utils.ts`,重跑变换 1–12;
- 变换 7 仍落在 `reflect.ts` `ReflectService` 构造器;变换 11 仍为 5 处 `declare module '@core/cordis'`。

### 4.0.6-alpha.1 → 4.1.0 上游语义变更清单(供消费方适配,非本包改造)

| 面 | 变更 |
|---|---|
| `LoggerLevel` | **数值反转**:`WARN = 1` / `INFO = 2`(4.0.6 为 `INFO = 1` / `WARN = 2`);按数值比较级别的 exporter 必须复核 |
| `Events` 接口 | `internal/config(fiber, next)`(原 `(this: Fiber, config, next)`);新增 `internal/commit(fiber, originalConfig)`;`internal/update(config, next)` 去掉 `noSave` 且返回 `Awaitable<void>`;新增 symbol 索引签名;`internal/dispatch` 的名称类型放宽为 `string \| symbol` |
| `EventsService` | `register` / `unregister` 改为私有;`once` 接受 symbol;`parallel` 的 dispatch 模式上报改为 `'parallel'`(原误报 `'emit'`) |
| `Fiber` | `config` 改为 raw input(原为 validated);`rawConfig` 读写同一字段,`effectiveConfig` 单独存放(激活/成功 `update` 才发布);`store` 退役为 `committed` + `provisions`;`update()` 返回 `Awaitable<void>`;FAILED fiber 不再因依赖变化自动恢复,须显式 `update()`;卸载等待 dependents 完成后再撤自身 effects |
| `Impl`(reflect) | `fiber` 字段改为 `ctx`;新增 `uid` / `dependents` / `release` / `isolate`;`provide` disposer 等待 dependents;`notify()` 返回 `void`(原返回 fiber 列表) |
| `utils` | 新增 `symbols.caller`;`createShadow` / `createTraceable` 区分 defSite(服务解析)与 useSite(intercept / isolate / effects);`createCallable` 走 `Reflect.apply` |
| `context.ts` | `baseUrl?: string \| undefined`(对 `exactOptionalPropertyTypes` 消费方友好) |

`FiberState` 数值与导出名不变;`CordisError` 码表不变。

## 本包纪律(内核区规则)

1. `src/` 与上游逐字节可比(diff 应只出现上表所列变换);**任何语义修改必须在 README 追加记录并说明理由**。
2. 本包不做 oxlint 风格门禁(vendor 代码保持上游风格);`verify` = `tsc --noEmit` + `vitest`,仓库级 `oxlint .` 通过 `.oxlintrc.json` 的 `ignorePatterns` 跳过 `src/`(tests 仍受检)。
3. 升级内核 = 换上游版本重跑本表变换 + 重跑 smoke 测试,不是手改语义。

## 冒烟测试

`tests/smoke.spec.ts` 锁内核最小能力面:Context 代理 + provide/inject 依赖解析、effect 配逆(disposer LIFO)、事件 on/emit/waterfall、插件装卸与逆闭包回卷,以及 4.1.0 语义(`LoggerLevel` 数值序、`rawConfig` / `effectiveConfig` 分工)。
