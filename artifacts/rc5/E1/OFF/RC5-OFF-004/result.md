# RC5-OFF-004 · 镜像 CJK 字体

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:23.856Z / 2026-11-20T07:03:23.936Z

## 预期

fc-list | grep -i 'Noto Sans CJK' → 存在

## 实际

/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc: Noto Sans CJK JP:style=Regular；/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc: Noto Sans CJK HK:style=Regular；/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc: Noto Sans CJK KR:style=Regular

## 证据附件

- `cmd.log`

## 执行命令

```
$ docker exec rc5-e1suite sh -lc "fc-list | grep -i 'Noto Sans CJK' | head -3"  # EXIT=0
```
