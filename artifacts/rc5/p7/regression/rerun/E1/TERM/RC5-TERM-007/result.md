# RC5-TERM-007 · 容器终端配置

- 套件：TERM
- 结论：**PASS**
- 开始/结束：2026-11-20T01:42:00.730Z / 2026-11-20T01:42:00.730Z

## 预期

readUserTerminals=false；preferredShells=[bash]

## 实际

渲染 patch 的 optional-terminal-panel 配置为 preferredShells:[bash]、readUserTerminals:false，实测读回一致

## 备注

- 在 004 红之前由同一脚本执行完成，保留结果

## 证据附件

- `cmd.log`

## 执行命令

```
$ node scripts/verify-terminal-guard.mjs ...（脚本内 007 行，先于 004 执行）  # EXIT=0
$ grep -n -A6 "optional-terminal-panel" $DSH_HOME/profiles/eterna-web/cordis.patch.yml  # EXIT=0
```
