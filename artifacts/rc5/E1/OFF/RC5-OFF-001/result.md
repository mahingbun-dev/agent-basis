# RC5-OFF-001 · docx → pdf（中文）

- 套件：OFF
- 结论：**PASS**
- 开始/结束：2026-11-19T23:29:57.674Z / 2026-11-19T23:29:57.675Z

## 预期

成功；中文不乱码

## 实际

WASM 引擎转换成功（pageCount=1，missingFonts=[]）；首屏渲染中文标题/正文/表格全部清晰；页内项目符号字形呈空心方框（P2 版式瑕疵，非中文乱码）

## 备注

- 证据图片由 libreoffice-kit renderImages 生成，非浏览器截图

## 证据附件

- `sample.pdf`
- `sample-docx-page1.png`

## 执行命令

```
$ docker cp tests/fixtures/office/sample.docx rc5-e1suite:/tmp/office/docx/ && docker exec rc5-e1suite node /tmp/office/probe.mjs  # EXIT=0
$ docker exec rc5-e1suite node … renderImages({inputPath:/tmp/office/docx/sample.docx,pages:[1]})  # EXIT=0
```
