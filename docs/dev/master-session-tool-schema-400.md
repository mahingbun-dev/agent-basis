# 主会话 400 INVALID_REQUEST：工具参数 schema 根因与修复（2026-11-19）

## 1. 现象

生产 3210（0.1.47，super 形态）从工作台进入主会话 `orchestrator-Mr.Ma`，首轮对话
直接失败，UI 显示：

```
请求失败 (400)
{"code":"400","message":"Invalid request parameters","param":"","type":"BadRequestError"}
```

无任何助手输出，重试同样失败；普通会话可正常对话。

## 2. 根因

宿主 `ToolDefinition.parameters` 是自由 `Record<string, unknown>`：注册与请求链路都不做
JSON Schema 结构校验，原样进 provider 请求。若工具用「裸 properties 映射」写法：

```ts
parameters: {
  plugin: { type: 'string', required: true, description: '...' },
  title: { type: 'string', description: '...' },   // ← 撞名
  description: { type: 'string', description: '...' },
}
```

顶层键 `title` / `description` 与 JSON Schema **注解关键字**同名，provider 把整个映射
误读为 schema 注解而非参数定义 → 拒绝整个请求。`submit_plugin_to_market`
（`packages/access/src/publish-tool.ts`）正是此写法，且 super 形态把它挂在所有会话的
工具目录里，所以主会话首轮必炸。

### 取证（隔离实例 + 真实 MiMo）

| 载荷 | 结果 |
| --- | --- |
| 只挂 `submit_plugin_to_market` | 400 Invalid request parameters |
| 只挂 `install_personal_plugin` | 200 |
| 只挂个人插件 `hello-market`（同样裸映射） | 200（当时恰好未触发同名键组合） |
| 全量 70 工具 + 上述三处 schema 规范化 | 200 |

会话日志确认失败回合在请求期即被拒，未落任何模型输出。

### 为什么 0.1.47 仍会复现（重要）

同类修复 `a08b03f`（0.1.38 镜像）确实做过，但它在 `fix/tool-schema-object-root`
支线上**从未合并进 main**（`git merge-base --is-ancestor a08b03f origin/main` 返回
非零）。此后 0.1.45 / 0.1.46 / 0.1.47 都按 main 重建，修复随之丢失，缺陷在 0.1.47
重新出现在生产。本次修复合并为 `b93e592` 进入 main，并把个人插件模板/参考文档一并
改为对象根写法，避免再走一遍支线热修——**镜像级热修必须落 main，否则下一次按 main
重建即回退**。

### 其他被本次带入的加固

- `packages/brand/skills/cordis-plugin-development/references/personal-tools.md`：
  明确要求 `parameters` 写对象根 JSON Schema；说明转内置/bundle 不经装载器。
- 同目录 `templates/personal-tool/index.js`：模板从裸映射改为
  `{ type:'object', properties, required }`。

## 3. 修复

- 新增 `packages/access/src/tool-schema.ts`：
  `normalizeToolParameters(parameters)` 把裸映射收敛为
  `{ type: 'object', properties, required }`；属性级 `required: true` 上提到根
  `required` 数组并从属性定义中移除；已是规范 schema（`type` 为字符串/数组，或
  `$schema` 在场）**原样返回**，不重排、不增删。
- `packages/access/src/tenant-plugins.ts`：个人/共享工具插件装载时统一归一化——
  插件作者写裸 schema 不再能炸整个会话（装载面兜底）。
- `install-tool.ts` / `publish-tool.ts`：两处手写 schema 改为规范形态。
- 测试：`tests/tool-schema.spec.ts` 6 例（含参数名恰为 `type` 的边界）；
  `tests/tenant-plugins.spec.ts` 增加裸映射挂载 1 例。

## 4. 验证

- `@eterna/access` verify：41 文件 / 390 用例全绿；`lint-ui-tokens`：17 目录
  276 文件 0 债务；`packctl form-check`：0 发现。
- 隔离容器（独立卷、同镜像、真实 MiMo key）复现原路径：工作台 → 主会话 → 发送
  「请用一句话说明你能做什么」，5 秒完成真实回复，徽标「主控」，无
  INVALID_REQUEST；委派提示词「帮我调研本产品所有插件的作用」同样正常完成（51 秒）。
- PR **#130** squash 合并为 `b93e592`；CI `verify` / `upgrade-gate` 全绿。

## 5. 部署（0.1.48，2026-11-19 已上线 3210）

1. 干净 worktree `agent-basis-main-0.1.48` @ `b93e592` →
   `eterna-agent:0.1.48`（image id `8e9ddd5612cc`）。
2. 隔离 boot 探针：`/repo/packages/access/src/tool-schema.ts` 在、`tenant-plugins.ts`
   两处归一化引用、`packages/tasks/lib/client.js` 在、super profile 链与 patch 行
   `eterna-tasks`(642)/`eterna-tasks-access-bridge`(654) 在，healthy。
3. `pre-restart-check.sh` 静默窗通过 → compose `image: eterna-agent:0.1.48`
   → `docker compose -p agent-basis up -d`（不 `--build`，数据卷不变）。
4. `deploy/verify.sh`：**14 过 / 0 败**。
5. 只读探针：`GET /access/api/tasks/session-roles` 200
   （`masterId=orchestrator-Mr.Ma`）；`GET /access/api/tasks/settings` 200
   （realm `Mr.Ma`、`policyVersion=565427af…` 未变，设置跨重建持久）。
6. 隔离测试容器 `eterna-agent-fixtest` / `eterna-agent-0148-probe` 与对应卷已删除。

**回滚**：compose `image` 改回 `eterna-agent:0.1.47`
（image id `sha256:fa76f0ca047a…`）→ `docker compose -p agent-basis up -d`；数据卷不变。

## 6. 纪律沉淀

- 手写工具 schema 一律用规范形态；裸映射只允许作为兼容输入，装载面必须归一化。
- 新增工具后，任何 provider 400 先做「单工具二分」：逐个挂载定位触发者，再对照
  JSON Schema 注解关键字（`title` / `description` / `default` / `examples` …）。
- 主会话是工具目录最全的会话，任何工具 schema 缺陷都会先在那里暴露。