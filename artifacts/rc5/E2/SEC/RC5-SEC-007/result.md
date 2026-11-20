# RC5-SEC-007 · 个人 MCP HTTP：内网地址放行、元数据地址拒绝

- 套件：SEC
- 结论：**PASS**
- 开始/结束：2026-11-20T07:07:12.742Z / 2026-11-20T07:07:12.760Z

## 预期

http://10.0.0.1 接受；169.254.169.254 / fd00:ec2::254 拒绝

## 实际

internal=true meta4=false meta6=false

## 备注

- 内网地址放行是 51 明示的拍板项（H16 已知风险），不是缺陷
- lane 个人 MCP host 允许列表含 10.0.0.1（E2 .env.e2suite）；MCPP-011 用 a.example/b.example 另证白名单收紧能力
- 两条元数据地址（169.254.169.254 / fd00:ec2::254）由产品硬拒，不受允许列表影响

## 证据附件

- `cmd.log`

## 执行命令

```
$ POST /api/mcp-personal/upsert {url:http://10.0.0.1/mcp}（B）  # EXIT=200
$ POST /api/mcp-personal/delete（清理 internal-net）  # EXIT=200
$ POST /api/mcp-personal/upsert {url:169.254.169.254}（B）  # EXIT=200
$ POST /api/mcp-personal/upsert {url:[fd00:ec2::254]}（B）  # EXIT=200
```
