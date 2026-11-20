# RC5-HERO-007 · prefers-reduced-motion 静态呈现（未动态执行）

- 套件：HERO
- 结论：**NOTRUN**
- 开始/结束：2026-11-19T23:17:24.418Z / 2026-11-19T23:17:24.418Z

## 预期

模拟减弱动效 → 静态呈现；无动画

## 实际

未执行：IAB 后端无媒体模拟接口，不能切换 prefers-reduced-motion。静态证据：hero 光晕默认有 18s 呼吸动画（styles.ts:48），并已写 @media (prefers-reduced-motion: reduce){animation:none}（styles.ts:110-111）

## 备注

- 不把静态规则推断记为 PASS；需在支持 CDP emulateMedia 的环境补测

## 执行命令

```
$ IAB: 查询 media 模拟能力（browser-client.mjs 仅暴露 setViewportSize；无 emulateMedia/CDP）  # EXIT=-1
$ grep -n "animation|prefers-reduced-motion" packages/brand/src/client/styles.ts  # EXIT=0
```
