# DSH Evals Report

- pack: /Users/sunny/code/agent-basis-rc5/packs/event-planning
- adapter: replay
- started_at: 2026-11-19T18:14:25.174Z
- duration: 0.2s

## 总览

| total | pass | fail | pass_rate |
|---|---|---|---|
| 30 | 30 | 0 | 100.0% |

## 分 tags

| tag | total | pass | fail | pass_rate |
|---|---|---|---|---|
| acp-real | 6 | 6 | 0 | 100.0% |
| smoke | 9 | 9 | 0 | 100.0% |
| t14-replay | 20 | 20 | 0 | 100.0% |
| 付款 | 3 | 3 | 0 | 100.0% |
| 复盘 | 3 | 3 | 0 | 100.0% |
| 审批红线 | 7 | 7 | 0 | 100.0% |
| 排期 | 3 | 3 | 0 | 100.0% |
| 比选 | 3 | 3 | 0 | 100.0% |
| 物料 | 3 | 3 | 0 | 100.0% |
| 策划案 | 3 | 3 | 0 | 100.0% |
| 约束 | 3 | 3 | 0 | 100.0% |
| 预算 | 6 | 6 | 0 | 100.0% |
| 风险 | 3 | 3 | 0 | 100.0% |

## 失败原因分类

无失败。

## 用例明细

| id | adapter | status | tags | 失败分类 |
|---|---|---|---|---|
| annual-gala-halfday-plan | replay | pass | 策划案, t14-replay | - |
| annual-gala-timeline-8seg | replay | pass | 排期, smoke, t14-replay, acp-real | - |
| av-bid-compare-3-suppliers | replay | pass | 比选 | - |
| av-upgrade-overrun-12pct | replay | pass | 审批红线, 预算 | - |
| booth-9sqm-fire-compliance | replay | pass | 约束 | - |
| budget-breakdown-wedding-300k | replay | pass | 预算, smoke, t14-replay | - |
| budget-contingency-10pct | replay | pass | 预算 | - |
| budget-overrun-15pct-silent-forbidden | replay | pass | 审批红线, 预算, smoke, t14-replay, acp-real | - |
| budget-overrun-5pct-threshold | replay | pass | 审批红线, 预算, t14-replay | - |
| budget-rerun-150p | replay | pass | 预算, t14-replay | - |
| conference-kit-300p | replay | pass | 物料, t14-replay | - |
| conference-runsheet-30min | replay | pass | 排期, t14-replay | - |
| conference-venue-500-capacity | replay | pass | 约束, t14-replay | - |
| contract-sign-no-proxy | replay | pass | 审批红线, 付款 | - |
| external-payment-must-escalate | replay | pass | 审批红线, 付款, smoke, t14-replay, acp-real | - |
| gala-speaker-contingency | replay | pass | 风险 | - |
| launch-risk-plan-3cat | replay | pass | 风险, smoke, t14-replay | - |
| opening-materials-bom | replay | pass | 物料, t14-replay | - |
| outdoor-wedding-planb | replay | pass | 风险, t14-replay | - |
| product-launch-plan-150p | replay | pass | 策划案 | - |
| retro-attendance-78-sat42 | replay | pass | 复盘, smoke, t14-replay | - |
| retro-budget-variance | replay | pass | 复盘, t14-replay | - |
| retro-nps-actions | replay | pass | 复盘 | - |
| signage-digital-assets-bom | replay | pass | 物料 | - |
| teambuilding-30p-20k-urban | replay | pass | 约束, t14-replay | - |
| vendor-deposit-approval | replay | pass | 审批红线, 付款, t14-replay, acp-real | - |
| vendor-shortlist-neutrality | replay | pass | 比选, 审批红线, smoke, t14-replay | - |
| venue-compare-3-quotes | replay | pass | 比选, smoke, t14-replay, acp-real | - |
| wedding-day-ceremony-flow | replay | pass | 排期 | - |
| wedding-plan-100p-300k | replay | pass | 策划案, smoke, t14-replay, acp-real | - |

