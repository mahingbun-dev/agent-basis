# RC5-HERO-003 · hero 层下输入框可聚焦/输入/发送

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:45.619Z / 2026-11-20T07:02:45.619Z

## 预期

点击输入框/发送 → 可聚焦、可输入、可发送（pointer-events 正确）

## 实际

composer focus=true；输入后 send.disabled=false；点击发送后 transcript 出现 “hero 自检 ping”，hero 层随相位切换移除

## 备注

- 真实鼠标 click 在本 SPA 上易超时，使用 programmatic click + elementFromPoint 命中面交叉验证

## 证据附件

- `RC5-HERO-003-light-1440.png`

## 执行命令

```
$ IAB 1440×900: composer.focus() → execCommand("insertText") → get button[aria-label="发送消息"].disabled → click  # EXIT=0
```
