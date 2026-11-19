# @eterna/knowledge-admin 安装与装配(内置单插件形态)

> 2026-11-19 知识底座融合后,本包是**唯一宿主**:装载 id 保持 `eterna-knowledge`,
> 显示名保持「知识底座」,不再是「另装一个知识库插件」;glue `knowledge-plugin` 已删除。

## 0. 安装形态

| 项 | 值 |
|---|---|
| 装载行 | `- id: eterna-knowledge` / `name: '@eterna/knowledge-admin'`(profile 模板 + web/super profiles 内 baked row) |
| Host 入口 | `exports["."] = ./src/index.ts`(Node 24 type-stripping;镜像内 `dist/` 仅排查用) |
| Client 入口 | `exports["./client"] = ./lib/client.js`(`dsh.client.platform = web`) |
| 升级 | 随镜像构建(`docker/entrypoint.sh` 把 `/repo/packages/knowledge-admin` symlink 进 profile 根) |

旧卷(PR #121 时代装过 bundle 的卷)由 `docker/entrypoint.sh` **幂等清理**:

1. 从 profile `package.json` 的 `dsh.profile.bundles` 移除 `@eterna/knowledge-admin`;
2. 从物化 patch 删除遗留 `- id: eterna-knowledge-admin` 块(缩进感知,遇同缩进兄弟行停);
3. `ln -sfn` 覆盖旧 workspace 副本指向 `/repo/packages/knowledge-admin`。

无需人工 `plugin_manager install_bundle`;设置卡「知识底座」的启停照旧(停止即整包不装载)。

## 1. 账号隔离如何成立(不新增登录)

```
浏览器面板 ──(1) ctx.connection.rpc.call('/api','knowledgeAdmin/<method>',{ args:{account,...} })
      │
      ▼
access 包 tenant.ts 守卫 register:  cookie → auth → store.getUserById(userId) → { account, admin, human:true }
      │  (2) 透传 { caller:{account,admin,userId,human}, args } 给服务面
      ▼
@eterna/knowledge-admin 服务: #sanitize(caller, args.account)
      │  (3) 解析分库路径(admin 缺省 = 全局库 `*`;普通账号恒本人)
      ▼
<tenantRoot>/<account>/knowledge.wiki + .eterna/knowledge.sqlite3   (普通账号)
<cwd>/knowledge.wiki + <cwd>/.eterna/knowledge.sqlite3               (管理员全局库)
```

关键纪律:unary SRC 通道 principal 恒 owner,插件**不能**从环境态判断调用者 —— 所以所有
读写端点都必须走 access 守卫 register,服务面只吃守卫组装好的 `caller`,并自己做账号兜底
(`#sanitize`,非 admin 且目标账号≠本人 → `forbidden`)。

Agent 工具面同源:工具执行上下文 → `agent.session.id` → 只读查询 access `users.db`
(`routing.ts`,不写库)→ caller;admin 目标缺省 `*`,普通账号本人;身份源缺席/解析失败
按 `mode` fail-closed(auto 无会话 → 全局库;per-account → 拒绝)。

## 2. 写入门禁(human 通道)

| 动作 | 面板(真人) | Agent/网关 |
|---|---|---|
| 单篇保存 | 直接发布(`state='approved'`) | 恒 pending(即使传 `publish:true`) |
| 审批/拒绝提案 | ✅ | ❌ `forbidden` |
| 批量导入 | pending,逐篇审批 | 同左 |
| 废弃 / 撤销 | ✅(30 分钟 undo_token) | 废弃可调,撤销不开放给 Agent |

`human` 字段只由 access 守卫铸出;网关 `LOCAL_CALLER.human=false`;路由 resolver
`human:false`。测试面:`tests/rig.ts` 的 `userCaller/adminCaller` 带 `human:true`,
`agentCaller` 带 `human:false`。

## 3. 验证

| 场景 | 命令/探针 |
|---|---|
| 包级自检 | `pnpm --filter @eterna/knowledge-admin verify`(build:client + render-smoke + oxlint + tsc + vitest) |
| 租户锚 | `node tools/packctl/bin/packctl.mjs tenant-scan`(`KNOWLEDGE_PERSIST_ANCHORS` 锚 5 个文件) |
| 容器静态 | `node scripts/verify-eterna-web.mjs` / `verify-eterna-super.mjs`(模板行名 + symlink + `lib/client.js`) |
| 容器运行 | `deploy/verify.sh` 8.5:登录后 `POST /api/knowledgeAdmin/overview` 期望 `ok:true` |

## 4. 红线复核(本插件实现口径)

- 不读取任何凭据文件;DeepWiki `bearerRef` 只作为 `ctx.get('credentials')` 的 record 键名,值不回显、不落日志。
- 不绕过工具管线直连 relay/web 端口;DeepWiki 探测走插件配置的 baseUrl(缺省 `http://127.0.0.1:8001`,属用户自建服务而非 Harness 内部端口)。
- 不代签:废弃文档返回 `undo_token` + `undo_hint`,撤销由人执行;不对外付款、签约、定标。
- 供应商比选无关本插件;不偏向任何供应商,DeepWiki 仅作为可配置来源之一。
- 多租户:只读查询 access `users.db`;权限表/审计落 `$DSH_HOME/knowledge-admin/`;
  知识库分库路径不变(`tenant-scan` 锚表强制)。