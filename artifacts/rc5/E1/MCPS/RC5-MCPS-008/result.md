# RC5-MCPS-008 · 旧 profile 的 mcp-manager.config.servers 迁移（幂等）

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:00.703Z / 2026-11-20T07:03:00.908Z

## 预期

旧 patch 的 servers 合并进新渲染 patch；重复执行不重复写；坏 YAML fail-closed

## 实际

unit=true 幂等用例命中=true

## 备注

- 自动化 lane（51 标注 A）：直接跑迁移脚本单测，覆盖合并/幂等/坏 YAML 留痕

## 证据附件

- `cmd.log`

## 执行命令

```
$ node --test docker/profile/migrate-mcp-servers.test.mjs  # EXIT=0
```
