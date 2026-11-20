# RC5-API-006 — 查询后代列表与任务树一致（API-006）

- 形态：**E3 super 测试容器**内的隔离 DSH_HOME 真宿主 harness（同 RC5-API-005 的 `api-real` 车道）
- 优先级：P1
- 结论：**PASS（真模型档）**
- 时间：2026-11-20T08:46:37.088Z → 2026-11-20T08:48:17.524Z
- 模型：`mimo / mimo-v2.6-pro`（已配置凭据；证据无凭据值）

## 预期（51/54 原文口径）

listDescendants 返回与任务树一致

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | worker A 上派 2 个真实 child 后，`listDescendants(workerA)` 与树一致 | `ids=[d172fc6d-a1a4-47d5-abd4-81b96e037c2f,f3ceb318-cc3b-4c58-b347-88d8e7409e51]`，与 expected 相同，`extras=[]` |
| PASS | 两条 child 都是真实 model 回合 | 真模型档 `realModel=true`；child 回执 `completed` |
| PASS | 确定性 stub 档同一断言 | `artifacts/rc5/API/_harness/results/api005-007-results.json` `checks.listDescendants.ok=true` |

## 证据

- `artifacts/rc5/e3-super/real-harness/results.json`（`checks.listDescendants`、`descendants.workerA`）
- `artifacts/rc5/e3-super/real-harness/harness.log`
- `artifacts/rc5/e3-super/API-005-real-model.md`（车道/边界说明）

## 备注

- `listDescendants` 是持久 catalog 视图；drain 后仍列出已释放 child（`resident=false`），判断残留 running 需叠加 `agents.get(id)`（API-007 已按此口径断言）。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。