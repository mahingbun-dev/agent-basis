# RC5-MCPP-011 · personalHttpHosts 白名单：b.example 拒 / a.example 过

- 套件：MCPP
- 结论：**SKIP**
- 开始/结束：2026-11-19T23:53:24.952Z / 2026-11-19T23:53:25.744Z

## 预期

配置 personalHttpHosts:[a.example] 时前者拒、后者过

## 实际

单测 `personalHttpHosts 空=放行;非空=白名单且支持 *.suffix` 绿；但本容器未以该白名单启动，未做容器实跑 → 记 SKIP（不以单测冒充容器结论）

## 备注

- 容器默认 httpHosts=[]（全放行），见 MCPP-010/007；白名单实跑需要另一实例环境，未在本 lane 执行

## 证据附件

- `cmd.log`

## 执行命令

```
$ pnpm --filter @eterna/access exec vitest run tests/mcp-personal-routes.spec.ts -t personalHttpHosts  # EXIT=0
```
