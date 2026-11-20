# RC5-MCPS-008 — `migrate-mcp-servers.mjs` 旧行写入新 patch、数据不丢、幂等（local PASS）

- 方式：A（自动化）｜结论：**PASS（本地 CLI + 单测覆盖）**

## 命令与 EXIT

```bash
cd /Users/sunny/code/agent-basis-rc5
node --test docker/profile/migrate-mcp-servers.test.mjs
# 12 tests / 12 pass / 0 fail — EXIT=0

# CLI 端到端（真实模板作“新渲染 patch”，旧 patch 为 rc.1 形态夹具）
node docker/profile/migrate-mcp-servers.mjs \
  artifacts/rc5/MCPS/RC5-MCPS-008/fixture/old.cordis.patch.yml \
  artifacts/rc5/MCPS/RC5-MCPS-008/fixture/new.cordis.patch.yml \
  artifacts/rc5/MCPS/RC5-MCPS-008/fixture/.upgrade-mcp-servers-backup.json
# EXIT=0（run1）：迁移 2 项 servers；新 patch 行已承载 browser，未复制到 mcp-manager
# EXIT=0（run2）：servers 已一致 → 幂等零写；new patch sha256 不变
```

## 断言（8/8）

```
PASS  mcp-manager row present
PASS  servers keys = alpha,beta
PASS  alpha.url preserved
PASS  beta.command preserved
PASS  beta.env token preserved
PASS  browser not duplicated into manager
PASS  template still has mcp-browser row
PASS  template default servers was empty
```

幂等：run1/run2 的 `new.cordis.patch.yml` sha256 相同（`new.sha1.txt` == `new.sha2.txt`）。
写前备份 `new.cordis.patch.yml.bak-<ts>` 存在且 0600。

## 证据

- `run1.log` / `run1.exit`、`run2.log` / `run2.exit`
- `new.sha1.txt` / `new.sha2.txt`（幂等）
- `assertions.log`（8/8 + EXIT）
- `migrate-mcp-servers.test.log`（12/12）
- `fixture/`（dummy token 占位，无真实凭据）

## 说明

夹具用占位凭据（`token-placeholder`），未触碰生产卷/容器；新 patch 取当前
`cordis.super.patch.yml.template` 原文，覆盖「模板变更后重渲染」的真实形状。