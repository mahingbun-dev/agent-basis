# RC5-BOOT-004 — 未知行 id 计数 0（local PASS）

- 方式：S（真 boot）｜形态：web + super 双 boot
- 结论：**PASS（本地双 boot 覆盖）** — 未知行 id / 未知 patch 目标 = 0

## 命令

```bash
cd /Users/sunny/code/agent-basis-rc5
ETERNA_PROFILE_HOME=<mktemp -d> ETERNA_EVIDENCE_DIR=artifacts/rc5/p2/t11-slot-drift/web \
  node scripts/verify-eterna-web.mjs      # EXIT=0
ETERNA_PROFILE_HOME=<mktemp -d> ETERNA_EVIDENCE_DIR=artifacts/rc5/p2/t11-slot-drift/super \
  node scripts/verify-eterna-super.mjs    # EXIT=0
```

## 断言（两形态各一条）

```
PASS  BOOT-004 unknown plugin row count = 0 — live patch targets all resolve (40 overrides)
```

判据由 verify 脚本内的三面组成：

1. 原始 boot stdout/stderr 扫描 `unknown plugin row|patch: entry "…" not found|patch insert: …|patch: name mismatch` = 0 行；
2. 模板 40 条 override 行 id 全部命中活体 Loader 树（0 unknown）；
3. 模板形态 43 blocks = 3 insert + 40 override。

## 证据

- `evidence.txt`（命令、EXIT、断言、扫描计数=0、模板统计）
- `artifacts/rc5/p2/t11-slot-drift/web/template-stats.json`、`.../super/template-stats.json`
- `artifacts/rc5/p2/t11-slot-drift/web-boot.{stdout,stderr}.log`、`super-boot.{stdout,stderr}.log`（已脱敏）
- `artifacts/rc5/p2/t11-slot-drift/{web,super}/inventory.json`

注：conf 中 `unknown plugin row` 字面串在 rc.5 上游无生产者；真实告警面是 app-boot
`applyPatches` 的 `patch: entry "…" not found` / `patch insert: …` / `name mismatch`
（`@deepseek-ai/dsh-app-boot/lib/index.js:506-548`，`patchWarning` 于 3046-3050）。
本断言覆盖该真实面，而非只对文档字面串做空断言。