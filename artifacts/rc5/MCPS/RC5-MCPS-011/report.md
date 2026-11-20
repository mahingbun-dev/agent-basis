# RC5-MCPS-011 — H9 重渲染保留 `servers` 键数/内容 + 失败 `.upgrade-mcp-servers-backup.json`（0600）

- 方式：S（模拟模板变更触发重渲染）｜结论：**本地 H9 机制 PASS（11/11）；
  容器端到端重渲染 deferred to W5，本用例在 LaneReport 中不计为整体绿。**

## 命令与 EXIT

```bash
cd /Users/sunny/code/agent-basis-rc5

# 成功路径：旧 patch（含 2 个系统层 server）→ 新渲染 patch（当前 super 模板）
node docker/profile/migrate-mcp-servers.mjs \
  artifacts/rc5/MCPS/RC5-MCPS-011/fixture/old.cordis.patch.yml \
  artifacts/rc5/MCPS/RC5-MCPS-011/fixture/new.cordis.patch.yml \
  artifacts/rc5/MCPS/RC5-MCPS-011/fixture/.upgrade-mcp-servers-backup.json
# EXIT_RENDER=0：迁移 2 项 servers（写后 2）

# 失败路径：旧 patch 为坏 YAML
node docker/profile/migrate-mcp-servers.mjs \
  artifacts/rc5/MCPS/RC5-MCPS-011/fixture/old-broken.cordis.patch.yml \
  artifacts/rc5/MCPS/RC5-MCPS-011/fixture/new-broken.cordis.patch.yml \
  artifacts/rc5/MCPS/RC5-MCPS-011/fixture/.upgrade-mcp-servers-backup.json
# EXIT_FAIL=1（fail-closed），备份 JSON 0600
```

## 断言（11/11）

```
PASS  servers keys preserved = alpha,gamma
PASS  alpha.url preserved
PASS  gamma.env preserved
PASS  gamma URL preserved
PASS  failure exit non-zero
PASS  failed run leaves new patch byte-identical
PASS  backup JSON mode 0600
PASS  backup JSON carries error + capturedAt
PASS  backup JSON redacts token values
PASS  entrypoint H9 after prompt transplant (111 < 142)
PASS  entrypoint H9 before relay token sed (142 < 314)
```

入口时序实测行号（`docker/entrypoint.sh`）：

- `:111` `node /repo/docker/profile/migrate-prompt-edits.mjs`（prompt 移植）
- `:142` `if ! node /repo/docker/profile/migrate-mcp-servers.mjs`（H9）
- `:314` `sed -i "s|__ETERNA_RELAY_TOKEN__|…"`（relay token sed）

失败留痕：`.upgrade-mcp-servers-backup.json` mode `600`，内容 `error` + `capturedAt`，
`token-placeholder` 原文不出现在 JSON（脱敏）。

## 未覆盖（deferred to W5，不标绿）

- 由**容器入口**在真实旧卷上触发重渲染的端到端链路（哈希门控 → transplant →
  H9 → sed）：需要 3108 容器 + 旧 profile 卷；本地用同一脚本 + 同一模板模拟了
  H9 机制，但没有跑 `entrypoint.sh` 本体。

## 证据

- `render.log` / `render.exit`、`failure.log` / `failure.exit`
- `assertions.log`（11/11 + EXIT）
- `fixture/`（dummy token 占位，无真实凭据）
- 入口时序：`docker/entrypoint.sh:111/142/314`