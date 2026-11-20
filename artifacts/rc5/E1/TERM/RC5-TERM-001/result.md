# RC5-TERM-001 · profile 含 terminal bundle

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-19T23:26:01.350Z / 2026-11-19T23:26:01.351Z

## 预期

`dsh-experimental-terminal-bundle` 在 profile bundle 清单

## 实际

已渲染 profile package.json 的 dsh.profile.bundles 含 @deepseek-ai/dsh-experimental-terminal-bundle

## 证据附件

- `cmd.log`

## 执行命令

```
$ node -e "require($DSH_HOME/profiles/eterna-web/package.json).dsh.profile.bundles"  # EXIT=0
$ node scripts/verify-terminal-guard.mjs ...（脚本内 007 行同时核对 bundles-terminal）  # EXIT=0
```
