# T52 · P0 复跑对照（W5 基线 vs 本轮）

- P0 用例：97（来源 docs/design/51 §3 的 P0 行）
- 本轮判定分布：{"PASS":68,"FAIL":9,"MISSING":1,"NOTRUN":4,"NOT_RERUN":15,"PARTIAL":0}

| case | W5 | 本轮 | 说明/证据 |
|---|---|---|---|
| RC5-ENV-001 | PASS | NOT_RERUN | `` |
| RC5-ENV-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-ENV-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-ENV-004 | PASS | FAIL | `本轮运行时探针：/repo/tests/fixtures=present（6.0M，含 chat-import zip 与 mcp 夹具）→ 夹具进镜像` |
| RC5-ENV-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E0/verify-rc5-env-runtime.json` |
| RC5-ENV-006 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E0/verify-rc5-env-runtime.json` |
| RC5-BOOT-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-001` |
| RC5-BOOT-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-BOOT-002` |
| RC5-BOOT-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-003` |
| RC5-BOOT-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-004` |
| RC5-BOOT-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-005` |
| RC5-BOOT-006 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-006` |
| RC5-BOOT-007 | MISSING | MISSING | `重跑仍 EXIT=1 / 0 bytes；runner 的空集 PASS 不成立（沿用 W5 判定）` |
| RC5-BOOT-008 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-008` |
| RC5-BOOT-009 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-009` |
| RC5-BOOT-011 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/BOOT/RC5-BOOT-011` |
| RC5-BOOT-012 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-BOOT-012` |
| RC5-API-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/API-SEC-verify.log` |
| RC5-API-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/API-SEC-verify.log` |
| RC5-API-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/API-SEC-verify.log` |
| RC5-API-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/API-SEC-verify.log` |
| RC5-API-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/API/out/results.json` |
| RC5-ACC-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-ACC-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-ACC-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-ACC-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/ACC/RC5-ACC-004` |
| RC5-ACC-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/ACC/RC5-ACC-005` |
| RC5-ACC-006 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/ACC/RC5-ACC-006` |
| RC5-ACC-007 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/ACC/RC5-ACC-007` |
| RC5-ACC-008 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/ACC/RC5-ACC-008` |
| RC5-MCPS-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/MCPS/RC5-MCPS-001` |
| RC5-MCPS-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/MCPS/RC5-MCPS-002` |
| RC5-MCPS-003 | MISSING | NOTRUN | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/MCPS/RC5-MCPS-003` |
| RC5-MCPS-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/MCPS/RC5-MCPS-004` |
| RC5-MCPS-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/MCPS/RC5-MCPS-005` |
| RC5-MCPS-006 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/MCPS/RC5-MCPS-006` |
| RC5-MCPS-011 | PASS | NOT_RERUN | `` |
| RC5-MCPP-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-001` |
| RC5-MCPP-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-002` |
| RC5-MCPP-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-003` |
| RC5-MCPP-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-004` |
| RC5-MCPP-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-005` |
| RC5-MCPP-006 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-006` |
| RC5-MCPP-007 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-007` |
| RC5-MCPP-008 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-008` |
| RC5-MCPP-009 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-009` |
| RC5-MCPP-012 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-012` |
| RC5-MCPP-013 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-013` |
| RC5-MCPP-019 | MISSING | NOT_RERUN | `` |
| RC5-MCPP-020 | MISSING | NOT_RERUN | `` |
| RC5-MCPP-021 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/MCPP/RC5-MCPP-021` |
| RC5-MCPP-022 | MISSING | NOT_RERUN | `` |
| RC5-MCPP-023 | PASS | PASS | `官方脚本假红（重启后仅 eterna_session 调 list）；套件受控复测同配置仍在` |
| RC5-TERM-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-TERM-001` |
| RC5-TERM-002 | MISSING | NOTRUN | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-TERM-002` |
| RC5-TERM-003 | MISSING | NOT_RERUN | `` |
| RC5-TERM-004 | PASS | PASS | `E1/E2 守卫脚本 6/6 denied；E3 suite 的 denied() 未识别 remote-access/denied，属脚手架假红` |
| RC5-TERM-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/TERM/RC5-TERM-005a` |
| RC5-TERM-006 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-TERM-006` |
| RC5-TERM-007 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-TERM-007` |
| RC5-TERM-008 | PASS | FAIL | `复跑行为变化：伪造 sessionId 的 terminal/list 由「ok=true 空列表」变为 remote-access/denied（守卫 fail-closed）；无宿主枚举、但自动断言按旧语义判红` |
| RC5-TERM-012 | MISSING | NOTRUN | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E3/RC5-TERM-012` |
| RC5-IMP-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/IMP/RC5-IMP-001` |
| RC5-IMP-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/IMP/RC5-IMP-002` |
| RC5-IMP-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/IMP/RC5-IMP-003` |
| RC5-IMP-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/IMP/RC5-IMP-004` |
| RC5-IMP-005 | PASS | PASS | `上传后轮询 10/10 行 owner=B、空属主 0（官方脚本即时读为记账延迟假红）` |
| RC5-ACP-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E4/acp-report.json` |
| RC5-ACP-002 | PASS | NOTRUN | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E4/acp-report.json` |
| RC5-ACP-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E4/acp-report.json` |
| RC5-ACP-004 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E4/acp-report.json` |
| RC5-ACP-005 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E4/acp-report.json` |
| RC5-ACP-006 | PASS | NOT_RERUN | `` |
| RC5-ACP-007 | PASS | NOT_RERUN | `` |
| RC5-OFF-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/OFF/tools/probe-output.json` |
| RC5-OFF-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/OFF/tools/probe-output.json` |
| RC5-OFF-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E1/OFF/tools/probe-output.json` |
| RC5-HERO-001 | PASS | NOT_RERUN | `` |
| RC5-HERO-002 | PASS | NOT_RERUN | `` |
| RC5-HERO-003 | PASS | NOT_RERUN | `` |
| RC5-DATA-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/DATA-quick.log` |
| RC5-DATA-002 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/DATA-quick.log` |
| RC5-DATA-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/DATA-quick.log` |
| RC5-DATA-004 | PASS | NOT_RERUN | `` |
| RC5-DATA-005 | PASS | NOT_RERUN | `` |
| RC5-DATA-006 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/DATA-quick.log` |
| RC5-DATA-007 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/DATA-quick.log` |
| RC5-DATA-010 | PASS | NOT_RERUN | `` |
| RC5-UI-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-UI-006 | FAIL | NOT_RERUN | `` |
| RC5-SEC-001 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-SEC-002 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-SEC-003 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/logs/E0-static.log` |
| RC5-SEC-004 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/SEC/RC5-SEC-004` |
| RC5-SEC-005 | FAIL | FAIL | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/SEC/RC5-SEC-005` |
| RC5-SEC-006 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/SEC/RC5-SEC-006` |
| RC5-SEC-009 | PASS | PASS | `/Users/sunny/code/agent-basis-rc5/artifacts/rc5/p7/regression/rerun/E2/SEC/RC5-SEC-009` |
