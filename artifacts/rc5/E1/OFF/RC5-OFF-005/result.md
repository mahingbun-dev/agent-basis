# RC5-OFF-005 · 镜像 Python Office 库

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-19T23:29:57.752Z / 2026-11-19T23:29:57.919Z

## 预期

python3 -c 'import docx,openpyxl,pptx' → 退出码 0

## 实际

exit=0 ok 3.0.9 1.0.2

## 证据附件

- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite python3 -c 'import docx,openpyxl,pptx'  # EXIT=0
```
