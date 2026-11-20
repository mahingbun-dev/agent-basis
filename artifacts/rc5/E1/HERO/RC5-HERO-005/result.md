# RC5-HERO-005 · 双主题品牌色跟随

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-19T23:17:24.413Z / 2026-11-19T23:17:24.416Z

## 预期

light/dark 截图；品牌色跟随主题；无字面色

## 实际

mark 浅色 rgb(43,98,114)/深色 rgb(127,178,189)，glow/ring oklab 亮度 0.466→0.731；styles.ts 无字面色值（grep 零命中）；深浅截图见附件

## 证据附件

- `RC5-HERO-005-light-1440.png`
- `RC5-HERO-005-dark-1440.png`

## 执行命令

```
$ IAB: 偏好设置 → 通用设置 → 外观 → 浅色/深色；getComputedStyle(hero mark/glow/ring)  # EXIT=0
$ grep -nE "#[0-9a-fA-F]{3,8}|rgba?\(" packages/brand/src/client/styles.ts packages/brand/src/client/hero.ts  # EXIT=0
```
