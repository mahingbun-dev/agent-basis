# RC5-HERO-006 · 三视口布局只收缩不溢出

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:45.622Z / 2026-11-20T07:02:45.625Z

## 预期

1440/900/390 截图；布局只收缩；不溢出

## 实际

1440/900/390 均无横向溢出；输入框 770→577→291、装饰层 1160→620→334 随宽度收缩，位置规则不变（layer 始终 x≥0 且右缘≤视口）

## 证据附件

- `RC5-HERO-006-light-1440.png`
- `RC5-HERO-006-light-900.png`
- `RC5-HERO-006-light-390.png`

## 执行命令

```
$ IAB: setViewportSize(1440/900/390) → screenshot ×3 → 量 composerRect/layerRect/scrollWidth  # EXIT=0
```
