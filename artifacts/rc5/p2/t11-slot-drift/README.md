# T11 / P2 出口验收 — 双 boot + slot drift + BOOT-004..012 + MCPS-008/011

- 工作树：`/Users/sunny/code/agent-basis-rc5`，分支 `feat/dsh-rc5-merge`
- HEAD：`02f485788411b9aed1938a3c4b009793a090961e`
- 结论：**双 boot EXIT 0；web 229 / super 235 host entries；43 blocks / 40 overrides /
  0 unknown；stderr 无 `disabling profile plugin`；slot drift 0 缺失 / 0 多出。**
- BOOT-004/005/006/007 本地 PASS，BOOT-012 花名册半边 PASS（浏览器控制台面 deferred
  W5）；BOOT-008/009/010/011 deferred to W5（容器旧卷/E1），其中 BOOT-011 发现
  **`DSH_AGENTS_HOME` 未落地的 P0 缺口**。MCPS-008 本地 PASS；MCPS-011 本地 H9
  机制 11/11，容器端到端 deferred W5。

> 本文只记录本会话实际执行的命令与读取的文件。未跑的面明确标 deferred，不标绿。

---

## 1. 双 boot（独立临时 home，不连生产）

```bash
cd /Users/sunny/code/agent-basis-rc5
ETERNA_PROFILE_HOME=$(mktemp -d /tmp/eterna-web-home.XXXXXX) \
  ETERNA_EVIDENCE_DIR=artifacts/rc5/p2/t11-slot-drift/web \
  node scripts/verify-eterna-web.mjs          # EXIT=0
ETERNA_PROFILE_HOME=$(mktemp -d /tmp/eterna-super-home.XXXXXX) \
  ETERNA_EVIDENCE_DIR=artifacts/rc5/p2/t11-slot-drift/super \
  node scripts/verify-eterna-super.mjs        # EXIT=0
```

关键断言（两形态各一条，均在 stdout）：

```
PASS  host entry count = 229 / 235
PASS  template shape: 43 blocks = 3 insert + 40 override
PASS  template overrides: 40/40 resolve in live host tree (0 unknown)
PASS  boot stderr clean (no disabling profile plugin)
PASS  BOOT-004 unknown plugin row count = 0
PASS  BOOT-005 deleted rows absent (account-controller, office-to-pdf)
PASS  BOOT-006 rc.5 new rows present+active (9)
PASS  BOOT-007 preset-standard restatement retains rc.5 default rows
PASS  slot drift: all 26/32 declared slot keys hit the live host slot catalog (116 slots)
PASS  slot drift: 10/12 mounted packages — declared == served (no missing / no extra)
PASS  slot drift: every mounted slot-declaring package has a __ModuleLoader__ entry
PASS  BOOT-012 client roster complete: T36 9/10 (web) / 10/10 (super)
```

`43 blocks` 的实测行数：web 1058 行、super 1090 行；`40 overrides` 全部命中活体
Loader 树（`40/40`），0 unknown。

---

## 2. slot drift（T11 §4.11 硬约束）

实现（仅改 verify 脚本，未改产品源码）：

1. **声明面**：扫描 `packages/*/src/client/**/*.{ts,tsx,js,jsx}`，先剥离注释，再取
   `slots.inject('<key>'` 字面量（`enumerateDeclaredSlots`）。共 12 个包、
   web 形态 26 / super 形态 32 个声明槽位。
2. **活契约**：boot 后从 `__DSH_BOOT__` 取 `@deepseek-ai/dsh-cordis-client-runner`
   的独立 URL，在浏览器实收的 client bundle 里用括号配对切出
   `CLIENT_SLOT_API=[…]`，得到 **116 个槽位**（活宿主编译期契约）。
3. **实收面**：取每个 `@eterna/<pkg>` entry 的独立 bundle URL（HTTP 200），
   提取其中 `slots.inject(…)` 字面量，与源码声明面做**集合相等**比对。
4. **挂载面**：只在活体 `pluginInventory/list` 里出现 `moduleName=@eterna/<pkg>`
   （或子插件）的包参与断言；未挂载包显式 `SKIP`，不冒充通过。

| 形态 | 参与包 | 声明槽位 | 活契约命中 | 缺失 | 多出 | 花名册 |
|---|---:|---:|---:|---:|---:|---|
| web | 10 | 26 | 26/26 | 0 | 0 | 10/10 |
| super | 12 | 32 | 32/32 | 0 | 0 | 12/12 |

族别计数（super）：`settings.section=4`、`conversation.*=10`、`plugins.tab=2`。
逐包报告见 `web/slot-drift.json`、`super/slot-drift.json`。

> 说明：`settings.section` 等键在多个包内重复登记（不同 id），族别计数按
> 「包×键」计；「声明槽位」同包内去重。

---

## 3. BOOT-004..012 / MCPS-008/011

| 用例 | 本地状态 | 位置 |
|---|---|---|
| RC5-BOOT-004 未知行 0 | **PASS**（双 boot） | `artifacts/rc5/BOOT/RC5-BOOT-004/report.md` |
| RC5-BOOT-005 删除行不存在 | **PASS**（双 boot） | `.../RC5-BOOT-005/report.md` |
| RC5-BOOT-006 新增行全在 | **PASS**（双 boot） | `.../RC5-BOOT-006/report.md` |
| RC5-BOOT-007 preset 无丢行 | **PASS**（双 boot） | `.../RC5-BOOT-007/report.md` |
| RC5-BOOT-008 旧卷追加一次 | **DEFERRED W5** | `.../RC5-BOOT-008/report.md` |
| RC5-BOOT-009 opt-out 不回加 | **DEFERRED W5** | `.../RC5-BOOT-009/report.md` |
| RC5-BOOT-010 坏 manifest | **DEFERRED W5** | `.../RC5-BOOT-010/report.md` |
| RC5-BOOT-011 DSH_AGENTS_HOME | **DEFERRED W5 + P0 缺口** | `.../RC5-BOOT-011/report.md` |
| RC5-BOOT-012 浏览器 roster | **PARTIAL**（花名册 PASS；控制台 deferred W5） | `.../RC5-BOOT-012/report.md` |
| RC5-MCPS-008 migrate servers | **PASS**（CLI + 12/12 单测） | `artifacts/rc5/MCPS/RC5-MCPS-008/report.md` |
| RC5-MCPS-011 H9 保 servers | **本地 11/11**；容器端到端 **DEFERRED W5** | `artifacts/rc5/MCPS/RC5-MCPS-011/report.md` |

---

## 4. 发现

1. **P0｜`DSH_AGENTS_HOME` 未落地**：设计（48 §6.2 :386-393、54 :117）要求容器内
   `/data/agents`；`Dockerfile:75` 只有 `DSH_HOME=/data`，entrypoint/compose 均无
   该 env。上游 `skill-filesystem` 缺省回落 `~/.agents`（`src/index.ts:55-56,167,264`），
   用户级 skills 会落容器层。产品文件不属本 lane 可改范围 → leftover。
2. **观察（非产品缺口）**：首次 super 运行撞上并行 lane 半写
   `packages/access/src/mcp-personal-runtime.ts`（mtime 02:30），boot stderr 出现
   `ERR_INVALID_TYPESCRIPT_SYNTAX ... mcp-personal-runtime.ts:302` → `eterna-access
   failed to import`，`enabled/no-fiber`。该次日志被重跑覆盖；该文件随后又被改了一次
   （mtime 02:36）。最终两次 boot 均在**整树 digest 稳定**的条件下执行：
   `packages/**(src|client.js) + docker/profile + profiles` 的聚合 sha256
   `af2d82d8…b307d92` 在每次运行前后相同（见 `commands.txt` / `source-hashes.txt`），
   结果 EXIT=0。建议 T11 门禁运行时冻结并行写产品源码。

---

## 5. 证据索引

- `commands.txt`：命令原文、git HEAD、EXIT、源码/模板 sha256、瞬态说明
- `web-boot.{stdout,stderr}.log`、`super-boot.{stdout,stderr}.log`（已脱敏 `token=<redacted>`）
- `web/`、`super/`：脚本落盘的 `inventory.json`、`template-stats.json`、
  `preset-standard.json`、`slot-drift.json`、脱敏 boot 日志
- `source-hashes.txt`：`packages/access/src/mcp-personal-runtime.ts` 与
  `packages/access/lib/client.js` 的运行前哈希
- `artifacts/rc5/BOOT/**`、`artifacts/rc5/MCPS/**`：逐用例 `report.md` + 原始输出

## 6. 边界声明

- 未连接/未停止生产容器；未 git push/merge；未改产品源码/模板；未写
  `/Users/sunny/code/deepseek-harness` 与 `/Users/sunny/code/agent-basis`。
- 只改 `scripts/verify-eterna-web.mjs`、`scripts/verify-eterna-super.mjs` 与证据目录。
- 证据中的 token 已统一替换为 `<redacted>`；MCP 夹具只含 `token-placeholder` 占位值。