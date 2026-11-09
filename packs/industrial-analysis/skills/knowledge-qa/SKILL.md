---
name: knowledge-qa
description: 工业知识问答纪律(首场景②:域语料检索→结论带出处与版本→无命中明说)。凡涉及设备手册、工艺卡、规则库口径、历史处置案例的知识问答,必须走本 SOP:kb_search 检索(Knowledge MCP)→ 结论逐字引用出处与版本;检索无命中必须明说「知识库无命中」,绝不编造条文。
metadata:
  evo:
    entries:
      - { id: S-knowledge-qa-001, helpful: 0, harmful: 0, updated: 2026-11-09, origin: init }
      - { id: S-knowledge-qa-002, helpful: 0, harmful: 0, updated: 2026-11-09, origin: init }
      - { id: S-knowledge-qa-003, helpful: 0, harmful: 0, updated: 2026-11-09, origin: init }
---
## 检索(Knowledge MCP → kb_search)

<!-- E: S-knowledge-qa-001 -->
1. 先定检索词再查:设备/部位/主题词优先(型号、资产编号、RULE-* 前缀),
   空格分词;语料范围先核清单(设备手册/工艺卡/预警规则库/处置案例,工具报错会给可用
   kb 清单),超范围先确认是否接入,不硬查;
2. kb_search 只经 Knowledge MCP 检索(pgvector+图谱,内网不经公网):不直连向量库/图库、
   不要求贴库凭据;命中带出处字段(知识库/条目 id/标题/版本)与现成 citation 串,
   引用逐字不改写;基座通用 wiki 知识走 knowledge_search(@basis/knowledge),
   本包域语料问答走 kb_search,两者都是经 MCP 的只读检索;
3. 弱相关命中不硬凑:分数低、片段答非所问 = 等于无命中,不得挑半句拼答案。
<!-- /E -->

## 结论引用与无命中(出处与版本)

<!-- E: S-knowledge-qa-002 -->
1. 结论必须带出处与版本:每条知识结论标注《条目标题》+ 版本(知识库/条目 id),
   用命中返回的 citation 串逐字引用;多来源时分别标注;来源相互冲突时并列差异并标待确认,
   不挑一边抹掉另一边;
2. 检索无命中必须明说「知识库无命中」,禁止编造条文:不虚构手册/工艺卡条款、
   不虚构版本号与条目 id、不拿邻近设备语料冒充;无命中时给核对路径
   (核对资产编号/检索词;语料缺失走知识提案评审补录,未过审内容不进检索结果);
3. 知识结论与时序/预警互证时分工明确:知识给「应该是什么」(工艺卡区间、规则限值),
   实测给「实际是什么」(timeseries_query 窗口),两者矛盾如实并列,不调和、不二选一。
<!-- /E -->

## 交付与红线

<!-- E: S-knowledge-qa-003 -->
1. 知识问答是 R0 只读:语料修订走知识提案(knowledge_propose,评审通过才进检索),
   不直改语料、不直连库写;限值类修订属工艺变更,提示走正式变更流程,不由 agent 拍板;
2. 不确定不说死:版本过旧、口径不明、语料未覆盖 → 写「待确认」,不用推测填空;
   知识说「应该」,现场说「实际」,不替现场拍板;
3. 引用格式与无命中话术速查见 [引用与无命中](references/kb-citation-rules.md)。
<!-- /E -->
