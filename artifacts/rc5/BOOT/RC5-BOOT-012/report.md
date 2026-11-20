# RC5-BOOT-012 — 浏览器加载 / client roster 完整（本地 PARTIAL，NOT green）

- 方式：A（浏览器加载）｜形态：E1 容器浏览器
- 结论：**PARTIAL — 本地覆盖花名册/工件半边；真实浏览器控制台的「版本不匹配」面
  deferred to W5，不标绿。**

## 本地已覆盖（真 boot + 活宿主取证）

```
PASS  BOOT-012 client roster complete: T36 9/10 mounted bundles + release
      — 78 boot entries, release 0.2.2-rc.5, access, attachments, brand, compaction,
        llm-doctor, memory, panel, prompt-studio, usage-stats
PASS  BOOT-012 client roster complete: T36 10/10 mounted bundles + release
      — 80 boot entries, release 0.2.2-rc.5, access, attachments, brand, compaction,
        llm-doctor, memory, panel, prompt-studio, usage-stats, workbench
```

判据：

1. `index.html` 注入 `__DSH_BOOT__`，其 `release.version` == 宿主 dsh 版本（0.2.2-rc.5）；
2. 花名册每个 entry 都有 `url` + `rev`；
3. 本形态挂载的 T36 产品包（web 9/10——workbench 为 super 专属；super 10/10）
   全部在花名册中，且各自 client bundle 取回 200 并含 `id: "@eterna/<pkg>"` factory 注册。

逐包证据（`slot-drift.json`）：

```
web   @eterna/{access,attachments,brand,compaction,knowledge-admin,llm-doctor,memory,
              panel,prompt-studio,usage-stats}  roster=true bundle=200
super 上述 10 包 + @eterna/{tasks,workbench}     roster=true bundle=200
```

## 未覆盖（deferred to W5）

- 真实浏览器加载后的控制台「版本不匹配」错误面：需要 E1 容器 + 浏览器会话，
  本地 Node 取证无法替代；容器内浏览器 E2E 归 W5。

## 证据

- `evidence.txt`
- `artifacts/rc5/p2/t11-slot-drift/{web,super}/slot-drift.json`（rosterEntry / bundleStatus）
- 双 boot 日志：`artifacts/rc5/p2/t11-slot-drift/{web,super}-boot.stdout.log`