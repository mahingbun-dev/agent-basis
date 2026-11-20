# RC5-BOOT-013 · super：agent-team 三行、Team 默认关、任务/子代理 UI

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-19T23:34:35.703Z / 2026-11-19T23:34:35.703Z

## 预期

三行真 boot；Team mode 默认关；任务板/子代理 UI 不破面

## 实际

dump-config 见 agent-team/tool-agent-team/ui-agent-team；新会话 agentTeam 投影 enabled=false；工作台任务侧栏与 worker 检查器/委派入口正常渲染无错误

## 备注

- 工作台截图为主题深色（super 实例自身主题），1440 宽

## 证据附件

- `RC5-BOOT-013-dark-1440.png`
- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite-super dsh --profile eterna-super --dump-config | grep -E 'agent-team|subagent|task'  # EXIT=0
$ POST /api/session/create + /api/session/projections（super，admin）  # EXIT=0
$ IAB 1440×900: 打开 super 工作台 → 读取任务侧栏/工作监控/子代理入口  # EXIT=0
```
