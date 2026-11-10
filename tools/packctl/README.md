# @eterna/packctl —— L2 领域包脚手架 CLI(T5)

承载方式 **B'**(独立 CLI,不进 agent 进程;12 号文档 §10.1)。三条命令对应
06 号 SOP 的 S2(领域包实现)与 10 号文档 §5 的 G0 lint 门禁:

```
packctl init <industry> [--root <dir>]   # 生成 packs/<industry>/ 骨架(06 号模板)
packctl lint [<path>] [--json]           # 结构 + Cordis 纪律 + 条目锚点 + golden 完整性
packctl check [<path>]                   # 静态冒烟:bundle 声明引用的文件都存在
packctl tenant-scan                      # packages/* 隔离铁律静态检查(路由面/登记册/持久化)
packctl prompt-scan                      # 提示词登记铁律静态检查(patch 键/section 使用/packs persona)
```

`<path>` 缺省为 cwd:是 pack 根(package.json 带 `dsh.bundle`)则检查它;含 `packs/`
则聚合检查全部领域包;否则向上查找。退出码:0 通过 / 1 有 error / 2 用法错误。

运行:`pnpm --filter @eterna/packctl run verify` 内的 vitest 直接调用
`runPack()`;bin 形态 `bin/packctl.mjs` 以 node ≥ 22.18 原生 TS type-stripping
执行(无构建步骤)。

## init 产物(06 号 SOP §2 模板)

```
packs/<industry>/
├── package.json          # name @<industry>/pack;dsh.bundle.patch → ./cordis.patch.yml
├── cordis.patch.yml      # 覆写 skill-filesystem(customSkillDirs 单根)/ system-prompt(personaPrefix),
│                         #   insert 领域工具行(name 先指向 ./tools/index.ts,安装期换构建产物)
├── profile.yml           # name/extends:[dsh-base]/bundles:[@eterna/governance, 本包]
├── persona.md            # 角色/语气/全局硬约束(S1 分诊中唯一允许进 prompt 的三类)
├── skills/core-workflow/SKILL.md      # ACE 条目化样例:metadata.evo.entries ↔ <!-- E: id --> 锚点
│   └── references/checklist.md
├── tools/index.ts + tools/sample-tool.ts   # 注册表 + 唯一 ID 形态样例(@<industry>/sample-tool)
├── knowledge/README.md   # 语料元数据(权威知识走 @eterna/knowledge,不落本地)
├── policies/guard-rules.yml   # 合规红线(@eterna/governance PolicyDocument 格式)
├── evals/
│   ├── golden/case-001.yaml    # 07 号文档 §3.2 字段口径
│   ├── validators/  trajectories/  # 终态/轨迹断言占位说明
│   └── threshold.yml           # 门禁阈值(与 ai-evo 同源)
└── hitl.yaml             # R0-R3 风险分档与升级触发器(@eterna/interact 消费)
```

**init 产物必须原样通过自己的 lint 与 check**(单测 `tests/init.spec.ts` 钉住,模板漂移即红)。

## lint 检查项与错误码

| 段 | 码 | 含义 |
|---|---|---|
| 结构 | PACK001/002/003 | package.json 可解析 / `dsh.bundle.patch='./cordis.patch.yml'` / 包名 `@<industry>/pack` scoped |
| 结构 | PACK004/005 | 必需文件(cordis.patch.yml、profile.yml、persona.md、hitl.yaml、evals/threshold.yml)/ 必需目录(skills、tools、knowledge、policies、evals/validators、evals/trajectories) |
| 结构 | PACK006/007 | hitl.yaml 与 threshold.yml 是 YAML 映射;threshold 含 release 门禁段 |
| 结构 | PACK010 | profile.yml:extends 含 dsh-base、bundles 含本包、name 非空 |
| skill | SKILL001/002 | frontmatter 完整(name kebab-case 且与目录一致、description 非空) |
| skill | SKILL003/004/005/006 | 锚点闭合 / entry↔锚点双向配对 / id 唯一 |
| skill | SKILL007(warning) | 条目 id 不符合 `S-<kebab>`(如 S-contract-review-001) |
| skill | SKILL010/011 | skills/ 非空;嵌套 SKILL.md 禁止(dsh-skill-filesystem 只发现根级,10 号文档 §10.3) |
| golden | GOLD001-007 | 目录非空、YAML 可解析、id/user_input 必填、id=文件名、final_state/trajectory 形态、跨文件 id 唯一 |
| Cordis | CORD001 | 旁路全局:`globalThis` / `process.env` / 裸 `setTimeout|setInterval|setImmediate`(定时器须走 ctx 自动回收;`ctx.setTimeout` 不误报;注释不误报) |
| Cordis | CORD002/003 | tools/ 每个非 barrel 模块导出 `<NAME>_SERVICE_ID` + 含 `readonly id: typeof <NAME>_SERVICE_ID` 的接口(可交换接口形态,@eterna/governance 同款约定) |
| Cordis | CORD004/005 | SERVICE_ID 在 `@<industry>/*` 命名空间下;跨模块唯一 |
| check | CHK001-004 | `dsh.bundle.patch` 声明的文件存在;patch 内全部 `./`/`../` 引用存在;profile bundles 路径式引用存在;SKILL.md 正文相对链接存在 |
| check | CHK900(warning) | 真实安装/卸载冒烟未执行(需 DSH 运行时)——blockers,不伪造 |

## prompt-scan 检查项(T2.5,ps-v2 计划书 §6)

提示词登记铁律:「全产品提示词唯一管理面」的反面强制——涉及提示词工程而未登记的
插件/包被 CI 拦截。**登记真值 = `@eterna/prompt-studio/registry` 的
`PROMPT_REGISTRY_ENTRIES`**(T1.3 三层存量登记,workspace 依赖直接 import,
不维护第二份清单;对账文档 docs/dev/ps-v2-registry-ledger.md)。三个扫描面:

| 面 | 扫描对象 | 登记判定 | finding code |
|---|---|---|---|
| patch 层 prompt 型 config 键 | profiles/ packs/ packages/ market/ 下全部 cordis.patch.yml 的 `personaPrefix`(任意上下文)、persona 插件 `prefix`、plan-mode 插件 `section`(按最近包围项/行 id 判归属) | 注册表条目 yaml 定位(file+rowId+pluginPath+configKey)精确匹配 | `prompt/unregistered-prompt-key` |
| packs persona | packs 下各领域包根的 persona.md | 任一条目 anchors 引用该文件 | `prompt/unregistered-pack-persona` |
| 运行时 section 使用 | packages/* 源码(.ts/.mjs/.js,剥注释,tests/ 豁免):`systemPrompt.section(`(memory 形态)与 `systemPrompt: true`(glue inject 声明) | 任一条目 anchors 引用该源文件 | `prompt/unregistered-section-usage` |

**白名单与豁免标注**:`PROMPT_SCAN_WHITELIST`(src/prompt.ts)按路径前缀豁免,
每条必须带 `reason`——缺标注的条目本身产出 warning `prompt/whitelist-without-reason`
(退出码同样 1):豁免决定必须可审查,不允许无声放行。仓内既知豁免两处:
packages/prompt-studio(注册表与管理面本体,anchors 含注入样例字面量)、
market/pack-bundle(build-market.mjs 生成的市场构建产物,镜像 packs/event-planning)。

已知边界(如实):行级扫描对块标量正文里恰好像 `key: value` 的行会误报(走白名单);
`const sp = ctx.systemPrompt; sp.section()` 别名形态静态不可见;运行时 home
(.eterna-home*,gitignored)不在扫描面。测试形态照抄 tenant.spec.ts
(tests/prompt.spec.ts:未登记→拦截、登记后→通过双向 + 误报防护 + 白名单/豁免标注单测)。

## 与兄弟任务的接口

- **@eterna/evals(T4)**:直接 import 本包 `loadGoldenCaseText` / `loadGoldenDir`
  (「golden 可被 evals 加载」的判定即同一份代码,不会两套解析器漂移);
  `GoldenCase` 类型导出自 `src/types.ts`。
- **@eterna/prompt-studio(T7/ps-v2)**:prompt-scan 以 workspace 依赖 import
  其 `./registry` 子路径的 `PROMPT_REGISTRY_ENTRIES` 作登记真值(注册表单一事实源,
  扫描器不留第二份清单);该子路径只依赖 node 内建,不拖插件本体导入图。
- **@eterna/interact(T3)**:hitl.yaml 的语义校验(风险档映射、on_no_answer 策略)
  属 T3;packctl 只钉存在性与 YAML 映射形态。
- **packs/event-planning(T6)**:`packctl init event-planning` 起步,替换样例内容。
- **T14 总装**:仓库根跑 `packctl lint` 自动聚合 packs/* 全部领域包。

## 已知局限 / blockers

1. **真实安装冒烟未执行**(CHK900 常态 warning):`dsh plugin` 装卸 + profile 启动 +
   卸载无残留验证需要 DSH 运行时(0.2.2-alpha.2 尚未在本仓安装为可执行 profile),
   按 14 号文档 §4 列入 blockers,静态冒烟为降级形态。
2. **bundle patch 的 `name: './tools/index.ts'`**:DSH loader 会把 patch 相对路径转
   file URL 导入;TS 源需要 host 侧 type-stripping 或构建产物(`./tools/index.js`)。
   真实发布路径(打包步骤 + plugin_manager 安装)属 T6/联调阶段。
3. **Cordis 纪律只钉形态面**:effect 是否真配逆(逆闭包语义)无法静态判定,
   由 SOP S2「卸载无残留」运行时验证与 governance 审计覆盖。
4. **profile.yml 是 06 号模板约定文件**:DSH 原生 profile 位于
   `$DSH_HOME/profiles/<name>`;把本包声明转成原生 profile 的组装步骤属工作台/联调阶段。
