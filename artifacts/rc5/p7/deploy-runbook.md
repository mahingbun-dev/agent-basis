# 生产部署 Runbook · rc.5 上线（T56 执行单）

> 授权：用户 2026-11-21 00:28「不用等24小时了，直接进行接下来的流程」（push/PR/合并/部署一并授权）。
> 回滚：`p7/rollback-record.md` §3（情形 A/B/C）+ 冷备 `rc5-2026-11-20/…tgz`。
> 停机窗口目标 ≤ 5 分钟（80MB 数据拷贝 + 容器重建）。

## 0. 目标态

| 项 | 值 |
|---|---|
| 新镜像 | `eterna-agent:0.2.0-rc.5`（内核 `0.2.2-rc.5`），从**合并后 latest main** 构建 |
| 部署树 | `/Users/sunny/code/agent-basis-main-0.2.0-rc.5`（main 冻结副本，模式同 0.1.51） |
| 数据根 | `${ETERNA_DATA_ROOT}/super` = `/Users/sunny/eterna-data/super`（bind，0700；48 §7.3 自旧卷拷贝） |
| 旧态保留 | named volume `agent-basis_eterna-home` 不删；旧镜像 0.1.51 在本地；旧冷备在 backups |
| 端口 | 3210（web）/ 9310（companion relay）不变，NAS 反代无感 |

## 1. 合并前准备（无停机）

1. CI（PR #137）全绿 → merge。
2. `git clone …/agent-basis.git agent-basis-main-0.2.0-rc.5`（main 最新）；记录 merge commit sha。
3. `.env` 组装（**值不打印**）：从运行中容器 env 快照取
   `DEEPSEEK/MIMO/BIGMODEL/OPENDESIGN_API_KEY`、`ETERNA_PUBLIC_URL/TRUSTED_HOST/ACCESS_*/RELAY_*/MARKET_*`
   → 追加 `ETERNA_DATA_ROOT=/Users/sunny/eterna-data`、`ETERNA_INSTANCE=super`、
   `ETERNA_IMAGE=eterna-agent:0.2.0-rc.5`；chmod 600。
4. `mkdir -p /Users/sunny/eterna-data/super/.secrets && openssl rand -base64 32 > …/mcp-master-key && chmod 600`（个人 MCP 主密钥，fail-closed 缺它整面不挂载）。
5. `docker compose build`（新树；层缓存来自 rc5-test 构建，预计数分钟）→ `docker images` 记 digest。
6. 预检 `bash deploy/pre-restart-check.sh`（新树；静默窗 120s 内有活动则等待或用户已授权 FORCE）。

## 2. 停机窗口（≤5 分钟）

```sh
cd /Users/sunny/code/agent-basis-main-0.1.51
docker compose -p agent-basis stop          # 停机开始
# 冷备（停写窗口重做，48 §7.2；替代 rc5-2026-11-20 的活卷 tar）
docker run --rm --entrypoint sh -v agent-basis_eterna-home:/src:ro \
  -v "$HOME/eterna-data/backups/rc5-2026-11-21":/backup eterna-agent:0.1.51 \
  -c 'tar czf /backup/eterna-home-$(date +%Y%m%d-%H%M%S).tgz -C /src .'
# 数据迁出旧卷 → 宿主数据根（48 §7.3，tar 保符号链接）
mkdir -p "$HOME/eterna-data/super"
docker run --rm -v agent-basis_eterna-home:/src:ro -v "$HOME/eterna-data":/dst \
  eterna-agent:0.1.51 sh -c 'cd /src && tar cf - . | (cd /dst/super && tar xf -)'
du -sh /var/lib/docker/volumes/agent-basis_eterna-home/_data "$HOME/eterna-data/super"  # 比对
```

## 3. 起新栈（停机结束）

```sh
cd /Users/sunny/code/agent-basis-main-0.2.0-rc.5
docker compose -p agent-basis up -d
docker logs --tail 120 eterna-agent          # 关注 migrate-profile-bundles/mcp-servers 行
```

## 4. 验收（48 §7.5 + verify.sh）

1. `bash deploy/verify.sh http://127.0.0.1:3210` EXIT=0；
2. `docker exec eterna-agent dsh --version` = `0.2.2-rc.5`；
3. 三库 `PRAGMA integrity_check` ok（users.db / memory / knowledge）；
4. `.env` 保真：新旧容器逐 KEY 值哈希比对（凭据不打印）；
5. 登录管理员 → 会话列表/历史可打开（基线 193 会话）→ 设置三分区 → 已装插件 → 工坊快照；
6. 审计 jsonl 追加、`/data/relay-token` 原值不变、个人 MCP 设置页可用（主密钥在位）；
7. 重启容器后状态不丢（entrypoint 哈希门控）。

## 5. 收尾

- `p7/rollback-record.md` §7 填实际部署事件（非回滚则记「未触发」）；
- 发布说明补镜像 digest；`p7/deploy-record.md` 落实测；
- 旧卷保留 ≥7 天；上线后 24h 观察承担 24h 豁免残余风险。
