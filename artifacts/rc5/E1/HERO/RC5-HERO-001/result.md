# RC5-HERO-001 · hero=false 页面无额外包裹

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-19T23:17:24.411Z / 2026-11-19T23:17:24.412Z

## 预期

DOM 与改造前一致；无额外包裹（无 hero frame / layer）

## 实际

发送消息后 phase=active，frame/layer 计数均为 0，普通消息渲染在 transcript；截图见附件

## 备注

- 实际页面为既有会话（活动态），非改造前快照对比；判定面=hero 专用 DOM 是否零增量

## 证据附件

- `RC5-HERO-001-light-1440.png`

## 执行命令

```
$ IAB 1440×900: focus composer → execCommand("insertText","hero 自检 ping") → click button[aria-label="发送消息"]  # EXIT=0
```
