# @basis/panel —— 基座面板(DSH Web 双面插件)

把 agent-basis 已开发的能力在 Web 页面上**被看见、可操作**:侧栏新增「基座面板」入口,
点开是三区块面板——①服务清单卡片(governance / memory / knowledge / @event 工具清单+R3 标记),
②操作指引(每能力一条示例 prompt,点击即复制),③可观测样例(最近会话 token / 缓存命中率)。

## 结构:一行两面

`cordis.patch.yml` 插入一行 `- id: basis-panel, name: '@basis/panel'`(与 `@basis/glue` 同款
insert 语义配方),这一行同时驱动两个半边:

| 半边 | 文件 | 说明 |
|---|---|---|
| Host(node 进程) | `src/index.ts` | 插件 `apply` 构造 `BasisPanelGateway`(`TypertRemoteService` 子类),暴露只读快照端点 `basisPanel/snapshot` |
| Browser(页面) | `src/client/` → 构建 → `lib/client.js` | 闭包工厂 bundle(`window.__ModuleLoader__.load`);注册侧栏入口 + 面板页 |

package.json 声明 `dsh.client: { platform: 'web' }` 且导出 `./client`,宿主 `client-modules`
扫描(dsh-repo `docs/subsystems/client-modules.md`)把本包组进 `window.__DSH_BOOT__` 浏览器
花名册——`GET /plugins/@basis/panel/client.js` 由宿主提供。

## 数据通道(官方支持面,为什么这样选)

浏览器面板 → 宿主快照走**Typert 网关 + Connection RPC**,全链路在 DSH 官方机制内:

1. **Host 侧暴露**:`BasisPanelGateway extends TypertRemoteService`(`@deepseek-ai/dsh-typert-protocol`),
   服务名 `basisPanel`,方法 `snapshot()` 经 `@Remote` 命中。本包源码以 TS type-stripping 直接装载
   (与 glue 一致),Node 不解析标准 decorator 语法,故经 `Remote()` 公开函数面手工施加
   (`applyRemoteMarker`,等价于 `@Remote('snapshot')` 糖)。网关按 SRC 模式解析
   (api/gateway `resolveSrcDescriptor` 扫描 `ctx.reflect.props` 里带 `typertRemote` 绑定的活服务)。
2. **Browser 侧调用**:`ctx.connection.rpc.call('/api', 'basisPanel/snapshot', { args: [] })`——
   Connection 是官方宿主 RPC 通道(浏览器侧 ctx 服务),网关客户端同款调用形态。
   选择它而不是 `ctx.remote.*`:类型化 Remote 命名空间需生成工件并入 dsh-repo 的
   `api/remotes` 装配(仓库不可改),而 `connection.rpc` 是它底下的公开传输面。
3. **鉴权**:走页面既有 token Cookie(owner Peer),网关对 owner 调用免 access 决策。

## 面板三区块(数据源如实标注)

### ① 服务清单 `data-basis-panel-section="services"`

| 卡片 | 数据源 | 字段 |
|---|---|---|
| governance | `ctx.governance` 服务(glue governance-plugin 活实例);缺席回退解析 `.basis/governance.rules.yml`;审计读 `.basis/audit.jsonl` 行数 | 规则数 / 最近审计条数 |
| memory | `node:sqlite` 只读打开 `.basis/memory.sqlite3`(glue memory-plugin 约定路径) | 有效实体数(invalid_at IS NULL)/ 最近 5 条 key(updated_at 降序) |
| knowledge | 只读打开 `.basis/knowledge.sqlite3` | wiki-local 文档数(pages)/ 待审提案数(proposals)/ WeKnora 状态 |
| @event 工具 | `ctx.tools.definitions()` 注册表活过滤 + `packs/event-planning/hitl.yaml` 风险档 | 工具名 + 风险档(R3 标记) |

工具清单以注册表活数据为准:`@event/pack` 实际注册 10 个模型面工具(任务口径「9 个」,
plugin.ts 逐一 `ctx.tools.register` 的名单见 `src/snapshot.ts` EVENT_TOOLS 常量);面板断言按
≥9 且含 budget_calc/pay_deposit 口径。

WeKnora 如实显示 `not-mounted`:glue 仅装配 wiki-local 后端(`@basis/knowledge` weknora.ts
需 enabled+baseUrl+token 三要素才可用)。审计同理:glue 未接审计投影,`.basis/audit.jsonl`
不存在时显示 0 条。

### ② 操作指南 `data-basis-panel-section="guide"`

`src/prompts.ts` 静态数据:memory 写/搜/忘、knowledge 检索/提案(fail-closed)、budget_calc
预算计算、pay_deposit 付款审批红线(R3),每条点击复制到剪贴板。

### ③ 可观测样例 `data-basis-panel-section="observability"`

读 `~/.dsh/sessions`(或 `DSH_HOME/sessions`)最近 5 个 `session.v4.jsonl.zstd`,按宿主
持久化层的多帧 zstd 容器逐帧解码(帧扫描算法对齐
`dsh-repo packages/session/persistence-jsonl` 的 `scanZstdFrames`,公开 one-shot 解码路径),
折叠 `assistant/message` 事件的 `data.usage`:inputTokens / outputTokens / cacheReadTokens
与缓存命中率(= cacheRead / (input + cacheRead);零输入显示 —)。读不到任何用量时显示占位说明。

## 装载(basis-web profile,同 glue 配方)

```bash
# 1) 仓库内构建并验证
pnpm --filter @basis/panel run verify          # build:client + oxlint + tsc + vitest

# 2) 同步到 profile(对齐既有 packages/glue 的做法)
cp -R packages/panel ~/.dsh/profiles/basis-web/packages/panel   # 含 lib/client.js
# profile 侧 package.json 两处:
#   dependencies += "@basis/panel": "file:packages/panel"
#   dsh.profile.bundles += "@basis/panel"
cd ~/.dsh/profiles/basis-web && pnpm install

# 3) 重启宿主(改 panel 代码后必须重启再测)
pkill -f 'profile basis-web'; sleep 2
cd /tmp/basis-ws && LITELLM_API_KEY=$(cat .../.secrets/litellm-master-key.txt) \
  nohup /opt/homebrew/bin/dsh --profile basis-web > /tmp/basis-web-app.log 2>&1 &
```

浏览器打开 `http://127.0.0.1:3080/?token=<新token>`。若该浏览器对 127.0.0.1 源出现
页面挂死(多次宿主重启后残留的连接池/渲染器问题,与应用无关),换 `http://localhost:3080/?token=…`
即恢复——两个 origin 是同一宿主的不同源字符串。

profile 侧包的 `peerDependencies` 钉宿主已装版本(cordis `>=4.0.6-alpha.1`、
dsh-typert-protocol `>=0.2.2-alpha.2`),运行期由 dsh 的解析拦截解析到全局安装。

## DOM 锚点(供 E2E 严断言)

面板 DOM 全部带 `data-basis-panel*` 结构化属性,断言落在这些锚点上(非页面全文匹配):
`data-basis-panel="root|services|guide|observability"`(三区块)、
`data-basis-panel-card="governance|memory|knowledge|event-tools"`、
`data-basis-panel-tool="<tool>"` + `data-basis-panel-risk="R3"`、
`data-basis-panel-prompt="<id>"` + `data-basis-panel-copy="<id>"`、
`data-basis-panel-session="<id>"` + `data-basis-panel-cache-hit-rate`。

## 测试

`pnpm --filter @basis/panel run test`:
- `snapshot.test.ts`——临时工作区钉住 governance/memory/knowledge/tools 各字段口径与容错;
- `session-logs.test.ts`——多帧 zstd 帧扫描、torn 尾巴、usage 折叠、命中率;
- `prompts.test.ts`——指引覆盖面(memory 写/搜/忘、knowledge 检索/提案、预算、R3 红线);
- `host-plugin.test.ts`——SRC marker 命中与插件形态;
- `client-bundle.test.ts`——闭包工厂工件形态 + vm 装载冒烟(apply/inject 导出面)。
