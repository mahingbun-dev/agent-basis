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
4. **市场分发**(可选):`market/index.json` 加条目(官方格式 1,`source: git` 固定 commit + `path` 指向包目录),版本号 bump——别人的 DSH「发现」页填仓库索引 URL 即可一键安装/更新。

## 6. 创造模式专属须知

- plugin_manager 安装**需逐次审批**;build-script(pnpm approve-scripts)同审;`compatibility.json` 豁免需显式 accept-risk。
- 无 HMR 的 profile 改动报 `restart-required`——重启后生效,不是 bug。
- 自修改/装卸插件是**高危面**:生产 profile 建议禁用 plugin_manager 行(bundles 里 `disabled: true`),只在开发 profile 开放。
