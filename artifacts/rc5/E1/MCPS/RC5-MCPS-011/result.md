# RC5-MCPS-011 · 模板变更重渲染保留 servers（H9，P0）

- 套件：MCPS
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:07.800Z / 2026-11-20T07:03:23.783Z

## 预期

模板变更触发重渲染后 servers 保留；失败路径留 0600 备份；模板/渲染可回基线

## 实际

见 RC5-MCPS-011/result.md（单测+真实 entrypoint 重渲染）

## 备注

- P0：渲染哈希变化证明重渲染发生；模板恢复后渲染回基线

## 证据附件

- `../../MCPS/RC5-MCPS-011/result.md`
- `cmd.log`

## 执行命令

```
$ node artifacts/rc5/E1/MCPS/mcps-011.mjs（模板重渲染集成腿）  # EXIT=0
```
