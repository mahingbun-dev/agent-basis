# RC5-ACP-009 文档引文（由驱动自动摘录）

## trusted-stdio

口径：文档明确 ACP 是受信 stdio 面/受信控制器，不是 Web 功能

- `deploy/README.md:288` — ACP 是**自动化客户端的受信 stdio 面**，不是 Web 功能（47 B17 / 49 §5.7）：
- `docker-compose.yml:104` — # ACP 是自动化客户端的**受信 stdio 面**,不是 Web 功能:

## trusted-operator-only

口径：明确仅可信操作员/本机驱动，不暴露公网/端口

- `docs/design/47-上游DSH-0.2.2-rc.5合并评估与开发方案.md:1186` — **只允许管理员/运维在本机启动，不暴露端口、不接终端用户**；

## no-tenant-isolation

口径：明确 ACP 是无租户隔离的受信面，可读全部租户数据

- `docs/design/49-上游rc.5合并总设计.md:345` — **结论**：ACP 是唯一“无租户隔离”的受信面；其余所有新能力都必须落在

## shared-data-root

口径：明确与 web 共享 /data（跨租户数据可读）

- `deploy/README.md:294` — `stdin_open: true`、`tty: false`、**无 ports**，与 web 共享同一 `/data` 实例根；
- `docs/docker-deploy.md:35` — ACP 是独立 stdio service（`profiles: ["acp"]`，无端口），与 web 共享同一 `/data` 实例根，

