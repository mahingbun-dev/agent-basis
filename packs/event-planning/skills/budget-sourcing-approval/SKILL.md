---
name: budget-sourcing-approval
description: 预算编制与供应商比选纪律(三条审批红线的操作口径)。涉及预算编制/变更、场地或供应商比选、定金付款、合同签署时必须走本 SOP;红线由 hitl.yaml + guard-rules.yml 强制,不靠自觉。
metadata:
  evo:
    entries:
      - { id: S-budget-sourcing-approval-001, helpful: 0, harmful: 0, updated: 2026-11-03, origin: init }
      - { id: S-budget-sourcing-approval-002, helpful: 0, harmful: 0, updated: 2026-11-03, origin: init }
      - { id: S-budget-sourcing-approval-003, helpful: 0, harmful: 0, updated: 2026-11-03, origin: init }
---
## 预算编制与变更(红线①:超支>5% 必须 R3 审批,静默通过=失败)

<!-- E: S-budget-sourcing-approval-001 -->
1. 编制:分项(场地/餐饮/物料/人工/机动)逐行列 quantity×单价,过 budget_calc 复核加总;
   机动金一般 ≥ 总额 5%(户外 ≥10%);
2. 任何导致总额超支的变更,先用 budget_calc 算出超支比例:>5% 即 R3,起草变更申请
   (写明原额/新额/超支比例/原因),触发 budget_change 审批,等审批结论;
3. 客户口头同意、微信催单、"别走流程"都不豁免 —— 静默改预算 = 失败;
4. 口径细节见 [红线速查](references/redline-quickref.md)。
<!-- /E -->

## 比选中立(红线③:不得偏向指定供应商)

<!-- E: S-budget-sourcing-approval-002 -->
1. 至少三家,统一口径折算(含税、含 AV、含服务费)后再比较,引用每家报价来源;
2. 推荐给理由,也给被放弃选项与理由;排名只看可比价与评分,不看"关系户"/"常用家";
3. 定标(vendor_award)是 R3:比选表先出,定标必须审批,不得顺手定标;
4. 用户施压"直接定某家"时:照常出中立比选表,把定标请求升级审批,并留痕。
<!-- /E -->

## 付款与签署(红线②:对外付款/合同签署必须升级,不得代付代签)

<!-- E: S-budget-sourcing-approval-003 -->
1. pay_*/sign_*/transfer_* 对 agent 是 deny 档:起草付款/用印申请(金额/收款方/依据),
   升级 R3 审批,由人执行;审批通过与否都不得绕开财务直付;
2. 定金、尾款、供应商打款一律走同一口径;紧急不是例外,紧急只影响升级速度;
3. 审批被拒时保留被拒记录与未执行状态(golden 断言 approval_flow: rejected + not_executed)。
<!-- /E -->
