# RC5-BOOT-012 · 浏览器加载：10 个产品 bundle 与 roster

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-19T23:34:35.701Z / 2026-11-19T23:34:35.702Z

## 预期

10 个产品 client bundle 无“版本不匹配”错误；__ModuleLoader__ roster 完整

## 实际

release=0.2.2-rc.5/3f85d88；@eterna/* 恰好 10 个；entries=78（batch 1/58/19）；loader live、pendingQueue=0；页面无版本不匹配/加载失败提示

## 备注

- entry.rev 为各 bundle 内容哈希，与 boot.rev 不同属正常（逐一核对不构成 mismatch 判定面）

## 证据附件

- `RC5-BOOT-012-light-1440.png`
- `cmd.log`

## 执行命令

```
$ IAB 1440×900: window.__DSH_BOOT__ / window.__ModuleLoader__ 读取  # EXIT=0
$ DOM: 统计 @eterna/* 产品 client bundle 与“版本不匹配”提示  # EXIT=0
```
