# agent-basis —— 领域 Agent 基座

在 DeepSeek Harness(DSH)之上构建的 **L1 基座插件 + L2 领域包** pnpm monorepo。目标:把"组织向"能力(治理 / 记忆 / 人机交互 / 评测 / 通道 / 受控自进化)做成可跨行业复用的 Cordis 插件;行业差异收敛为一份"领域包"(persona + skills + tools + policies + evals + hitl),验收标准 = 该包的评测通过率。

**当前状态**:12 个包 + 2 个 CLI + 1 个领域包已实现并通过验收(全局 verify 12 包 776 测试全绿;活动策划金集 30 条含 3 条审批红线,replay 20/20)。真连联调(ai-evo 门禁 / DSH 宿主装载 / WeKnora / 微信邮箱)进行中,详见 [DEV-REPORT.md](DEV-REPORT.md)。

## 架构

```
L2 领域包(每行业一份)   packs/event-planning(@event/pack)
L1 基座插件(跨行业复用)
  governance    规则引擎(deny 优先 fail-closed)+ 预算守卫 + PII + 审计 + egress
  memory        三层记忆(M1 文件 / M2 sqlite 实体)、forget=逆闭包真删
  interact      HITL 风险分档 R0-R3、富审批卡片、提问合并、审批负信号
  knowledge     wiki-local(FTS5+LIKE 混检)↔ WeKnora 双后端、提案制写入、三层过期过滤
  observe       失败信号表、token/成本/缓存命中率聚合、漂移检测
  evolve        受控自进化:SKILL 条目化 delta、进化账本、G0/G1/G2 门禁、prompt-audit
  channels      微信(三路径)/飞书/钉钉/邮箱双向 + 一次性审批令牌(防重放)
  cache-guard   KV-cache 前缀稳定性检查(DeepSeek 缓存价差 ~50×)
  extra         egress 域名白名单、reviewer preset、多租户 realm
tools           packctl(init/lint/check)· evals(dsh-evals:终态+轨迹+红线断言)
L0 DSH 内核     官方 MIT,锁版 0.2.2-alpha.2,零内核改动
```

设计原则:一切能力走 DSH 开放 seam(`ctx.tools` / approval waterfall / turn-stopping / systemPrompt sections / 事件流),**100% 不改内核**;插件遵守 Cordis 三纪律(effect 配逆 / coeffect 全声明 / provide 可交换接口)。

## 快速上手

前置:Node 24+(type-stripping 直跑 TS)、pnpm 11。

```bash
pnpm install
pnpm -w run verify            # 全仓 776 测试

# 生成新行业领域包骨架并体检
node tools/packctl/bin/packctl.mjs init 你的行业 --root .
node tools/packctl/bin/packctl.mjs lint packs/你的行业

# 回放适配器跑领域包金集
node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay
```

## 文档

| 文档 | 内容 |
|---|---|
| [DEV-REPORT.md](DEV-REPORT.md) | 开发执行报告:任务清单、验证证据、受阻项 |
| [PROGRESS.md](PROGRESS.md) | 14 任务进度表(每任务一提交) |
| [qa/INDEPENDENT-QA.md](qa/INDEPENDENT-QA.md) | 独立测试验收(不信任开发验收):缺陷清单与对抗测试记录 |
| [docs/design/](docs/design/) | 设计文档 15 篇(业界调研 / 架构 / RSI 自进化 / 独立测试) |
| [docs/ai-evo-integration.md](docs/ai-evo-integration.md) | ai-evo 评测平台对接手动步骤 |

## License

[MIT](LICENSE)
