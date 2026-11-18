# @eterna/knowledge-admin 安装与装配(含未合并补丁)

## 0. 包的位置与形态

| 项 | 值 |
|---|---|
| 包目录 | `/data/workspaces/Mr.Ma/kh-admin-plugin/` |
| 包名 | `@eterna/knowledge-admin` |
| bundle 入口 | `cordis.patch.yml` → `- insert: [{ id: eterna-knowledge-admin, name: '@eterna/knowledge-admin' }]` |
| Host 入口 | `exports["."] = ./src/index.ts`(Node 24 type-stripping)/ `./dist/index.js`(esbuild 产物) |
| Client 入口 | `dsh.client` → `./lib/client.js`(`exports["./client"]`),`platform: web`,react 来自壳模块表 |
| 已自检 | `node scripts/build-client.mjs`(工厂 id/外层/语法/禁用 import)+ `node tests/render-smoke.cjs`(离线渲染整棵树、字典键完整、2 个 slot 注册) |

安装方式(需人工批准,本会话未执行):`plugin_manager` `action: install_bundle`,package 目录取上表绝对路径。

## 1. 账号隔离如何成立(不新增登录)

```
浏览器面板 ──(1) ctx.connection.rpc.call('/api','/api/knowledgeAdmin/<method>',{ args })
      │
      ▼
access 包 tenant.ts 守卫 register:  cookie → auth → store.getUserById(userId) → { account, admin }
      │  (2) 透传 { caller:{account,admin,userId}, payload } 给服务面
      ▼
@eterna/knowledge-admin 服务: accountAllowed(caller, payload.account)
      │  (3) 解析分库路径
      ▼
<tenantRoot>/<account>/knowledge.wiki + .eterna/knowledge.sqlite3   (普通账号)
全局库(admin 视角)                                                (管理员)
```

关键纪律:unary SRC 通道 principal 恒 owner,插件**不能**从环境态判断调用者 —— 所以所有
读写端点都必须走 access 守卫 register,服务面只吃守卫组装好的 `caller`,并自己做账号兜底
(`accountAllowed`,非 admin 且目标账号≠本人 → `forbidden`)。

## 2. 仍需人工合并的两处补丁(本会话沙箱不可写 /repo,已交付可粘贴代码)

### 2.1 access 守卫端点(17 个)
- 交付:`../plugins-test/knowledge-admin-access/tenant-kademin.insert.md`
- 插入点:`/repo/packages/access/src/tenant.ts` A 处 `:23` import 后; B 处 `:562` `/api/eternaPanel/snapshot` 块之后
- 内容:`/api/knowledgeAdmin/<method>` × 17 的 register 块 + 写类 7 方法的 `tenantAudit` 留痕
- 已验证:片段插入 tenant.ts 副本后 strict tsc 0 error;既有套件回归与未打补丁基线逐项相同

### 2.2 glue 装配(DeepWiki 源 / 管理面挂载 / 权限感知 access face)
- 交付:`../plugins-test/glue-patch/glue-knowledge-config.patch.md` + `.diff`
- 插入点:`packages/glue/src/types.ts` 183 行后、`src/plugins/knowledge-plugin.ts` 29/34/178–181/183/190–192 行
- 已验证:片段 tsc 0 error、自测 29/29、整包影子 tsc 0 error、整包 vitest 与基线逐位相同(零新增失败)

## 3. 未合并时的行为(诚实降级)

| 缺席项 | 表现 |
|---|---|
| access 守卫端点为合并 | 面板 RPC 得到 404 → 面板显示「知识库管理服务未挂载」(不假装成功、不回退全局库) |
| glue 装配未合并 | 无 DeepWiki 源增强、`knowledge-accounts` 无权限感知;检索仍走 `@eterna/knowledge` 单路 |
| `@eterna/knowledge` 服务缺席 | `search` 降级为目录关键词匹配并在 `degraded` 里写明原因 |
| DeepWiki 不可达 | `testSource` 报 `unreachable`;`search`/`ask` 的 `degraded` 列出原因,不影响本地结果 |
| 模型网关未配置 | `ask` 返回 `{ok:false, code:'unavailable', message:...}`,面板显示「问答不可用:…」,**不编造答案** |

## 4. 红线复核(本插件实现口径)

- 不读取任何凭据文件;DeepWiki `bearerRef` 只作为 `ctx.get('credentials')` 的 record 键名,值不回显、不落日志。
- 不绕过工具管线直连 relay/web 端口;DeepWiki 探测走插件配置的 baseUrl(缺省 `http://127.0.0.1:8001`,属用户自建服务而非 Harness 内部端口)。
- 不代签:废弃文档返回 `undo_token` + `undo_hint`,撤销由人执行;不对外付款、签约、定标。
- 供应商比选无关本插件;不偏向任何供应商,DeepWiki 仅作为可配置来源之一。
