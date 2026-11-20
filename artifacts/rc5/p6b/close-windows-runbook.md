# 24h 浸泡窗口收口 Runbook（P6b）

> 适用：TERM-013 / DATA-009 两条 24h 窗口（最终镜像 `sha256:22fe8acb…`）。
> 原则：**未满窗口不判绿**；摘要文件由采样进程在 `--duration` 到期后自己写出，
> 不手工补写、不改 verdict。

## 0. 两个窗口

| 窗口 | 进程（启动即固化） | 摘要产物 | 计划结束 |
|---|---|---|---|
| 主 soak（TERM-013 + DATA-009 基础面） | `node scripts/soak-rc5.mjs --suite both --duration 24h … --tag 24h-final2` | `artifacts/rc5/p6b/soak/final-image2/summary-24h-final2.json` | `2026-11-21T06:08:06.781Z` |
| DATA-009 规模面（≥50 会话） | `node artifacts/rc5/E2/DATA/data-009-scale.mjs --duration 24h` | `artifacts/rc5/E2/DATA/scale/summary.json` | `2026-11-21T07:37:17.784Z` |

进程到期自行 `finalize()`：主 soak 写 `window.complete`、`term.verdict`、`data.verdict`；
规模窗口写 `windowComplete`、`verdict`。脚本退出码：verdict=FAIL 时非 0。

## 1. 到期后核对（只读）

```sh
cd /Users/sunny/code/agent-basis-rc5
jq -c '{complete:.window.complete, term:.term.verdict, data:.data.verdict, elapsed:.elapsedSeconds}' \
  artifacts/rc5/p6b/soak/final-image2/summary-24h-final2.json
jq -c '{complete:.windowComplete, verdict:.verdict, elapsed:.elapsedSeconds}' \
  artifacts/rc5/E2/DATA/scale/summary.json
docker ps --filter name=eterna-rc5 --format '{{.Names}}\t{{.Status}}'   # 三容器 healthy、restarts=0
```

## 2. 一条命令收口（推荐）

```sh
cd /Users/sunny/code/agent-basis-rc5
node scripts/rc5-close-windows.mjs
```

行为：两份摘要都满窗且 verdict 无 FAIL → 调矩阵 `--write`，并要求
`rows=164 PASS=164 FAIL=0 MISSING=0`，通过后写 `artifacts/rc5/p6b/window-close.json`
（判定快照，供 PR/签字引用），最后打印 `STATUS=READY`；矩阵不是 164/164 则
`STATUS=BLOCKED`（EXIT=1），不写结果文件。
窗口未满 → `STATUS=NOTRUN`（EXIT=0）、不改矩阵；verdict 含 FAIL → `STATUS=FAIL`（EXIT=1）。

演练（合成摘要 + `--dry`，不写回矩阵；环境覆盖不带 `--dry` 会被拒绝，EXIT=2）：

```sh
RC5_SOAK_SUMMARY=/tmp/rc5-soak-test/soak-pass.json \
RC5_SCALE_SUMMARY=/tmp/rc5-soak-test/scale-pass.json \
node scripts/rc5-close-windows.mjs --dry
```

## 2.1 手工等价步骤（审计用）

`scripts/rc5-acceptance-matrix.mjs` 已接「24h 时间窗权威」：

- 主 soak `window.complete=true` → TERM-013 取 `term.verdict`、DATA-009 先取 `data.verdict`；
- DATA-009 还需规模窗口 `windowComplete=true` 且 `verdict=PASS`，两者同时 PASS 才 PASS；
- 任一窗口未满**不覆盖**，维持 MISSING。

```sh
node scripts/rc5-acceptance-matrix.mjs          # 先看 rows/PASS/FAIL/MISSING 与 CHANGE 行
node scripts/rc5-acceptance-matrix.mjs --write  # 期望 rows=164 PASS=164 FAIL=0 MISSING=0
```

演练（不碰真实证据）：把 `RC5_SOAK_SUMMARY` / `RC5_SCALE_SUMMARY` 指向 `/tmp` 合成摘要，
已验证 PASS / 规模未满 / term FAIL 三种分支行为正确。

## 3. 判定后的动作

| 结果 | 动作 |
|---|---|
| 164/164 | 更新 `p7/{PR,release-notes,summary.json,doc54-delivery-audit,regression/signoff}` 数字与结论；提交「窗口满窗」证据（summary + matrix + ticks 末段）；进入 P7（push/PR 需用户显式确认） |
| TERM-013 FAIL | 保留 FAIL，不得判绿；按审计 §4 登记根因（fd/RSS/churn 三项哪条红），决定补跑窗口或产品豁免 |
| DATA-009 FAIL | 同上；规模面看 `read/write/integrity/lockMatches` 计数 |
| 进程未写摘要 | 查 `run.log` 尾与进程是否存活；**不得**用 tick 采样冒充 24h |

## 4. 禁止

- 手工改 summary 的 verdict / window.complete；
- 用 24h 以内的采样充当满窗证据（54 §3.5、48 §4.5）；
- 在窗口未满时更新矩阵两行为 PASS。