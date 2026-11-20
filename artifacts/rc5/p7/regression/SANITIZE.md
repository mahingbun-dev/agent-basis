# T52 证据脱敏记录

- 时间：2026-11-20T01:57:47.582Z
- 范围：`artifacts/rc5/p7/regression/**` 内 .log/.md/.json/.txt/.yml/.jsonl（脚本与源码不在内）
- 规则：`token=`、`eterna_session=`、`dsh-auth=`、`mcp-session-id:`、password/secret/authorization 值
- 本次运行新增替换：**0** 处 / 0 个文件（幂等复核时通常为 0）
- 全量脱敏足迹（累计标记）：**11** 处 / 11 个文件

## 本次新增

| 文件 | 替换次数 |
|---|---:|
| （无新增，所有匹配值已在此前轮次脱敏） | 0 |

## 累计足迹

| 文件 | 脱敏标记数 |
|---|---:|
| rerun/E1/BOOT/RC5-BOOT-001/boot.log | 1 |
| rerun/E1/BOOT/RC5-BOOT-001/cmd.log | 1 |
| rerun/E1/BOOT/RC5-BOOT-002/boot.log | 1 |
| rerun/E1/BOOT/RC5-BOOT-008/boot-baseline.log | 1 |
| rerun/E1/BOOT/RC5-BOOT-008/boot-first-migrate.log | 1 |
| rerun/E1/BOOT/RC5-BOOT-008/boot-second.log | 1 |
| rerun/E1/BOOT/RC5-BOOT-009/boot-optout.log | 1 |
| rerun/E2/MCPP/RC5-MCPP-013/cmd.log | 1 |
| rerun/E2/MCPP/summary.json | 1 |
| rerun/logs/API-005-007-harness.log | 1 |
| rerun/logs/API-harness-rerun.log | 1 |

> 替换只抹去凭据值，保留字段名与上下文；被抹位置的字段名足以复核事件类型。
> 每轮运行记录追加在 `SANITIZE-HISTORY.md`。
