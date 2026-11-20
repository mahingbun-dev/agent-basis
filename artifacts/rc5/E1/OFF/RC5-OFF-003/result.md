# RC5-OFF-003 · pptx → pdf（版式）

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-20T07:03:23.856Z / 2026-11-20T07:03:23.856Z

## 预期

成功；版式不崩

## 实际

WASM 转换成功（pageCount=2）；第 1 页标题/副标题位置与中文排版正常

## 备注

- missingFonts=[Arial]（西文声明字体未装）

## 证据附件

- `sample.pdf`
- `sample-pptx-page1.png`

## 执行命令

```
$ docker exec rc5-e1suite node /tmp/office/probe.mjs（pptx convert + renderImages page1）  # EXIT=0
```
