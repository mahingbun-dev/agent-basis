# RC5-HERO-002 · 空会话品牌层出现且不遮挡输入框

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:45.617Z / 2026-11-20T07:02:45.619Z

## 预期

品牌层出现；不遮挡输入框（命中面穿透）；深浅两主题、三视口截图

## 实际

phase=hero；frame display:contents；layer absolute inset:0 z-index:-1 pointer-events:none；三视口输入框中心 elementFromPoint 均落在可编辑区；无横向溢出

## 备注

- 截图文件名为 RC5-HERO-002-<theme>-<width>.png；005/006 引用同批截图副本

## 证据附件

- `RC5-HERO-002-light-1440.png`
- `RC5-HERO-002-light-900.png`
- `RC5-HERO-002-light-390.png`
- `RC5-HERO-002-dark-1440.png`
- `RC5-HERO-002-dark-900.png`
- `RC5-HERO-002-dark-390.png`

## 执行命令

```
$ IAB: setViewportSize(1440/900/390±) × 浅色/深色；screenshot() × 6；elementFromPoint(输入框中心)；getComputedStyle(frame/layer)  # EXIT=0
```
