# 05 - Cordis 框架论文研读笔记

> 论文:《A Programming Paradigm for Spatiotemporal Composability》(arXiv:2608.25512,Shi/Zhang/Cui,北大 & DeepSeek-AI,2026-08-26,92 页)。这是 DSH 底层插件框架 Cordis 的正式设计论文(Koishi 生产系统构建于其上,论文呈现 Cordis v4 精化语义)。全文 PDF 精读笔记,2026-11-03。关联:[[04-DSH源码设计笔记]]

## 1. 核心问题与两个正交维度

**问题**:动态组合(运行时加载/卸载/重配组件)缺乏形式化基础。现有实践依赖粗粒度替代——进程重启(时间维)、容器编排(空间维),代价是丢弃进程内状态、依赖只能表达在进程边界。佐证:VSCode Top 100 扩展中 87 个含可执行代码、卸载需重启整个 extension host;仅 7 个声明 `extensionDependencies`。

- **Temporal composability(时间可组合性)**:移除组件时,其对共享环境的全部修改可完整安全地逆转。对应 **effects**(计算对环境的修改)。
- **Spatial composability(空间可组合性)**:组件以结构化、可验证方式声明/发现/解析彼此依赖,依赖变化被响应式管理。对应 **coeffects**(环境对计算的要求)。

**关键转向**:不扩展静态类型系统,而是把 effect/coeffect 概念 **reify(具体化)为运行时机制**——由运行时动态建立静态系统静态保证的性质。

## 2. Revertible Effects(时间维)

- Effect context ∂Γ ≔ Γ × (Γ→Γ):(γ, φ),γ 是当前状态,**φ 是 accumulator(迄今所有 effect 逆变换的复合)**;初始 (γ₀, id)。
- Twisted composition:(f₁,g₁)∘(f₂,g₂) ≔ (f₁∘f₂, g₂∘g₁)——前向按执行序、逆变换按相反序累积。
- `track(f,g)` 把逆变换复合进累加器(同态性保证一串 effect 可当单个 tracked effect 推理);`recover` 应用 φ 回到起点。**Soundness invariant:φ(γ) = γ₀**。
- 升级版 effect function 𝔈Γ ≔ Γ → Γ × (Γ→Γ):**逆变换在应用点返回**,witness 只要求**逐状态可逆**(g(δ)=γ 只在被应用的那个状态上 revert)——分配类操作只需"撤销自己刚发出的那一份"。
- Effect iterator ℑΓ:每步产出 (新上下文, 逆变换, continuation)——**reified delimited continuation,直接对应 generator/yield**。组件加载 = 跑一个 iterator;**卸载 = 应用 φ(LIFO 回放)**。Thm 16:逆序回放时每个逆变换恰好拿到自己应用时产生的状态。

## 3. Reactive Coeffects(空间维)

- Coeffect context Σ ≔ (k:K) ⇀ 𝒱ₖ:带依赖类型的有限偏函数表。**关键协同:`set(k,v)` 的类型就是 𝔈Σ\***——提供依赖本身就是 effect,自动继承追踪与恢复(撤销 = 删除绑定)。
- 规格声明 𝔇Σ ≔ Set(K):组件声明所需 key 集合 d;满足谓词 σ ⊨ d(可判定)。
- **变化分类(reactivity 核心)**:notify_d(σ,σ′) 把每次 context 变迁分为 **activating**(→触发执行组件 effects)/ **deactivating**(→应用 accumulator 恢复)/ **neutral**。因一切变更过 effect 函数,满足性变化在每个 effect 边界可检测。
- **Isolation**:同一 key 在不同 realm 解析为不同值(多租户/测试/沙箱),两层映射 k→ρ(k)→σ(ρ(k)),isolate 是派生新 context、无副作用。
- **Interception**:每个 key 带元数据 monoid,get 时 provider 收到 组件声明元数据 ⊕ context 携带元数据(外层可覆盖)——可在不改任何一方代码下实施策略(如只读 DB 权限),不触发 reload。

## 4. Context Paradigm 与观测等价

- 统一上下文 Γ∞ ≔ μΓ. Γ × (Γ→Γ) × Σ:自相似递归类型,同时携带子级上下文、accumulator、coeffect 表。**一切跨组件共享状态都编码为依赖**——任何组件与环境的交互都经过这一个实体。
- **Observational equivalence(≃)**:物理状态不可能逐位恢复,一切等式读作"没有观察者能区分"——观察者在 key 上能做的是该 key 的操作集 𝒜ₖ。
- **互不干扰(independence)**:Thm 43——独立 effects 按任意置换应用逆变换都回到 γ₀(乱序回滚的理论保证)。独立性分解到 key 层:不同 key 天然独立;同一 key 要求交换性,由 **witnessed coeffect** 在 key 定义处一次性提供(注册表+唯一 ID 是黄金形态;有序 middleware 链、POSIX 式单调 fd 分配不可交换)。

## 5. 组件模型与动态组合演算

- **Component** ℭΓ ≔ (inject: 声明依赖 d) × (provide: 可提供 key p) × (apply: witnessed effect iterator e)——**inject/provide/apply 三元组**。
- **Fiber**:组件的一次实例化,带父指针(树)、自己的表、retirement 标志、生命周期 θ ∈ {Inactive, Reloading, Active, Unloading},**ω = committed view(d 中每 key → 提供它的 fiber 名)**。coeffect context 是派生的(Active fiber 表之并);单源纪律保证每 key 至多一个 provider。
- 九条编排/生命周期规则;**L-Unload 是全演算唯一应用 accumulator 的规则**,guard:有已安装 fiber 的 committed view 指向 n 时不得卸载。驱动逻辑统一:**target view 与 committed view 不一致即触发迁移**。
- 元理论(单组件性质扩到系统):Preservation;**Recovery exactness(Thm 68)**:运行中逆变换只抽走自己的贡献(穿插任意他 fiber 步骤后);**Ordering(Thm 70)**:provider 在消费者整个 episode 期间存活;**Resolution coherence(Thm 71)**:激活中目标漂移要么完成于原解析、要么整段回滚;**Progress(Thm 73)**:依赖无环 + iterator 有界 ⇒ 无死锁终止;**Confluence(Thm 80)**:**动态历史不留痕——任意编排序列静止后的状态 ≃ 按依赖序一次性静态装配的最终配置**(配置 reconciliation 正确性直接引用此定理)。

## 6. Cordis 实现

- **Effect tracking**:唯一变异原语 **`ctx.effect(callback)`**:驱动 generator/异步迭代器,每步把产出的 inverse 前插进复合 dispose(LIFO);前插进父 context 的 dispose(父卸载级联子卸载)。**runtime 不验证"逆真的可逆"——witness 是组件作者的义务**。
- **Coeffect 操作**:三个 symbol 槽 `@@store`/`@@isolate`/`@@intercept`;`ctx.set(key,value)` = 一次 ctx.effect(装值 + 返回删除闭包,两端都 notify);notify(Alg 3)遍历 live fiber 触发 refresh。
- **生命周期(Alg 5 惯性状态机)**:refresh 重算 fiber.target(解析 provider 的 **uid 而非值**);reload 先 commit 视图再执行(迭代级守卫);unload **先等所有依赖方到达 Inactive,再 LIFO dispose,再视 target 链入 reload**。provider 原地覆写自己的绑定**不**触发依赖重载——想传播需先撤再装。
- **Context 访问**:TS Proxy get trap 沿 fiber 链向上;未声明访问报 INACTIVE_ACCESS/UNDECLARED_ACCESS——**inject 声明即能力请求,proxy 即能力中介(capability-based security)**,声明静态可知、加载时可审查。
- **Loader**:声明式 entry(id/url/isolate/intercept/config/disabled)构成配置树;**Reconciliation 按 field 分派最小扰动操作**(id/url 变→重建;isolate→迁移 realm;config→diff、material change 才 reload);正确性引用 Thm 80(静止态只是最终配置的函数,路径无关)。
- **HMR(@cordisjs/hmr)**:三阶段——固定点分类模块 accepted/declined→找 stale entries→**事务性 reload**(任一导入失败则恢复缓存重建全部 stale entry,永不处于半重载状态)。与 webpack/Vite 不同:**无需开发者标注 accept 边界**,fiber 已界定组件全部 effects/coeffects。

## 7. 相关工作定位(摘要)

- vs monadic effect 库(ZIO/Effect-TS):不要求 monadic embedding,是普通宿主代码之上的 overlay;requirement 随 provider 出入重解析。
- vs algebraic effects(Effekt):目的不同——Cordis 为追踪与**回撤**、运行时纪律、context 一等。
- vs OSGi/手写清理(useEffect/OSGi deactivate):逆是"未强制的义务"→ Cordis 中只有原子 effect 需手写逆,**完整回收是系统不变量而非开发者自律**;useEffect 结构最接近但不可组合。
- vs DI(Spring/Guice):初始化接线 → Cordis 响应式。
- vs FRP/signals:值级反应式 → Cordis 是组件级反应式,互补。

## 8. 案例:Koishi 生产验证

四年、4000+ 社区插件:server bot 与 web console 是两个独立 Cordis 应用;控制台禁用插件即地回收;HMR 保存即重应用且连接/缓存保留;adapter→database→功能插件的真实依赖拓扑,运行时换存储后端只重激活受影响者、依赖缺失的插件静默待命。作者自陈局限:单一生态+单一宿主语言、观察性论证、无定量开销评估。

## 9. 对行业 agent 插件开发的工程启示(重点)

**Effect 设计(可回收)**:
- 所有可观察变更走 context 原语(ctx.effect/ctx.set),**每个原子 effect 返回逆闭包**;组合既有 effects 不需写新逆。
- 区分 acquisition 与 emission:**发射类动作(已发送消息、已写外部存储、已通知用户)不可逆**——要么 withhold 到状态确定持久,要么写补偿(saga 式;补偿破坏元理论,需对更粗等价重证)。
- 组件内部状态**默认不跨 reload 存活**——要持久就放进更长命的依赖(coeffect/service)。

**Coeffect 设计(依赖声明)**:
- inject 什么就只用什么;声明集是编排者可在加载时审查的能力清单;用 intercept 元数据实施租户级权限(如只读 DB)而无需改任何一方代码。
- **provide 的 key 要发布可交换接口**:注册表+唯一 ID 是黄金形态;避免有序链、避免把单调生成的地址/序号作为可比较 outcome 发布。这是 key 提供方的义务。

**反模式清单**:
- **旁路共享位置**:隐藏全局变量、模块级单例、上下文不携带的计数器/句柄池——不被 reify 为 key 就在演算与定理之外(最核心的一条)。
- activate/deactivate 分离两处写(VSCode 式)——正确形态是 effect 与其逆在同一个回调/generator 里配对。
- 读取未声明的控制字段;声明并提供同一 key 的自环(≺ 有环 ⇒ 永久 inactive);把双向交互写成两组件互依(应分解出集成组件)。
- 跨进程暴露同步契约;原地覆写自己提供的绑定(依赖不重载)。
- **依赖版本**:目前纯名义链接(key 同名即满足)+ npm peer deps——发布接口时应命名空间化(作用域包名)并在 peer range 上保守。

## 10. 局限(论文明示 + 推论)

1. runtime 不验证 witness(逆可逆/操作可交换都是提供方义务)——Thm 68/70 以作者正确性为前提。
2. 系统边界之外不可逆(emission 只能 withhold/补偿)。
3. Confluence 只谈状态不谈轨迹;循环依赖只能永久 inactive(消解靠分解,组件数平方增长)。
4. 依赖链接纯名义、无版本/结构兼容检查——namespacing/peer deps/结构兼容的统一模型是公开问题。
5. 演算内单 realm、provision 不交;多版本同包共存受包管理器单版本解析阻碍。

---

**一句话总结**:Cordis 把"插件装卸不留垃圾、依赖变化自动重解析、配置改动最小扰动、热更新永不半态"从工程惯例升级成了有元理论保证的系统不变量。给我们的直接收益:**行业插件只要遵守"effect 配逆 + coeffect 全声明 + provide 可交换接口"三条纪律,就能在 DSH 上获得可热更新、可审计、可安全回收的领域包运行时——这正是"快速接入行业"想要的底层性质。**
