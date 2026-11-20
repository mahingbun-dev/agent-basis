# RC5-HERO-007 · prefers-reduced-motion 下 hero 静态呈现

- 套件：HERO
- 结论：**PASS**
- 开始/结束：2026-11-20T07:02:45.625Z / 2026-11-20T07:02:52.274Z

## 预期

模拟减弱动效 → 静态呈现；无动画

## 实际

reduce={animation:none,animated:0,hit:true}；no-preference={animation:eterna-hero-breathe,hit:true}

## 备注

- Playwright reducedMotion=reduce/no-preference 两态实测；reduce 下 animate-name=none 且 0 动画元素，对照态有 eterna-hero-breathe

## 证据附件

- `reduce-1440.png`
- `no-preference-1440.png`

## 执行命令

```
$ node artifacts/rc5/E1/HERO/hero-007.mjs（CDP reducedMotion 两态）  # EXIT=0
```
