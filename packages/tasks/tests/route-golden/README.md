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
  ≤2 个百分点视为无衰减(28 §5);跑动节奏 = nightly(见文件头;已挂
  `.github/workflows/ci.yml` 的 `route-golden-nightly` job,随 schedule 面每日跑,
  §12-10 落位拍板后随迁)。驱动三步(G2-A9 已落地):
  1. `node scripts/route-golden-pack.mjs --out dsh-evals-out/route-golden-pack`
     ——判例生成式包装为 dsh-evals replay pack(`RG-NN` → case id `rg-NN`,
     answer 断言面 = `route=<kind>` 裁决类别,详见脚本头注释);
  2. `node tools/evals/bin/dsh-evals.mjs run --pack dsh-evals-out/route-golden-pack
     --adapter replay --out <run1>` 与 `--out <run2>` ——压缩前后各一遍;
  3. `node scripts/diff-pass-rate.mjs <run1> <run2> --threshold 2` ——通过率差值
     门禁(JSON 优先读各 run 的 `sessions.jsonl`,兜底 `report.md`;>2pp 退出码 1)。
  产档路径 = 各 run 目录下的 `report.md` + `sessions.jsonl` + `events/<case-id>.jsonl`
  + `run.json`(F2 复审修复:口径指纹 manifest——pack 内容 + adapter + subset 的
  sha256,tools/evals/src/runner.ts 落盘)(dsh-evals-out/ 已 gitignore);超标处置 =
  调摘要档位或保留策略,不允许靠改 prompt 纪律硬扛(25 号教训)。**现状(诚实口径,
  F2 复审修复后)**:第二遍的压缩态回放需真实会话态(DSH 会话 + 压缩后 context
  重放器 + LLM 摘要,随 53 号 P0/P2 落地),当前离线可跑的是记录裁决面的形态校验
  回放 + 差值管线保活(nightly job 注释同步登记)。**同口径复跑的恒真对比已被工具
  结构性识别**:两侧 run.json 指纹相同 = 同 pack 同 adapter 确定性复跑、diff 恒 0
  by construction——diff-pass-rate 缺省拒绝判定(退出码 3「门禁未武装」),nightly
  job 以 `--allow-same-caliber` 显式放行保活(28 §5 的 ≤2pp 衰减门禁在压缩态腿就位
  前是显式豁免而非形似恒真);压缩态重放器落地后指纹天然不同,门禁自动武装,无需
  改驱动三步。差值一行仍照 33 号 G2-A9 原文记入里程碑评审登记。
- **vitest 面**:`tests/route-golden.spec.ts` 对全部判例做两件事——形态校验(20 条、
  四类齐、id 唯一、触发原文非空)与干净态回放(经模拟宿主 Engine,断言每条的落点)。
  干净态回放是金集自身的正确性守卫,随包级 verify 跑;衰减度量(dsh-evals 跑法)以
  本目录判例为数据源。
- **dsh-evals pack 适配对接点**:判例数据面即本目录 `entries.ts`;pack 侧适配 = 生成式
  脚本 `scripts/route-golden-pack.mjs`(G2-A9)——从本目录判例生成 dsh-evals replay
  pack 至 `dsh-evals-out/route-golden-pack/`(gitignored,幂等重建)。不提交静态 pack:
  判例落位 §12-10 未拍板,生成式保证判例增补后 pack 与数据源天然同步,不制造第二
  事实源;单测 `scripts/route-golden-pack.test.mjs` 把生成的 YAML 钉在 dsh-evals 真实
  schema(tools/evals/src/schema.ts)上。

## 增补流程(24a C4:试点期月度从真实 Decision 增补)

1. 从 audit trace(`Decision` 及其 `triggerIds`/`reason`,35 号表②-6 审计链)抽取当月
   有代表性的真实路由;
2. 按上述形态追加 `RG-NN` 判例(id 不重号),`why` 写明理据;
3. 跑 `pnpm --filter @eterna/tasks run verify`(形态校验 + 回放随全量测试绿)。
