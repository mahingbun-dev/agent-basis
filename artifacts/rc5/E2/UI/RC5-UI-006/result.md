# RC5-UI-006 · 双主题 × 三视口截图（MCP 设置 / terminal / hero / chat-import）

- 套件：UI
- 结论：**PASS**
- 开始/结束：2026-11-20T07:10:02.233Z / 2026-11-20T07:10:02.235Z

## 预期

4 个面 × 深浅 2 主题 × 1440/900/390 三视口，每组合合格、无破面/溢出

## 实际

24 张截图产出；主题与横向溢出检查全绿（light 亮度 242 / dark 24.2；6/6 scrollWidth=innerWidth）；MCP 设置 6/6 可开；terminal 6/6 为真实 bash 终端；chat-import 6/6 入口渲染（hits=6）；390 hero：无决策卡时不渲染切换条（switch_labels=0），chips 行无遮挡

## 备注

- chat-import 入口门 deepseekChatImport/limits 已入 mux 全局一元清单（W5 修复）
- terminal 面板为真实 PTY（旧 session.snapshotEvents P1 已修，TERM-006 复跑 8/8）
- 390 遮挡修复=切换条只在确有 .et-decision-card 时渲染（UI DecisionLayer）

## 证据附件

- `observations.json`
- `RC5-UI-006/RC5-UI-006-light-1440-hero.png`
- `RC5-UI-006/RC5-UI-006-light-1440-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-light-1440-terminal.png`
- `RC5-UI-006/RC5-UI-006-light-1440-chat-import-entry.png`
- `RC5-UI-006/RC5-UI-006-light-900-hero.png`
- `RC5-UI-006/RC5-UI-006-light-900-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-light-900-terminal.png`
- `RC5-UI-006/RC5-UI-006-light-900-chat-import-entry.png`
- `RC5-UI-006/RC5-UI-006-light-390-hero.png`
- `RC5-UI-006/RC5-UI-006-light-390-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-light-390-terminal.png`
- `RC5-UI-006/RC5-UI-006-light-390-chat-import-entry.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-hero.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-terminal.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-chat-import-entry.png`
- `RC5-UI-006/RC5-UI-006-dark-900-hero.png`
- `RC5-UI-006/RC5-UI-006-dark-900-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-dark-900-terminal.png`
- `RC5-UI-006/RC5-UI-006-dark-900-chat-import-entry.png`
- `RC5-UI-006/RC5-UI-006-dark-390-hero.png`
- `RC5-UI-006/RC5-UI-006-dark-390-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-dark-390-terminal.png`
- `RC5-UI-006/RC5-UI-006-dark-390-chat-import-entry.png`

## 执行命令

```
$ node artifacts/rc5/E2/UI/ui-shot.mjs  # EXIT=0
$ POST /api/deepseekChatImport/limits（浏览器 cookie，light）  # EXIT=200
$ POST /api/deepseekChatImport/limits（浏览器 cookie，dark）  # EXIT=200
```
