# RC5-TERM-007 — terminal 配置（TERM-007）

- 形态：**E3 super 测试容器**（`rc5-test-e3` / `eterna-rc5-e3` / 3109 / `$HOME/eterna-data/test-rc5/e3`）
- 优先级：P0
- 结论：**PASS**
- 时间：2026-11-19T22:27:56.514Z → 2026-11-19T22:27:56.555Z

## 预期（51/54 原文口径）

readUserTerminals=false；preferredShells=[bash]

## 断言

| 结果 | 断言 | 实测 |
|---|---|---|
| PASS | preferredShells=[bash] | preferredShells: [bash] |
| PASS | readUserTerminals=false | readUserTerminals: false |

## 命令原文（完整见 cmd.log）

- `docker exec eterna-rc5-e3 cat /data/profiles/eterna-super/cordis.patch.yml` → exit=0（rendered super patch）

> 证据已脱敏：boot token/会话 cookie/口令/API key 均不入文件；生产容器只读 inspect，不 start/stop/exec。
