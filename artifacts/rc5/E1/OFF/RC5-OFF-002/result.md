# RC5-OFF-002 · xlsx → pdf（公式/表格）

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:23.855Z / 2026-11-20T07:03:23.856Z

## 预期

成功；表格/公式值正确

## 实际

WASM 转换成功（pageCount=1）；recalculate 后 D2:D5=120000/45000/80000/245000，公式文本保留；渲染图中文与数值清晰

## 备注

- missingFonts=[Calibri]（西文字体未装，中文由 Noto Sans CJK 兜底）

## 证据附件

- `sample.pdf`
- `sample-xlsx-table.png`
- `recalc.xlsx`

## 执行命令

```
$ docker exec rc5-e1suite node /tmp/office/probe.mjs（xlsx convert + recalculate）  # EXIT=0
$ openpyxl 读 recalc.xlsx：data_only D2:D5 / 公式 D2:D5  # EXIT=0
```
