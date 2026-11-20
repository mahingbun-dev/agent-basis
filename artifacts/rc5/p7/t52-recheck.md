# T52 · 证据收口复核（2026-11-20T01:27:35Z）

- 任务：T52（54 §4.9 / §7；51 §0.3 / §6.1）
- 工作树：`/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`，HEAD `02f4857`（复核时产品修复仍为待提交改动）
- 命令与退出码：`t52-recheck.log`（`run-t52-recheck.sh` 原文，EXIT=0）
- 判定：**证据收口通过；整体仍不可判绿**（FAIL 8 / MISSING 26，P0 未通过 16；P7 全量复跑未执行）

## 1. 本轮变更（相对 T50 首版矩阵）

| 项 | 首版（00:58Z） | 复核（01:27Z） | 依据 |
|---|---:|---:|---|
| PASS | 129 | **130** | `p6a/repairs/final-terminal-guard.json` |
| FAIL | 9 | **8** | 同上（TERM-004 修后复跑 6/6 denied） |
| MISSING | 26 | 26 | 无新缺失 |
| P0 未通过 | 17（FAIL 9 + MISSING 8） | **16（FAIL 8 + MISSING 8）** | `case-audit.json` |

- TERM-004：修前 FAIL（B 读到 A cwd/shells）；修后 `final-terminal-guard.json` PASS=11 / FAIL=0 / SKIP=0 / NOTRUN=1（仅 TERM-005 WS 面），B 对 A 的 6 个 unary 动作全部 `remote-access/denied` → 改判 PASS。
- IMP-005：`final-chat-import.json` PASS=8 / FAIL=0 / SKIP=4，`delta=10`、`allImportedPresent=true` → 维持 PASS。
- 单测：`unit-vitest.log` 49 files / 504 tests、`unit-tsc.log`、`unit-oxlint.log` 全 EXIT 0。
- 修前 FAIL 日志（E1/E2/E3 的 TERM-004 目录）保留，不参与当前判定（矩阵「修后复跑」规则）。

## 2. 仍未关闭（不得判绿）

- FAIL 8：ACC-006/008、MCPS-006、TERM-006、SEC-002/004/005、UI-006（全部 P0）。
- MISSING 26（其中 P0 8）：BOOT-007、MCPS-003、MCPP-019/020/022、TERM-002/003/012 等。
- `SOAK-24H`：24h 浸泡窗口未满（复核时观测约 3.2h/24h），DATA-009/TERM-013 维持 MISSING。
- `P7-NOTRUN`：P7 全量 164 复跑、PR、合并、生产部署与上线后 24h 未执行（P6 未收口）。

## 3. 证据

- `artifacts/rc5/acceptance-matrix.md`（164 行；PASS 130 / FAIL 8 / MISSING 26）
- `artifacts/rc5/p6a/case-audit.json`（TERM-004 已按修后复跑改判，`recheckedAt` 记录）
- `artifacts/rc5/p6a/summary.json`、`artifacts/rc5/p7/summary.json`
- `artifacts/rc5/p6a/repairs/{final-terminal-guard,final-chat-import}.{json,log}`、`unit-vitest.log`
- 本目录 `t52-recheck.log`、`check-commit-hygiene.mjs`、`run-t52-recheck.sh`

> 本文件与日志只含路径、状态与脱敏计数；无 cookie/token/密钥明文。