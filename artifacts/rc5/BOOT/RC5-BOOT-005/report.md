# RC5-BOOT-005 — 已删除行不存在（local PASS）

- 方式：S（真 boot）｜形态：web + super
- 结论：**PASS（本地双 boot 覆盖）** — `account-controller`、`office-to-pdf` 在
  宿主树与全部 preset 组合中均不存在。

## 断言

```
PASS  BOOT-005 deleted rows absent (account-controller, office-to-pdf) — absent in host tree and every preset
```

## 活体快照查询（证据）

```
web   account-controller host=absent preset=absent
web   office-to-pdf      host=absent preset=absent
super account-controller host=absent preset=absent
super office-to-pdf      host=absent preset=absent
```

## 证据

- `evidence.txt`（命令 + 断言 + 上述查询）
- `artifacts/rc5/p2/t11-slot-drift/{web,super}/inventory.json`（pluginInventory/list 活体快照）
- 双 boot 日志：`artifacts/rc5/p2/t11-slot-drift/{web,super}-boot.stdout.log`

补充：模板里已无这两行的覆写块。全文 grep 命中 4 处，全部是注释说明
（web 模板 :73/:133，super 模板 :75/:135）；40 条 override 行 id 中不含
`account-controller` / `office-to-pdf`，因此 dead-row 不会以「absent 即通过」假绿。