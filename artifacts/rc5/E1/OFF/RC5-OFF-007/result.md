# RC5-OFF-007 · office-docx 技能加载 + 三工具下一步出现 + 产物复制回工作区

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-20T06:34:21.734Z / 2026-11-20T06:34:23.860Z

## 预期

技能可加载；office_render/convert/recalculate 下一步出现；产物可复制回工作区

## 实际

skillLoaded=true nextTools=["ask_user_question","bash","create_goal","edit","get_goal","glob","grep","install_personal_plugin","job_kill","job_list","job_output","knowledge_admin","knowledge_propose","knowledge_read","knowledge_search","knowledge_status","list_agents","list_mcp_resource_templates","list_mcp_resources","list_subagent_models","mcp__browser__browser_click","mcp__browser__browser_fill","mcp__browser__browser_snapshot","mcp__e1http__echo","memory_forget","memory_read","memory_search","memory_write","office_convert","office_recalculate","office_render","present","read","read_image","read_mcp_resource","schedule_create","schedule_edit","schedule_list","schedule_view","send_message","session_event_read","session_event_search","session_event_trace","session_search","session_trace","skill","subagent","subagent_fork","submit_plugin_to_market","terminal_close","terminal_list","terminal_open","terminal_read","terminal_send","terminal_signal","todo_write","update_goal","wait_agent","web_fetch","workflow","working_directory","write"] render=true convert=true pdf=/data/office-kit/outputs/session-d31998267d5005a8986877a7/fe73fed4-0a0f-4617-a3bd-463b016dfa9c/off-007-sample.pdf(47957B) onDisk=true bashCopy=true workspacePdf=47957B

## 备注

- lane=rc5-e1suite（独立测试容器，未触碰生产）；假模型端口 4603（独立日志，避免与 E2 LLM 套件串）
- 模型选哪个工具被确定性化（@@CALL），工具清单/权限门/工具执行/产物全部走产品代码
- office-docx 技能由 web-app 的 skill-office 行从包内 assets 挂载；tool-office 以 activationSkills 默认清单（office/office-docx/office-xlsx/office-pptx）激活
- 临时输出在 DSH_HOME/office-kit/outputs；按产品文档用 bash 复制到工作区（测试另以 docker exec 复核 PDF 头与大小）

## 证据附件

- `cmd.log`

## 执行命令

```
$ docker cp tests/fixtures/office/sample.docx rc5-e1suite:/data/workspaces/rc5userb/off-007-sample.docx  # EXIT=0
$ docker exec rc5-e1suite chmod 644 /data/workspaces/rc5userb/off-007-sample.docx  # EXIT=0
$ PORT=4603 FAKE_LLM_LOG=… node artifacts/rc5/E2/LLM/fake-llm-server.mjs  # EXIT=0
$ settings/update llm-pi-ai.providers.fake + agent-default-model=fake/fake-1  # EXIT=200
$ POST /api/session/create {cwd:/data/workspaces/rc5userb}（B）  # EXIT=200
$ POST /api/session/prompt（skill→render→convert→bash 复制）  # EXIT=200
$ session/state 收尾（running=false，队列空）  # EXIT=200
$ 假模型日志：逐请求 pending/absent/toolNames  # EXIT=0
$ 技能结果（下一步工具清单）  # EXIT=0
$ office_render 结果片段  # EXIT=0
$ office_convert 结果片段  # EXIT=0
$ bash 结果片段  # EXIT=0
$ docker exec 查看 office 输出与工作区复制件  # EXIT=0
$ docker exec head -c 4 /data/workspaces/rc5userb/off-007/sample.pdf; stat -c %s  # EXIT=0
```
