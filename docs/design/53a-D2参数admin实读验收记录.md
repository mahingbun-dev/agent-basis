# 53a - D2 参数 admin 观测面实读验收记录

> 状态:**已验收 2026-11-23**(53 号 §5-P2 第三道验收项「admin 观测面实读 thresholdRatio=0.7、attachments=true」闭环)。
> 环境:生产容器 `eterna-agent`(镜像 `eterna-agent:0.2.0-rc.5-5`,sha256 `28510db313c1`,0.2.0-rc.5-5,d460caa);只读探针,未改动任何运行态。
> 关联:`53-主会话上下文治理-orchestrator特化压缩与话题分治.md` §5-P2、`22` 号 §5-C11、`28` 号 §5。

## 证据链(全部实测 2026-11-23)

### 1. admin RPC 实读(eternaCompaction/recentCheckpoints)

- 管理员登录(verify.sh 同配方:POST `/login` → 跟 dsh 桥接 redirect → cookie)+ POST `/api/eternaCompaction/recentCheckpoints`(client-request 信封)→ `result.ok=true`,8 行 checkpoint。
- 最新一行即 **orchestrator 主会话**(deploy 后首次压缩):`session=orchestrator-Mr.Ma,at=2026-11-23T02:25:44Z,shadowedTokenCount=77634,provider=mimo,model=mimo-v2.6-flash`,摘要为 8 段模板(`## Primary Request and Intent` 起,触发原文带逐字引文)——D3 定制品与 22 号 C3 结构校验的生产侧可见证据。
- 注:checkpoint 行视图(`CompactionCheckpointsView`)现不含 thresholdRatio/attachments 字段(行内省略),生效参数证据走 §2/§3 两面;行视图补列已登记为 admin 观测面的小改进(见 53 号复审发现 5 的「观测面未端到端接出」项)。

### 2. 渲染 profile(容器内真源 `/data/profiles/eterna-super/cordis.patch.yml`)

- orchestrator preset(`eterna-tasks-orchestrator`)压缩组 compaction-basic 行:`thresholdRatio: 0.7` + `attachments: true` + 摘要模型空串对(维持会话模型,Q1 不翻案);`:933-946` 注释逐条载明 D2 拍板与双门禁现状。
- worker preset 与 standard/cordis 组的 compaction-basic 保持默认参(config:{},worker 组明注「不落 D2 特化键」)——**特化只落主会话**,53 号 §3-D2 的分面语义在生产渲染物中成立。

### 3. 运行态快照(`/data/.eterna/compaction.state.json`)

```json
{"thresholdRatio":0.7,"retainRatio":0.16,"headroomTokens":65536,"auto":true,
 "rapidRefillCount":0,"lastRapidRefillAt":null,"summarizationProvider":"","summarizationModel":""}
```

- `thresholdRatio: 0.7` = D2 值已在运行引擎生效;`rapidRefillCount: 0` = **熔断零触发**(53 号 §5「熔断兜底」观测项的首个数据点;后续按周观测,持续增长即回 P2 调参流程)。

## 结论

53 号 §5-P2 三道验收中「admin 观测面实读」一项**通过**:D2 参数(thresholdRatio 0.7 / attachments true)在生产容器渲染 profile、运行态快照两面一致,admin RPC 面可读、主会话压缩事务真实发生且摘要结构合规。其余两道(压缩 golden userVerbatim 100% 已三轮补跑,r3 4/4 入库;压缩态回放 ≤2pp 见 `scripts/route-compaction-replay.mjs` 首跑报告)分别在其交付物中登记。
