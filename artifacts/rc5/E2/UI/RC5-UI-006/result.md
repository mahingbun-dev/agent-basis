# RC5-UI-006 · 双主题 × 三视口截图（MCP 设置 / terminal / hero / chat-import）

- 套件：UI
- 结论：**FAIL**
- 开始/结束：2026-11-20T00:28:37.262Z / 2026-11-20T00:28:37.263Z

## 预期

4 个面 × 深浅 2 主题 × 1440/900/390 三视口，每组合合格、无破面/溢出

## 实际

24 张截图产出；主题与横向溢出检查全绿（light 亮度 242 / dark 24.2；6/6 scrollWidth=innerWidth）；MCP 设置 6/6 可开；terminal 5/6 为终端页（均显示 P1 错误）；chat-import 6/6 无入口（hits=0）；390 hero：浮层提示「第 1/2 项·点击切换」压住第 4 个 chip（视觉遮挡，非横向溢出）

## 备注

- chat-import 无法截图 = 该面缺入口（P1 Web 入口缺失），不是布局破面
- terminal 截图保留真实错误态，未修图

## 证据附件

- `observations.json`
- `RC5-UI-006/RC5-UI-006-light-1440-hero.png`
- `RC5-UI-006/RC5-UI-006-light-1440-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-light-1440-terminal.png`
- `RC5-UI-006/RC5-UI-006-light-1440-chat-import-entry-missing.png`
- `RC5-UI-006/RC5-UI-006-light-900-hero.png`
- `RC5-UI-006/RC5-UI-006-light-900-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-light-900-terminal.png`
- `RC5-UI-006/RC5-UI-006-light-900-chat-import-entry-missing.png`
- `RC5-UI-006/RC5-UI-006-light-390-hero.png`
- `RC5-UI-006/RC5-UI-006-light-390-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-light-390-terminal.png`
- `RC5-UI-006/RC5-UI-006-light-390-chat-import-entry-missing.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-hero.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-terminal.png`
- `RC5-UI-006/RC5-UI-006-dark-1440-chat-import-entry-missing.png`
- `RC5-UI-006/RC5-UI-006-dark-900-hero.png`
- `RC5-UI-006/RC5-UI-006-dark-900-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-dark-900-terminal.png`
- `RC5-UI-006/RC5-UI-006-dark-900-chat-import-entry-missing.png`
- `RC5-UI-006/RC5-UI-006-dark-390-hero.png`
- `RC5-UI-006/RC5-UI-006-dark-390-mcp-settings.png`
- `RC5-UI-006/RC5-UI-006-dark-390-terminal.png`
- `RC5-UI-006/RC5-UI-006-dark-390-chat-import-entry-missing.png`

## 执行命令

```
$ node artifacts/rc5/E2/UI/ui-shot.mjs  # EXIT=0
$ POST /api/deepseekChatImport/limits（浏览器 cookie，light）  # EXIT=200
$ POST /api/deepseekChatImport/limits（浏览器 cookie，dark）  # EXIT=200
```
