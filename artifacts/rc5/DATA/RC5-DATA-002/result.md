# RC5-DATA-002 · E1 compose `/data` 绑定到测试数据根

- 依据：51 §3.14 DATA-002；48 §5.1 / §6.1 / §10
- 环境：E1 隔离容器 `eterna-rc5-e1`（3108，镜像 `5b10f5136403`，P5 创建，本轮未改）
- 生产容器 `eterna-agent`（3210）未触碰。

## 命令与实测

```bash
docker inspect eterna-rc5-e1 --format '{{json .Mounts}}'
# → /data: {"Type":"bind","Source":"/Users/sunny/eterna-data/test-rc5/e1","RW":true}

docker compose --env-file ~/eterna-data/test-rc5/.env.e1 -f docker-compose.yml config
# → volumes 段: source: /Users/sunny/eterna-data/test-rc5/e1 ; target: /data ; type: bind

env -u ETERNA_DATA_ROOT docker compose -f docker-compose.yml config
# → EXIT=0；/data 缺省落 $HOME/eterna-data/<实例>（docker-compose.yml:87-92 头注 W4 口径）

docker run --rm --network none --env-file <0600 临时 env（仅 dummy MIMO_API_KEY）> eterna-agent:rc5-test
# → EXIT=1；日志: "[entrypoint] FATAL /data 不是挂载点——数据会落容器层,拒启(48 §6.1)"
```

静态补充（本仓两份 compose 均由 `docker-compose.yml:92` / `docker-compose.super.yml:72` 以
`${ETERNA_DATA_ROOT:-$HOME/eterna-data}/<实例>:/data` 绑定；无 `external: true` 卷段）。

## 断言（7/7 PASS）

| 断言 | 实测 |
|---|---|
| /data 绑定源为测试根 e1 | `/Users/sunny/eterna-data/test-rc5/e1` |
| /data 挂载类型 bind | `bind` |
| /data 读写 | `true` |
| compose config 中 /data 为 bind 到测试根 | source/target 命中 |
| 无 ETERNA_DATA_ROOT 时 compose config 仍可用 | EXIT=0（W4 缺省口径，见 compose 头注） |
| 漏挂 /data 时 entrypoint 拒启 | EXIT=1 |
| 拒启日志含「不是挂载点」 | 命中 |

## 结论

**PASS**。绑定与路径不变口径成立；「漏挂即拒启」的 fail-closed 由 entrypoint 实测生效。
缺省值口径与 48 §5.1 的 `:?` 硬必填不同——这是 compose 头注记载的 W4 门禁修复（`docker-compose.yml:87-92`），
本 case 按现行实现判通过，风险由 entrypoint 预检兜底。