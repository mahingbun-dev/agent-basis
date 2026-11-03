# agent-basis —— 领域 Agent 基座

在 DeepSeek Harness(DSH)之上构建的 **L1 基座插件 + L2 领域包** pnpm monorepo。目标:把"组织向"能力(治理 / 记忆 / 人机交互 / 评测 / 通道 / 自进化)做成可跨行业复用的 Cordis 插件,首个领域包为活动策划(@event/pack)。

## 设计文档(单一事实源)

| 文档 | 内容 |
|---|---|
| [08-基座插件体系与总体架构](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/08-基座插件体系与总体架构.md) | L0/L1/L2 分层、插件清单、Cordis 三纪律 |
| [09-RSI自进化机制设计](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/09-RSI自进化机制设计.md) | 反思-策展-应用闭环、G0/G1/G2 流水线 |
| [10-dsh-evolve详细设计](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/10-dsh-evolve详细设计.md) | SKILL.md 条目化、五种 delta、ledger |
| [11-知识插件-dsh-knowledge可插拔设计](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/11-知识插件-dsh-knowledge可插拔设计.md) | wiki-local FTS5、provenance、双路检索 |
| [12-功能点清单与承载方式决策](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/12-功能点清单与承载方式决策.md) | 每个功能点落在哪个包 |
| [13-活动策划领域包v0草案](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/13-活动策划领域包v0草案.md) | @event/pack 骨架与 golden set |
| [14-开发总排期与工作流执行](/Users/sunny/Library/CloudStorage/SynologyDrive-Obsidian/技术开发/领域Agent基座/14-开发总排期与工作流执行.md) | 14 个任务的分解、验收门、韧性规则 |

进度看板:[PROGRESS.md](./PROGRESS.md)。总装完成后产出 DEV-REPORT.md 并回写 Obsidian 15 号文档(T14)。

## 布局

```
agent-basis/
├── packages/          # L1 基座插件(governance / memory / interact / knowledge / observe / evolve / channels / cache-guard / extra …)
├── tools/             # CLI 与工具(evals、packctl …)+ basis-smoke(约定载体包)
├── pnpm-workspace.yaml# packages/* + tools/*;catalog: 统一依赖版本
├── tsconfig.base.json # strict 全开(见下),各包 extends
└── .oxlintrc.json     # 取经 dsh-repo:手选严格规则 + typeAware(tsgolint 桥)+ @stylistic/sonarjs
```

DSH 官方源码(只读参考)在相邻的 `../dsh-repo/`,API 形态以其 `packages/*/README.md` 与 `docs/` 为准。

## 每包约定(新增包照抄 tools/basis-smoke)

1. **package.json**:`"exports": { ".": "./src/index.ts" }`(源码直出,跨包 workspace 依赖无需构建即获得类型与运行时);devDependencies 用 `catalog:` 引用 typescript / vitest / @types/node。
2. **scripts**:`"verify": "oxlint --config ../../.oxlintrc.json . && tsc --noEmit && vitest run"` —— 这是每个任务的验收门,根 `pnpm run verify` 会递归执行全部包的 verify。
3. **tsconfig.json**:`{ "extends": "../../tsconfig.base.json", "include": ["src", "tests"] }`;基础 strict 含 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `noImplicitOverride` / `noUnusedLocals` / `verbatimModuleSyntax`。
4. **vitest.config.ts**:node 环境,`include: ['tests/**/*.spec.ts']`;测试用相对路径 `../src/index.ts` 导入被测源码(pnpm 严格隔离下不做自名导入)。
5. **测试必须真实**:真实断言、真实运行;测试文件里 non-null 断言等已按 dsh-repo 惯例放宽(见 .oxlintrc.json tests override),src 保持全严。

## 验证

```bash
pnpm install          # 首次
pnpm run verify       # = pnpm -r --if-present run verify,所有包 lint+typecheck+单测
pnpm --filter <包名> run verify   # 单包验收门
```

## Cordis 三纪律(所有包强制)

1. **effect 配逆闭包**:凡有副作用,必须返回可执行的 undo;
2. **coeffect 全声明**:不碰旁路全局,依赖走声明式注入;
3. **provide 可交换接口**:注册表 + 唯一 ID(`@basis/*`、`@<industry>/*` 命名空间),同 ID 重复注册先配逆旧的。
