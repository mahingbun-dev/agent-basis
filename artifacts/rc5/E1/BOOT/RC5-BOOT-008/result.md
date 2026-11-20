# RC5-BOOT-008 · 旧 profile 默认 bundle 迁移（只追加一次）

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-19T22:43:55.237Z / 2026-11-19T22:44:15.596Z

## 预期

旧清单仅 base+web-app：首启追加 4 个 rc.5 默认；marker 落盘；二次启动零追加；备份 package.json.bak-* 存在

## 实际

追加=4(dsh-deepseek-chat-import,dsh-experimental-session-search,dsh-experimental-plugin-market-bundle,dsh-experimental-terminal-bundle) 幂等=true 备份=1 首启健康=healthy

## 备注

- 旧卷模拟=已渲染 profile 的 package.json 回退为 rc.4 默认清单并移除 marker（模板哈希不变，入口走 keep 路径，迁移脚本据实追加）

## 证据附件

- `boot-baseline.log`
- `boot-first-migrate.log`
- `boot-second.log`
- `cmd.log`

## 执行命令

```
$ docker run -d … rc5-e1suite-boot8（基线启动，生成渲染 profile）  # EXIT=0
$ docker run -d … rc5-e1suite-boot8（旧清单 → 首启迁移）  # EXIT=0
$ docker run -d … rc5-e1suite-boot8（二次启动，幂等核对）  # EXIT=0
```
