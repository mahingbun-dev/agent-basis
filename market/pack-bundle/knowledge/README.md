# knowledge/ —— 活动策划领域语料元数据(06 号模板)

权威知识(制度/手册/案例库)不落本地:检索走 @eterna/knowledge 插件
(WeKnora / wiki-local 后端,08 号文档 §5.1 边界)。本目录只放语料清单与检索配置,
不放语料本体。经验性记忆(客户偏好、项目事实)归 @eterna/memory,两者不互写。

## 语料清单(v0 占位,S0 与 SME 确认后补版本与负责人)

| 语料 | 形态 | 用途 | 状态 |
|---|---|---|---|
| 活动策划操作手册(SOP/合规口径) | wiki-local | 策划案/排期/预算章节口径 | 待导入 |
| 供应商库(报价/履约评价) | WeKnora KB | 比选中立性与来源引用 | 待建库(v0 用案例内嵌报价) |
| 场地库(容量/报价/位置) | WeKnora KB | 场地比选与约束核验 | 待建库(v0 用案例内嵌报价) |
| 历史项目复盘归档 | wiki-local | 复盘报告参照 | 待导入 |

## 检索配置片段(示例;真实 KB id 随 T7/T8 联调补)

```yaml
knowledge:
  backend: weknora          # 或 wiki-local
  kb_ids: ['event-vendors', 'event-venues']
  permission_scope: event-pack
```

> v0 说明:30 条 golden 的报价/数据全部内嵌在 user_input 里(确定性优先),
> 不依赖知识库可达;知识库接入后golden 升级为引用真实检索出处。
