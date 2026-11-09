# 主计划书：EternaAgent 账号门禁 + 工作区隔离 + 插件启停治理（v2）

> 生成：2026-11-09 ｜ 状态：**待用户开发令**（用户指令：先出全量详细计划，反复审核可行性与遗漏，决定后再开发）
> 修订：v2 重构——吸收 §3-b 用户决策、§3-c 隔离探索、三轮审核发现（§8 审核记录）

## 1. 一句话目标（分期）

| 期 | 目标 | 可验收形态 |
| --- | --- | --- |
| Phase 1 | 账号门禁基座：登录/登出 + 管理员用户管理 + 用户自助配置页 | 陌生人只见登录页；admin 增删用户；用户改昵称/头像/密码；全程审计 |
| Phase 2 | 工作区按账号隔离（进程内桥模型优先，多实例为回退） | A/B 用户互不可见工作区/会话；picker 钳制在各自根内 |
| Phase 3 | 插件启停治理：红线外全可启停（用户决策）+ 插件开发铁律 | 用户启停即时生效；后续插件无法绕过隔离（规范+lint 强制） |
| Phase 4 | 总验收：隔离 E2E 矩阵 + 文档 + 发布 | 全矩阵绿；README/docs 同步；CI 双分支绿 |

## 2. 背景与现状

- 当前 Web 唯一鉴权 = dsh 一次性 launch token（`?token=…` 换签名 cookie），token 打印在容器日志、无用户概念、无撤销——公网域名暴露场景不可接受。
- dsh 是**单 owner 单 Peer** 运行时（`Principal` 仅 `owner`；所有浏览器共享同一签名 cookie）——进程内原生无法区分请求归属用户，这是隔离设计的中心约束。
- 容器内已实测：每用户独立实例 RSS≈426MB（主实例 298MB）→ 多实例模型内存代价大（用户明确希望避免）。

## 3. 已确认决策汇总（访谈+问答全记录）

| # | 决策 | 来源 |
| --- | --- | --- |
| D1 | 不开放注册；只有管理员可添加/删除用户 | 用户 2026-11-09 |
| D2 | 管理员 env 预置：`ETERNA_ACCESS_ADMIN_USER=Mr.Ma` / `ETERNA_ACCESS_ADMIN_PASSWORD`（真值只入 gitignored `.env`；表空时播种，改密走 UI 后 env 可删） | 用户 2026-11-09 |
| D3 | 用户自助：改昵称、换/重置头像、改密码（完整配置页 `/account`） | 用户 2026-11-09 |
| D4 | 添加用户默认：昵称=账号、头像=昵称首字符色块 | 用户 2026-11-09 |
| D5 | 账号规则 `[A-Za-z0-9_.-]{2,32}`（兼容 Mr.Ma），区分大小写，全表唯一 | 计划审定 |
| D6 | 工作区按账号隔离：配置/插件启用/子工作区/会话数据全隔离；管理员权限、用户账号管理、插件源为公共面 | 用户 2026-11-09 |
| D7 | 隔离优先探索**进程内插件化**方案（多实例内存代价大）；多实例为回退 | 用户问答 2026-11-09 |
| D8 | 插件启停边界：**红线（治理/审计）外全可启停**；安装/移除仅管理员 | 用户问答 2026-11-09 |
| D9 | 复用 workspace 机制做隔离时，子工作区以「账号根下路径嵌套」呈现，不改 workspace.json 数据模型；用户列表与单 owner 同构 | 用户关切+设计回应 2026-11-09 |
| D10 | 流程纪律：先全量计划+反复审核，用户开发令后再动工 | 用户 2026-11-09 |
| D11 | 管理员添加用户遇重名：**自动追加数字后缀**（从 01 起递增，如 `zhangsan`→`zhangsan01`→`zhangsan02`）；不再返回「账号已存在」错误 | 用户 2026-11-09 |

## 4. Phase 1：账号门禁基座（任务分解）

### 4.0 架构（已实测定案的 seam）

```text
浏览器 ── GET /login|/account|/admin/users ──▶ WebServer.register 精确路由(eterna-access,服务端渲染页)
        ── POST/DELETE /access/api/* ────────▶ /access/api 前缀路由(会话校验/角色校验/同源检查/限速)
        ── 登录成功 302 ─────────────────────▶ ctx.connection.authenticatedUrl('/') → dsh BrowserAuth 铸共享 cookie
        ── 页面右上角标 ─────────────────────▶ tapIndex 注入脚本(fetch /access/api/me → 401 则 location='/login')
持久化: users.db(node:sqlite WAL)+secret.key(0600) 落 DSH_HOME/access/(卷)
审计:   ctx.audit 机会读取(audit-bridge 模式,audit 缺席降级不阻塞登录)
```

**端点表（Phase 1 交付面）**：

| 方法+路径 | 权限 | 行为 |
| --- | --- | --- |
| GET /login | 公开 | 登录页（已登录→302 authenticatedUrl('/')） |
| POST /login | 公开（限速） | 验号验密→Set-Cookie→302 桥接；失败 401（不区分账号不存在/密码错）；429 限速 |
| POST /logout | 已登录 | 清 eterna_session→302 /login |
| GET /account | 已登录 | 配置页（昵称/头像/密码三卡） |
| GET /admin/users | admin | 用户管理页（列表/添加/删除） |
| GET /access/api/me | 已登录 | `{account,nickname,role,avatarUrl?}` |
| POST /access/api/nickname | 已登录 | 改昵称（1-32 字符） |
| POST /access/api/password | 已登录 | 验旧密→改新密（≥8 位） |
| POST /access/api/avatar | 已登录 | 上传 dataURL（白名单 png/jpeg/webp/gif，≤256KB，**禁 SVG**） |
| DELETE /access/api/avatar | 已登录 | 重置为字母头像 |
| GET /access/api/avatar/:id | 已登录 | 头像字节（存储 mime，`Cache-Control: private`） |
| GET /access/api/users | admin | 用户列表（无哈希/无头像字节） |
| POST /access/api/users | admin | 添加用户（role 可选 admin；默认昵称=账号；**重名自动后缀 D11**：候选序列=基名、`基名01`、`基名02`…跳过已占用，取第一个可用；响应返回最终账号供 UI 展示） |
| DELETE /access/api/users/:id | admin | 删用户（护栏：不能删自己/最后一个 admin，store 层事务强制） |

**env 契约**：`ETERNA_ACCESS_ADMIN_USER`/`ETERNA_ACCESS_ADMIN_PASSWORD`（播种）、`ETERNA_ACCESS_SECRET`（可选，设置后文件密钥失效=全会话下线，文档明示）、`ETERNA_ACCESS_SECURE=1`（反代 TLS 下 Secure cookie）、`ETERNA_ACCESS_DIR`（默认 `$DSH_HOME/access`）。

### 4.1 任务表

| # | 任务 | 依赖 | 产出 | 验收标准 |
| --- | --- | --- | --- | --- |
| T1.1 | 类型面 spike：alpha.3 实读（authenticatedUrl/register/intercept/inject 名单/webServer 增广） | 无 | 结论已入 §10 | ✅ 已完成 |
| T1.2 | 包骨架 `packages/access`：package.json（**补 `dsh.bundle.patch` 声明对齐 panel/glue 形态**）/catalog 钉版/patch.yml/tsconfig | T1.1 | 骨架 | `pnpm verify` 过 |
| T1.3 | `password.ts`：scrypt 哈希/校验+账号/密码策略 | 无 | 模块 | spec：哈希可验/错密拒/策略拒/Mr.Ma 形态过 | 
| T1.4 | `store.ts`：users 表+WAL+播种+CRUD+删除护栏+**重名自动后缀生成器（D11）** | T1.3 | 模块 | spec：唯一约束/播种幂等/删自己拒/末位 admin 拒/改密验旧/**后缀序列：`zhangsan` 在场→建 `zhangsan01`；`zhangsan01` 被手工占用→跳到 `zhangsan02`；两位满进三位（`…99`→`…100`）** |
| T1.5 | `session.ts`：HMAC cookie+密钥文件(0600)/env 双源+Secure；**载荷含密码版本号 pwv**——改密/admin 重置密后旧会话全部失效（无状态 HMAC 的吊销原语） | 无 | 模块 | spec：防伪/过期/轮换失效/resolveUser/**改密后旧 token 拒** |
| T1.6 | `routes.ts` 纯核心+node 适配：§4.0 端点表全量；同源规范化比对（忽略默认端口）；限速（每 ip+账号 5/min + 每 ip 全局 30/min；**ip 取 XFF 首值，反代场景可信假设文档化**）；**登录失败也出审计事件**（暴力破解可见性） | T1.3-T1.5 | 模块 | spec：未登录 401/非 admin 403/限速 429/跨源 403/SVG 头像拒/超限 413/改密后旧 token 401/失败登录有审计 |
| T1.7 | `pages.ts`：登录/配置/管理三页（恒灵品牌内联 CSS/JS）+ 角标脚本（tapIndex） | T1.6 | 页面模块 | spec：三页渲染含关键 DOM/角标含 401 跳转分支 |
| T1.8 | `plugin.ts` 装配：`defineAccessPlugin`（inject `['webServer','connection']`、惰性 connection、审计桥、路由注册、tapIndex、配逆闭包） | T1.6-T1.7 | 插件模块 | 类型编译过+宿主挂载零 warning |
| T1.9 | 挂载收编：patch 模板 insert 行 + entrypoint symlink(access) + compose env 透传 + `.env.example` 占位 + **`.env` 真值(D2)** + docs/docker-deploy.md(env 矩阵+登录流+可选 nginx `error_page 401 =302 /login` 配方) + USER-GUIDE + README/zh-CN（能力清单+测试数联动） + eterna-plugin-mapping.md | T1.8 | 部署+文档全量 | 容器重建后插件激活零 warning；grep 日志不再出现 token 指引 |
| T1.10 | E2E（control-browser）：①匿名 /→裸 401（或 nginx 配方后→/login）②admin 登录落地对话 ③添加用户（默认昵称/字母头像）④新用户登录+改昵称+传头像+重置头像+改密 ⑤旧密失效新密可登 ⑥非 admin 访问 /admin/users 被拒 ⑦admin 删用户→其会话失效 ⑧登出→受保护页全部弹回 /login ⑨审计 jsonl 七类事件 ⑩错密 5 次→429 | T1.9 | E2E 记录 | 十项全过 |
| T1.11 | 收尾：全仓 verify（README 测试数更新）、CI 双分支绿、提交（**push 单独确认**） | T1.10 | 提交 | main+dev 双绿 |

**已预写文件（冻结待令）**：`packages/access/src/{password,store,session}.ts` + `package.json`/`tsconfig.json`/`cordis.patch.yml` + catalog 两行 alpha.3 钉版——与 T1.3-T1.5 对应，待令后补 spec 并继续。

## 5. Phase 2：工作区按账号隔离（模型 A 进程内桥 → 模型 B 多实例回退）

### 5.0 模型 A：进程内端点守卫（用户方案，2026-11-09 定稿——「后端按用户信息返回有权限的内容」）

```text
浏览器调用 / 网页点击 / 控制台直连 ──POST /api/<端点>──▶ 组合层 prefix 路由 '/api'(rc.1 index.ts:141-158)
  → admit(dsh cookie→共享 peer) → bridge → fetchHandler.fetch
  → fetchRoutes.get(完整路径名) 实时查询(alpha.3 index.js:820-832,先于端点分发)
  → 命中守卫路由: 读 eterna_session 归属用户 → 改写载荷/校验归属/过滤响应 → 执行真实逻辑并回框 RPC 信封
  → 未注册端点 = 公共面直通(D6: 模型设置/对话 RPC 等)
归属存储: users.db 扩表 workspaces(workspace_id, owner_id, path) + 启停集(user_id, plugin_id, enabled)
工具级执行面: tools/pre-execute guard 按 session→workspace→owner 归属 veto(归属链待证,见 S5)
启停即时生效: eterna 插件改造——systemPrompt.section/tools 注册消费 tenant enabled-set
```

**要点（相对旧「桥+shim」设计的简化）**：不再需要客户端 shim 改道——`connection.fetch.register` 按「/api/<端点>」精确路径注册的守卫路由位于**服务端分发之前**且拿得到完整请求头，网页调用与控制台直连**同走一张路由表=同一扇门**，直连洞按构造消失（浏览器对同源请求无条件附 cookie，直连也带身份）。

**T2.1 spike（一天时间盒，产出=可行/不可行+证据，决定 A/B 分叉）**，清单：

| # | 验证点 | 已知/未知 |
| --- | --- | --- |
| S1 | `connection.fetch.register` 按「/api/<端点>」注册守卫路由：运行实例上验证①命中（网页调用+控制台直连都进）②读得到 Cookie ③`peer.principal.kind==='owner'` 放行语义（index.js:830） | ✅ 机制已实证（index.js:820-832 实读）；运行实例行为待跑通 |
| S2 | 守卫路由内「执行真实逻辑」的转交：a)直调宿主服务（ctx.reflect.get workspace-controller 等，audit-bridge 模式）+自回框 RPC 信封 b)临时摘牌重入（disposer→fetchHandler→re-register，需单飞互斥） | ❓ 逐端点选 a/b |
| S3 | `workspace/follow` 流帧：stream 不走 rpc.intercept——帧过滤路径（fetch streaming 路由？） | ❓ |
| S4 | 端点全量清单：容器内 grep 全部 `@deepseek-ai/dsh-api-*` 的 TypertRemoteMap（account-controller、session-controller、config/settings 族、panel/prompt-studio SRC 族）——隔离必须覆盖的端点闭包 | ❓ 部分（workspace/picker 已盘） |
| S5 | pre-execute 归属链：ToolExecution.agent→session→workspace→owner 是否可解析 | ❓ |
| S6 | 客户端 shim 兼容：typert 浏览器端调用时解析 `globalThis.fetch`（client.browser.js:1210）——shim 时序（tapIndex 早于 app bundle）与 XHR 缺失确认 | 半证（transport=fetch 已证） |
| S7 | payload 严格 schema 对桥改写的容忍（重写 path 字段合法；包裹键是否撞 schema） | ❓ |

模型 A 成立的附加交付：T2.2 端点守卫路由集（S4 端点闭包全量）+ ownership 表；T2.3 用户启停页+红线外全可停语义（D8）；T2.4 eterna 插件 tenant 化改造（逐包：memory/knowledge/observe/panel/prompt-studio…，upstream 插件列入公共面或 deny 清单）；T2.5 **存量 workspace 归属迁移**（现有 demo 等工作区划归 admin，否则全员可见）；T2.6 隔离 E2E 矩阵。

### 5.1 模型 B：多实例回退（已实测可跑，A 不通时启用）

每账号 `DSH_HOME=/data/users/<account>/`（profiles/sessions/storages/审计/凭据天然隔离）；`--patch` overlay 做用户级启停；主实例代理 `/u/<account>/*`（代理前查主会话=真实边界）；桥接=持实例 stdout token。实测：profile 拷贝即可跑，boot ~10s，RSS 426MB/实例。任务表（B1-B6：实例管理器/home 脚手架/overlay/代理/等待页/E2E）已在 v1 计划留存，可随时复活。

## 6. Phase 3：插件启停治理 + 铁律（D8/D9 落地）

| # | 任务 | 产出 | 验收 |
| --- | --- | --- | --- |
| T3.1 | 可启停清单语义：红线集（governance/audit/egress/access 本体）不可停；其余 eterna L1/L2 默认可停；清单落配置文件（管理员可改） | 清单+加载校验 | spec：红线拒停 |
| T3.2 | 启停执行面：pre-execute tenant guard（工具调用）+ eterna 插件 tenant 化（prompt sections/tools 注册消费 enabled-set） | guard+改造 | 停用插件的工具调用被拒/section 消失，即时生效 |
| T3.3 | PLUGIN-AUTHORING 铁律章节：①持久化必须在 `$DSH_HOME` 之下 ②禁止注册绕过门禁/桥的路由 ③工具与 section 必须消费 tenant enabled-set ④新端点必须进隔离端点闭包清单 | 文档 | 章节+示例 |
| T3.4 | `packctl lint` 强制检查：静态扫描持久化路径越界/裸 WebServer.register/未接 enabled-set | lint 规则 | 违规样例被 lint 拦截 |
| T3.5 | 全插件合规扫描：16 包逐包核路径与注册面，产出合规表 | 扫描报告 | 全绿或整改清单 |

## 7. Phase 4：总验收 + 发布

| # | 任务 | 验收 |
| --- | --- | --- |
| T4.1 | 隔离 E2E 矩阵：A/B 两用户互不可见（工作区列表/会话/picker 根目录）+启停互不影响+删除用户数据隔离残留策略 | 全矩阵绿 |
| T4.2 | 域名场景回归（依赖用户已配 DSM 反代）：登录→隔离→启停全流程经 https 域名 | 全过 |
| T4.3 | 文档收口：USER-GUIDE（登录/配置/启停）、docker-deploy（env 全表+反代 cookie）、README 数字与能力清单、mapping 文档 | 与实现一致 |
| T4.4 | 发布：CI 双绿→提交→push（单独确认）→release | tag 对准修复/功能提交 |

## 8. 审核记录（反复审核，发现→处置）

### 审核轮 1：架构可行性（对照容器 alpha.3 类型面逐条核）

| 发现 | 处置 |
| --- | --- |
| `workspace/follow` 是 `RemoteStreamHandle`（stream 类）——**不走 rpc.intercept**，桥无法用同一机制过滤帧 | 入 T2.1-S3（fetch streaming 路由候选）；未证前模型 A 判「不可行」 |
| account-controller / session-controller / config 族端点未盘点——隔离闭包缺清单 | T2.1-S4 列为 spike 硬交付物（容器内 grep 全部 TypertRemoteMap） |
| pre-execute veto 归属链（agent→session→workspace→owner）未证 | T2.1-S5 |
| inject 名单/`webServer` Context 增广/authenticatedUrl 已实证 | ✅ 可行面成立（§10 引用行号） |
| catalog 新增 alpha.3 与仓库 alpha.2 家族并存——升级门禁叙事缺失 | T1.9 补 upgrade-gate 说明段 |
| 插件挂载失败=boot 报 FAILED fiber 但 web 照常起=**失败开放** | 残余风险登记（R7）：entrypoint 启动前预检 users.db 可开+容器健康检查语义说明；文档明示 |
| scryptSync 阻塞事件循环 ~100ms/次 | 当前量级可接受；R8 登记（用户量增长再改 async） |

### 审核轮 2：安全威胁模型（逐角色/逐攻击面）

| 威胁 | 处置 |
| --- | --- |
| SVG 头像=存储型 XSS | 端点表白名单 png/jpeg/webp/gif，**禁 SVG**（T1.6 spec 覆盖） |
| 跨源 CSRF（Origin 伪造/内嵌浏览器 `Origin: null`） | 变更类端点同源强校验；Origin 与 Host 规范化比对（忽略默认端口，反代 preserve-Host 为部署要求，docs 明示）；`null` 一律拒 |
| 暴力破解/账号枚举 | 验证失败统一 null/401 不区分；限速双层（ip+账号 5/min、ip 全局 30/min） |
| 管理员密码入 git | D2：真值仅 `.env`（gitignored）；`.env.example` 占位；本计划书不含真值 |
| 会话固定/伪造 | HMAC+8B nonce+绝对过期；`ETERNA_ACCESS_SECRET` 设置即轮换（语义文档化） |
| 审计事件泄密 | 复用 PII 过滤（ctx.audit 在场时经其投影器；缺席时事件不含敏感字段，仅 account/ip/动作） |
| 反代后 Secure 缺失 | `ETERNA_ACCESS_SECURE=1` 显式声明（不信 X-Forwarded-*，对齐 BrowserAuth 立场） |
| 直连 /api 绕过租户过滤（模型 A） | ✅ 已按构造关闭：守卫路由在服务端分发前、按完整路径命中一切调用（网页/直连同表同门），直连同样带 cookie 同样被归属校验（S1/S2 实证设计） |

### 审核轮 3：遗漏扫描

| 发现 | 处置 |
| --- | --- |
| 同浏览器多账号：桥模型下 `eterna_session` 单 cookie=切号即重登（顺序使用）；多实例模型下 dsh cookie 同名互踩更糟 | 两模型均文档明示；桥模型在此点反而更优（写入 §5.0 优势注记） |
| admin 可创建 admin 角色 | 端点表 role 参数允许；护栏（末位 admin 不可删/不可删自己）store 层事务强制 ✅ |
| 删除用户后其活动会话 | uid 消失→verify 失败→即时失效 ✅（by design）；dsh 共享 cookie 残留无害（门禁在 eterna_session） |
| 容器重启语义 | dsh token 轮换（桥用 authenticatedUrl 现取，无碍）；BrowserAuth 会话落卷不掉线；eterna_session 密钥落卷不掉线；限速表清零（可接受） |
| 审计接线插件序 | audit-bridge 模式：逐调用惰性 `ctx.reflect.get('audit', false)`，audit 缺席降级不阻塞登录 ✅ 先例已证 |
| README 测试总数 1000 将失真 | T1.9/T1.11 联动更新（含 zh-CN） |
| node:sqlite 版本门槛（node≥22.5 实验面） | knowledge 先例同底座；README 前置 Node≥22 已覆盖，docs 注明 |
| 域名 E2E 依赖用户反代配置 | T4.2 列为外部依赖项，前置说明 |
| 头像 GET 缓存/隐私 | `Cache-Control: private`（端点表已注） |
| 三页+角标的中文化 | 页面 UI 中文（面向用户界面一律中文——仓库纪律）✅ |
| host 验收实例兼容 | 同一插件/挂载配方；宿主 `.eterna-home-accept` 需手工补 symlink+patch 行（T1.9 附操作说明） |
| 用户停用插件后自身 UI 残留（panel 卡片仍显示） | T2.4 tenant 化改造覆盖 UI 面；上游插件 UI 残留登记为已知限制 |

## 9. 风险登记册

| # | 风险 | 影响 | 对策 |
| --- | --- | --- | --- |
| R1 | 守卫路由运行行为与实读不符 / 转交方案（直调服务 vs 摘牌重入）个别端点不可行 | 个别端点降级为 deny 或回退多实例 | S1/S2 时间盒验证；B 模型任务表在案 |
| R2 | follow 流帧不可过滤 | 模型 A 工作区列表泄漏 | 同 S3；不可过滤则该端点进 deny 清单（降级体验）或回退 B |
| R3 | shim 与上游客户端升级耦合 | dsh 升级后 shim 失效 | seam 钉版+升级门禁覆盖；S6 时序用 tapIndex 早于 app 保证 |
| R4 | 拦截器行为与类型面不符 | 模型 A 基石动摇 | S1 第一项验证；不符即回退 B |
| R5 | .env 凭据泄漏（误提交/截图） | 管理员失陷 | gitignore 双检+文档警示+泄露即改密流程 |
| R6 | 用户量增长内存/性能 | 体验劣化 | R8 async scrypt+模型 B 备选 |
| R7 | 插件挂载失败=门禁失效（失败开放） | 裸奔窗口 | entrypoint 预检+健康检查语义+日志告警；文档明示残余风险 |
| R8 | scryptSync 阻塞 | 登录峰值延迟 | 当前量级接受；预留 async 化 |
| R9 | XFF 伪造绕过限速 | 暴力破解提速 | 可信假设=XFF 仅来自内网（直连 LAN 或 NAS 反代）；socket 直连公网场景收紧为 socket ip；docs 明示 |
| R10 | 改密后旧会话仍有效（无状态 HMAC 不可吊销） | 被盗会话存活 | 载荷含 pwv 版本号，verify 比对 store 当前版本（T1.5 已入任务） |
| R11 | market 索引收录 access 的打包路径不明 | 安装体验缺失 | 开放问题：workspace 依赖打包支持待定，Phase 后置（不影响仓内挂载） |

## 8-b. 审核轮 4（承重结论复检+安全补漏，2026-11-09）

| 发现 | 处置 |
| --- | --- |
| 改密/重置密后既有 eterna_session 仍有效至过期（无状态 HMAC 无吊销）→ 安全缺口 | **T1.5 修订**：载荷加 pwv，verify 比对；spec 增「改密后旧 token 拒」 |
| 反代后限速 ip=socket ip=代理 IP，全员共享 30/min 全局阈值会误伤 | T1.6 修订：XFF 首值优先+可信假设文档化（R9） |
| 登录失败不出审计=暴力破解不可见 | T1.6 修订：失败登录审计事件 |
| access package.json 缺 `dsh.bundle.patch` 声明（panel/glue 均有——market 安装路径与装载规范一致性） | T1.2 修订：补声明 |
| 存量 workspace（如 demo）在模型 A 下全员可见 | T2.5 归属迁移任务 |
| authenticatedUrl/webServer 增广/tapIndex 渲染路径/fetch 调用时解析——四项承重结论复检 | 全部有行号实证（§10），复检通过 |
| 容器内插件以 src/index.ts 装载的可行性 | glue/panel 同布局今在产运行=经验实证 ✅ |

### 审核轮 5：D11（重名自动后缀）执行细则（默认策略，用户可改）

| 细则点 | 默认 |
| --- | --- |
| 后缀形态 | 直接拼接无分隔符：`zhangsan01`（如需 `zhangsan_01` 分隔符样式开发时一行可改） |
| 起始与递增 | 两位零填充从 `01` 起；`…99` 占满自然进三位（`…100`），不设上限 |
| 占用跳过 | 候选序列逐个查库，被占用（含手工建的同后缀号）即跳下一个 |
| 大小写语义 | 沿 D5 区分大小写：`Zhangsan` 与 `zhangsan` 互不触发后缀 |
| 32 字符上限 | 超长时**截基座保后缀**（后缀永远完整可见），响应返回最终账号 |
| 昵称默认 | =最终账号（含后缀），符合 D4 |
| admin 播种 | 不走后缀（仅表空播种，无冲突场景）；`Mr.Ma` 精确保留 |
| UI | 添加表单注明「重名自动加数字后缀」；创建成功 toast 展示最终账号 |

## 10. 信息来源（容器 alpha.3 实读+仓内先例）

- `dsh-client-connection/lib/types/`：rpc.d.ts（HostConnectionRpc.intercept :158、Handler :111 无头、Result :34-42、authenticatedUrl :223）、rpc-host.d.ts（ctx.connection 增广 :10、inject 相关）、browser-auth.d.ts（authorizeIndex/cookie 铸发）
- `dsh-host-webserver/lib/types/index.d.ts`：webServer 增广 :21、register :193、tapIndex/registerFallback、WebRoute/WebResourceRoute
- `dsh-tools/lib/types/contracts.d.ts`：ToolGuard :374、ToolExecutionInput :163（agent 字段）
- `dsh-api-workspace-controller/lib/types/`：workspace 端点全表、WorkspaceCreateRequest={path}（types.d.ts:70）、DirectoryListing
- `dsh-client-connection/lib/client.browser.js:1210`：transport=globalThis.fetch（调用时解析）
- 仓内先例：channels/{token,webhook}.ts（HMAC/CSPRNG/timingSafe）、glue/audit-bridge.ts（ctx.reflect.get 机会读取+get 陷阱教训）、audit/service.ts（AuditWorld.report 直投）、knowledge/indexer.ts（node:sqlite）、panel/package.json（dsh 声明）、glue/cordis.patch.yml（insert 语义）、frontend-static lib/index.js:26（inject=['webServer','connection'] 实证）
- 本会话实测：Origin fence 403 矩阵、trusted-host 语义、探针实例 RSS 426MB、profile 拷贝可跑
