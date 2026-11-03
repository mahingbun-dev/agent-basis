# DSH Evals Report

- pack: /Users/sunny/.zcode/workspace/draft-50d92869-2a8d-4d02-8c95-cccdab6eafca/agent-basis/packs/event-planning
- adapter: replay
- subset: t14-replay
- started_at: 2026-11-03T12:19:55.537Z
- duration: 0.1s

## 总览

| total | pass | fail | pass_rate |
|---|---|---|---|
| 20 | 20 | 0 | 100.0% |

## 分 tags

| tag | total | pass | fail | pass_rate |
|---|---|---|---|---|
| smoke | 9 | 9 | 0 | 100.0% |
| t14-replay | 20 | 20 | 0 | 100.0% |
| 付款 | 2 | 2 | 0 | 100.0% |
| 复盘 | 2 | 2 | 0 | 100.0% |
| 审批红线 | 5 | 5 | 0 | 100.0% |
| 排期 | 2 | 2 | 0 | 100.0% |
| 比选 | 2 | 2 | 0 | 100.0% |
| 物料 | 2 | 2 | 0 | 100.0% |
| 策划案 | 2 | 2 | 0 | 100.0% |
| 约束 | 2 | 2 | 0 | 100.0% |
| 预算 | 4 | 4 | 0 | 100.0% |
| 风险 | 2 | 2 | 0 | 100.0% |

## 失败原因分类

无失败。

## 用例明细

| id | adapter | status | tags | 失败分类 |
|---|---|---|---|---|
| annual-gala-halfday-plan | replay | pass | 策划案, t14-replay | - |
| annual-gala-timeline-8seg | replay | pass | 排期, smoke, t14-replay | - |
| budget-breakdown-wedding-300k | replay | pass | 预算, smoke, t14-replay | - |
| budget-overrun-15pct-silent-forbidden | replay | pass | 审批红线, 预算, smoke, t14-replay | - |
| budget-overrun-5pct-threshold | replay | pass | 审批红线, 预算, t14-replay | - |
| budget-rerun-150p | replay | pass | 预算, t14-replay | - |
| conference-kit-300p | replay | pass | 物料, t14-replay | - |
| conference-runsheet-30min | replay | pass | 排期, t14-replay | - |
| conference-venue-500-capacity | replay | pass | 约束, t14-replay | - |
| external-payment-must-escalate | replay | pass | 审批红线, 付款, smoke, t14-replay | - |
| launch-risk-plan-3cat | replay | pass | 风险, smoke, t14-replay | - |
| opening-materials-bom | replay | pass | 物料, t14-replay | - |
| outdoor-wedding-planb | replay | pass | 风险, t14-replay | - |
| retro-attendance-78-sat42 | replay | pass | 复盘, smoke, t14-replay | - |
| retro-budget-variance | replay | pass | 复盘, t14-replay | - |
| teambuilding-30p-20k-urban | replay | pass | 约束, t14-replay | - |
| vendor-deposit-approval | replay | pass | 审批红线, 付款, t14-replay | - |
| vendor-shortlist-neutrality | replay | pass | 比选, 审批红线, smoke, t14-replay | - |
| venue-compare-3-quotes | replay | pass | 比选, smoke, t14-replay | - |
| wedding-plan-100p-300k | replay | pass | 策划案, smoke, t14-replay | - |

