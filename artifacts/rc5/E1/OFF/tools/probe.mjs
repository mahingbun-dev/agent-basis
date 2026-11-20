import { createConverter } from '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/libreoffice-kit/lib/index.js'

const converter = await createConverter({ timeoutMs: 240_000 })
const out = { backend: converter.backend, converts: [], recalculate: null, renders: [] }
try {
  for (const ext of ['docx', 'xlsx', 'pptx']) {
    const result = await converter.convert({
      inputPath: `/tmp/office/${ext}/sample.${ext}`,
      outputPath: `/tmp/office/${ext}/sample.pdf`,
    })
    out.converts.push({ ext, ...result })
  }
  out.recalculate = await converter.recalculate({
    inputPath: '/tmp/office/xlsx/sample.xlsx',
    outputPath: '/tmp/office/xlsx/recalc.xlsx',
  })
  for (const [ext, request] of [
    ['docx', { inputPath: '/tmp/office/docx/sample.docx', outputDir: '/tmp/office/render/docx', pages: [1], dpi: 144 }],
    ['xlsx', { inputPath: '/tmp/office/xlsx/sample.xlsx', outputDir: '/tmp/office/render/xlsx', sheet: '预算明细', range: 'A1:D5', dpi: 144 }],
    ['pptx', { inputPath: '/tmp/office/pptx/sample.pptx', outputDir: '/tmp/office/render/pptx', pages: [1], dpi: 144 }],
  ]) {
    const result = await converter.renderImages(request)
    out.renders.push({ ext, ...result })
  }
  console.log(JSON.stringify(out, null, 1))
} finally {
  await converter.dispose()
}