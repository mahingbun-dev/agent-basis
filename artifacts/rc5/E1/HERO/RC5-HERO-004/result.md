# RC5-HERO-004 · 有消息后滚动无浮层错位/重影

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:45.619Z / 2026-11-20T07:02:45.619Z

## 预期

滚动到底/顶：浮层不跟随错位；无重影

## 实际

8 轮消息形成可滚动体（824/1616，max 792）；底/顶两端均无 [data-eterna-hero-frame]/[data-eterna-hero-layer]（hero=false 已整体移除），无错位与重影

## 备注

- 无 LLM 凭据，轮次以 AUTH 失败收尾，但消息与滚动体均真实生成

## 证据附件

- `RC5-HERO-004-light-1440.png`

## 执行命令

```
$ IAB 1440×900: 连续发送 8 轮（每轮模型因占位密钥失败）→ scrollBody.scrollTop=scrollHeight / 0  # EXIT=0
```
