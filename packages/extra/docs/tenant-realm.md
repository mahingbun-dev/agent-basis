# tenant realm 规范:行业→客户两级 Cordis isolate realm 约定

> @basis/extra(T13)。对齐设计文档 12 §10.3「多租户隔离 | Cordis isolate realm 原生 | A+规范 | 粒度待定(行业/客户)」——本规范把「粒度待定」钉成**两级:行业级 → 客户级**。承载方式 = **A(原生机制)+ S(本规范)**,零内核改动。

## 1. 模型

```
root(host,全局:audit / governance 规则装载)
└── ind:<行业>                      行业级 realm:共享 L2 领域包、行业知识库、行业 persona
    └── ind:<行业>:cust:<客户>      客户级 realm:私有 memory / knowledge / storage
```

- **行业是客户的父域**:行业级放「同行业所有客户共享」的东西(L2 领域包、行业知识、行业工具配置);客户级放「单客户私有」的东西(实体记忆、客户文档、存储)。
- **行业之间互不可见;同行业不同客户互不可见;客户可见本行业共享物**。

## 2. realm key 语法(机器可读、人可念)

| 级 | key 形态 | 例 |
|---|---|---|
| 行业级 | `ind:<industry-slug>` | `ind:event-planning` |
| 客户级 | `ind:<industry-slug>:cust:<customer-slug>` | `ind:event-planning:cust:acme` |

- slug:`^[a-z0-9]+(-[a-z0-9]+)*$`(小写字母数字,连字符分段;禁下划线、点、大写)。
- 前缀固定 `ind:` / `:cust:`,不允许自定义;key 是稳定标识,进审计记录与配置,不进模型上下文。

## 3. Cordis 承载面(原生机制,不改内核)

1. **服务隔离**:`ctx.isolate(serviceName, label)`(@deepseek-ai/cordis)。同 label 相连、异 label 隔离。label 一律取 `tenantRealmLabel(realm)` = `Symbol.for('basis:tenant-realm:<key>')`——用 `Symbol.for` 保证跨插件实例/跨 fiber 同 key 相连,异租户天然隔离。
2. **配置结构**:`cordis:group` 装载器行(vendor/group/README.md)嵌套:行业组行 → 客户组行,嵌套 id 以 `:` 连接(如 `ind-event-planning:cust-acme`)。租户作用域插件行放在客户组 config 内。
3. **纪律先例**:dsh agent-preset-registry 已强制「provider 与 consumer 必须同 isolate realm」(packages/preset/agent-preset-registry/src/mount.ts:213)——本规范沿用同一纪律:**租户作用域服务的 provide 与 inject 必须发生在同一客户 realm 内**。

## 4. 隔离面(哪些服务隔离、哪些共享)

| 面 | 隔离级别 | 说明 |
|---|---|---|
| `memory`(实体记忆) | 客户级 | 单客户私有;跨客户记忆泄漏 = 事故 |
| `knowledge`(知识库) | 客户级;行业库挂行业级 | 客户私有库 + 行业共享库(行业库只读挂载进客户 realm) |
| `storage` | 客户级 | 存储后端按客户分库/分前缀 |
| `audit` | **全局共享(不隔离)** | 全租户统一可审计——审计必须能看见一切租户的行为 |
| `governance` 规则 | 全局 + L2 领域包声明 | 治理规则跨租户一致,不按租户分叉 |

默认隔离服务词汇表:`ISOLATED_TENANT_SERVICES = ['memory', 'knowledge', 'storage']`(@basis/extra 导出,加载器按表校验,表外服务进租户配置即报错)。

## 5. 配置模板与加载

- 模板文件:`assets/tenant-realm.template.yml`(本包内,可直接复制改造)。
- 加载校验:`loadTenantRealmConfig(text)`(本模块导出)fail-closed:
  - YAML 必须是 `{ industries: [{ slug, customers: [] }] }`,非空 industries、无未知字段;
  - slug 全量过字符集;行业不重复;同行业内客户不重复;
  - 任何一项违规 → 整份拒收(ExtraConfigError),绝不半载。
- 行树生成:`buildTenantGroupRows(doc, customerPluginRows)` 产出 `cordis:group` 行树(行业组→客户组),`renderTenantGroupYaml` 渲染为可粘进 profile patch 的 YAML。

## 6. 约定清单(组合层自检)

1. 客户 realm 的每个隔离服务,provider 与 consumer 都经 `tenantRealmLabel(realm)` 取同一 label 调 `ctx.isolate`。
2. 客户组行内只放租户作用域插件行;行业级共享物放行业组(与客户组平级),不放 root。
3. audit sink 只挂 root,永不进租户组。
4. 新增隔离服务先扩 `ISOLATED_TENANT_SERVICES` 词汇表再进配置(词汇表即 schema)。
5. realm key 是审计外键:审计记录必须带发生时的 realm key。

## 7. 已知边界(诚实声明)

- Cordis isolate realm 是**服务作用域隔离,不是沙箱**(dsh-scope README 原话:"The primitive routes trusted same-process plugins; it is not a sandbox or an authority boundary")。插件代码级恶意行为不在本规范防线内——那属于 governance 规则引擎与 plugin_manager 安装审批(12 §4.6)。
- 多进程/多 host 部署下,label 相连仅在同一 Cordis 运行时内成立;跨进程隔离靠「每租户独立配置目录 + 独立 profile」承载(部署约定,不在本包代码内)。
- 需要运行时联调:与真实 DSH host 的 `cordis:group` 装载、preset registry realm 审计联动,属 T14 总装验证项。
