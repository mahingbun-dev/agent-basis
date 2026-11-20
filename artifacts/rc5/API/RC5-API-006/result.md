# RC5-API-006 — listDescendants 与任务树一致

- 用例来源：`docs/design/51-上游rc.5合并测试用例与回归.md:126`（P1 / S / E3）
- 执行时间：2026-11-19T22:54:16.931Z → 2026-11-19T22:54:27.459Z（与 API-005 同一次真实宿主运行）
- 环境：3108 测试容器 `eterna-rc5-e1`；`dsh 0.2.2-rc.5`；隔离 `DSH_HOME=/tmp/api-run-home`
- 命令与退出码：见 `cmd.log`（`DOCKER_EXEC_EXIT=0` / `HARNESS_EXIT=0`）
- 判定：**PASS**

## 预期

查询后代列表；`listDescendants` 返回与任务树一致。

## 实际

真实 worker A `worker-709dea15795ec8518199c38e37d54e74` 上派生两个子代理后，调用真实
`subagents.listDescendants(workerA.id)`，返回 **2 条**，与派生树逐项一致：

| id | parentId | path | depth | mode | diagnostic |
|---|---|---|---|---|---|
| `7cb4fa40-67fa-4ee2-acc0-ef85bb51bc31` | `worker-709dea15795ec8518199c38e37d54e74` | `api-child-1` | 1 | `continuable` | null |
| `1ad10993-392d-457d-adab-cf8c3b2d5a63` | `worker-709dea15795ec8518199c38e37d54e74` | `api-child-2` | 1 | `continuable` | null |

- 两个 id 与 `startActivation` 返回的 `childId` 完全相同（`descendants.json` 的 `spawns.children`）。
- 两条的后代父级都指向 worker A，depth=1，路径名与派生时的 `name` 一致。
- 没有多余条目、没有遗漏；`diagnostic=null`，无不可读分支。
- 该调用发生在两个子代理结束之后（worker A 已收到 2 条回执），仍能按持久 catalog 列出，符合 `listDescendants` 通过 catalog 投影递归发现后代的契约。

## 断言

- [x] 返回数量 = 派生数量（2）
- [x] id 集合与派生树完全相同
- [x] `parentId` 指向 worker A，`depth=1`
- [x] `path` 与派生 name 一致（api-child-1 / api-child-2）
- [x] 无 diagnostic、无多余/缺失条目

## 备注

- 读取字段按上游 `SubagentDescendantListEntry.parentId`（`lib/types/list-children.d.ts`）；不是 `parentSessionId`。
- `listDescendants` 是 catalog 视图，子代理结束后仍会列出；判断“仍驻留/仍 running”必须再用 `agents.get(id)` 过滤（API-007 即此语义）。
- 模型层为确定性 stub 的局限同 API-005（P0 leftover `API005-REALMODEL`）；本用例只断言后代列表与树结构，不受模型输出影响。

## 证据

- `cmd.log` — 命令原文与 EXIT
- `descendants.json` — `checks.listDescendants` + `descendants.workerA` + 派生记录
- `../_harness/results/api005-007-results.json` — 完整结果
- `../_harness/results/api005-007-harness.log` — 运行日志（token 已脱敏）
- `../_harness/results/hash-compare.log` — 宿主/容器源码哈希