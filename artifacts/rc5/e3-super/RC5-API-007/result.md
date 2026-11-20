# RC5-API-007 — 排空后代后无残留 running（API-007）

- 形态：**E3 super 测试容器**内的隔离 DSH_HOME 真宿主 harness（同 RC5-API-005 的 `api-real` 车道）
- 优先级：P1
- 结论：**PASS（真模型档）**
- 时间：2026-11-20T08:46:37.088Z → 2026-11-20T08:48:17.524Z
- 模型：`mimo / mimo-v2.6-pro`（已配置凭据；证据无凭据值）

## 预期（51/54 原文口径）

drainDescendants 后无残留 running

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | worker B 上派长驻 child 后 `drainDescendants` | `drainedChild=8192e459-072b-4289-8bdc-691ef8433db8`；`drainMs=10` |
| PASS | drain 后无残留 running（agents 注册表复查） | `residentAfter=[]`；`descendantsAfter=[{id:8192e459…,resident:false}]`；`waitForTreeWorkAfter=false`；`workerStatusAfter=idle` |
| PASS | 确定性 stub 档同一断言 | `artifacts/rc5/API/_harness/results/api005-007-results.json` `checks.drainDescendants.ok=true` |

## 证据

- `artifacts/rc5/e3-super/real-harness/results.json`（`checks.drainDescendants`、`drain`）
- `artifacts/rc5/e3-super/real-harness/harness.log`
- `artifacts/rc5/e3-super/API-005-real-model.md`（车道/边界说明）

## 备注

- `listDescendants` 是持久 catalog 视图，drain 后仍列出已释放 child；残留 running 的判定叠加 `agents.get(id)`，本断言按此口径。

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。