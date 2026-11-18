# 路由金集 v0(packages/tasks/tests/route-golden/)

> 35 号 A26 交付件;28 号 §5(方案/定制品/验收口径);24a 拍板记录·C4(人工 20 条起步 + 月度增补)。
> **落位**:本目录 `tests/route-golden/` 为 35 号 A26 任务指令指定落位,自
> `tests/fixtures/routing-golden/` 迁入(34 号 §4 精神位);**落位暂定**——存放位置与
> CI/发布触发口径未拍板(35 号 §12-10),拍板后可整体迁移——不视为设计定稿。
> **跑动口径(暂登记)**:压缩前后各一遍的路由回归随 **nightly CI 口径**执行(A26 任务
> 指令注明;§12-10「挂 CI 还是发布门禁」未拍板,拍板后随落位一并迁移)。

## 判例形态(消费方 = 评测监控视图 / dsh-evals)

- **四类判例**(28 §5):`accept`(明确受理)/ `attach`(挂到已有工单)/ `ignore-bot`
  (应忽略的 bot 消息)/ `stop`(应停止)。见 `entries.ts` 的 `GoldenKind`。
- **规模**:v0 = 20 条人工判例(`RG-01`…`RG-20`);设计目标 30–50 条,两处非冲突。
- **触发原文** = 压缩强制保留项(每条判例的 `trigger.text`;21 号 D3 定制品 × Mandate,
  28 §5):压缩改动保留策略时,该列逐字保留是前置约束,归 compaction 包。
- **回放**:`replay` 是记录的模型裁决(Decision 面)——replay 适配器按它重放路由行为;
  `byGate: true` 表示策略门结构性裁定(路由器未见候选,如名单外 bot 的 not_human)。
- **压缩后跑法**:验收口径 = 在**压缩后的会话状态**上回放,压缩前后各一遍,通过率差
  ≤2 个百分点视为无衰减(28 §5);跑动节奏 = nightly(见文件头);驱动 =
  `node tools/evals/bin/dsh-evals.mjs run --pack packs/<行业> --adapter replay` +
  `scripts/diff-pass-rate.mjs <run1> <run2>`【待建,G2-A9;落地前判据 = 两份 report.md
  归档 + 差值一行记入里程碑评审登记(33 号 G2-A9 原文)】;超标处置 = 调摘要档位或
  保留策略,不允许靠改 prompt 纪律硬扛(25 号教训)。
- **vitest 面**:`tests/route-golden.spec.ts` 对全部判例做两件事——形态校验(20 条、
  四类齐、id 唯一、触发原文非空)与干净态回放(经模拟宿主 Engine,断言每条的落点)。
  干净态回放是金集自身的正确性守卫,随包级 verify 跑;衰减度量(dsh-evals 跑法)以
  本目录判例为数据源。
- **dsh-evals pack 适配对接点**:判例数据面即本目录 `entries.ts`;pack 侧适配(把判例
  包装为 replay pack)随 G2-A9 驱动脚本落地,届时本文件同步登记 pack 路径。

## 增补流程(24a C4:试点期月度从真实 Decision 增补)

1. 从 audit trace(`Decision` 及其 `triggerIds`/`reason`,35 号表②-6 审计链)抽取当月
   有代表性的真实路由;
2. 按上述形态追加 `RG-NN` 判例(id 不重号),`why` 写明理据;
3. 跑 `pnpm --filter @eterna/tasks run verify`(形态校验 + 回放随全量测试绿)。
