# RC5-BOOT-006 · rc.5 新增行全部到位

- 套件：BOOT
- 结论：**PASS**
- 开始/结束：2026-11-20T01:42:43.784Z / 2026-11-20T01:42:43.785Z

## 预期

agent-team、tool-agent-team、ui-agent-team、ui-file-actions、ui-context-menu、mcp-manager、office-kit、skill-office、deepseek-chat-import 全部在组合树中且启用

## 实际

missing=none disabled=none

## 备注

- `enabled` 判定=该 id 至少一处未标 `disabled: true`

## 证据附件

- `dump-config.yml`
- `rows.json`
- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite sh -c 'DSH_HOME=/data dsh --profile eterna-web --dump-config  > /tmp/dump-eterna-web-1795138963573.yml; echo EXIT=$?; wc -c < /tmp/dump-eterna-web-1795138963573.yml' && docker cp rc5-e1suite:/tmp/dump-eterna-web-1795138963573.yml  # EXIT=0
```
