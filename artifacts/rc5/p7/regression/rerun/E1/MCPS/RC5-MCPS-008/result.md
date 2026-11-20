# RC5-MCPS-008 · 旧 profile 的 mcp-manager.config.servers 迁移（幂等）

- 套件：MCPS
- 结论：**SKIP**
- 开始/结束：2026-11-20T01:41:33.816Z / 2026-11-20T01:41:33.817Z

## 预期

按 51 用例定义执行

## 实际

未执行：MCPS-006 越权红（普通用户可 restart/probe 全局 server）触发套件停止

## 备注

- 中止原因=RC5-MCPS-006: 普通用户 restart/probe 必须被拒
- 按派发规则「越权用例红 → 停止该套件」，不再继续标绿

## 证据附件

- `cmd.log`
