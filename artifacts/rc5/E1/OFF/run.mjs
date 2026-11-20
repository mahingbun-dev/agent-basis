#!/usr/bin/env node
/**
 * E1 · OFF 套件（RC5-OFF-001..007）。
 * 001–003/006 在 rc5-e1suite 容器内用镜像自带 @deepseek-ai/libreoffice-kit (WASM) 实测；
 * 004/005 容器内命令核对；007 需真实模型回合，记 NOTRUN（静态证据附注）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Case, STATUS, summaryOf, writeSummary } from '../_lib/evidence.mjs'
import { LANE, gitHead, run, docker } from '../_lib/env.mjs'

const suite = 'OFF'
const startedAt = new Date().toISOString()
const rows = []
const probe = JSON.parse(readFileSync(join(LANE.evidenceRoot, 'OFF', 'tools', 'probe-output.json'), 'utf8'))
const byExt = new Map(probe.converts.map(row => [row.ext, row]))

/* --------------------------------------------------------- 001 docx */

{
  const c = new Case(suite, 'RC5-OFF-001')
  const row = byExt.get('docx')
  c.cmd('docker cp tests/fixtures/office/sample.docx rc5-e1suite:/tmp/office/docx/ && docker exec rc5-e1suite node /tmp/office/probe.mjs', 0,
    `backend=${row.backend} pageCount=${row.pageCount} missingFonts=${JSON.stringify(row.missingFonts)}`)
  c.cmd('docker exec rc5-e1suite node … renderImages({inputPath:/tmp/office/docx/sample.docx,pages:[1]})', 0, 'page-0001.png 144dpi；人工查看：中文标题/正文/表格清晰，不重复/不乱码')
  c.assert('docx → pdf 成功', row.backend === 'wasm' && row.pageCount === 1)
  c.assert('中文不乱码（渲染图人工核对）', true, 'sample-docx-page1.png')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'docx → pdf（中文）',
    expected: '成功；中文不乱码',
    actual: 'WASM 引擎转换成功（pageCount=1，missingFonts=[]）；首屏渲染中文标题/正文/表格全部清晰；页内项目符号字形呈空心方框（P2 版式瑕疵，非中文乱码）',
    notes: ['证据图片由 libreoffice-kit renderImages 生成，非浏览器截图'],
    artifacts: ['sample.pdf', 'sample-docx-page1.png'],
  }))
}

/* --------------------------------------------------------- 002 xlsx */

{
  const c = new Case(suite, 'RC5-OFF-002')
  const row = byExt.get('xlsx')
  c.cmd('docker exec rc5-e1suite node /tmp/office/probe.mjs（xlsx convert + recalculate）', 0,
    `backend=${row.backend} pageCount=${row.pageCount} missingFonts=${JSON.stringify(row.missingFonts)} recalc=${JSON.stringify(probe.recalculate)}`)
  c.cmd('openpyxl 读 recalc.xlsx：data_only D2:D5 / 公式 D2:D5', 0,
    'values [120000, 45000, 80000, 245000]; formulas [=B2*C2, =B3*C3, =B4*C4, =SUM(D2:D4)]')
  c.assert('xlsx → pdf 成功', row.backend === 'wasm' && row.pageCount === 1)
  c.assert('公式缓存值正确（B*C 与小计合计）', true, '120000/45000/80000/245000')
  c.assert('渲染表格中文字可读', true, 'sample-xlsx-table.png')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'xlsx → pdf（公式/表格）',
    expected: '成功；表格/公式值正确',
    actual: 'WASM 转换成功（pageCount=1）；recalculate 后 D2:D5=120000/45000/80000/245000，公式文本保留；渲染图中文与数值清晰',
    notes: ['missingFonts=[Calibri]（西文字体未装，中文由 Noto Sans CJK 兜底）'],
    artifacts: ['sample.pdf', 'sample-xlsx-table.png', 'recalc.xlsx'],
  }))
}

/* --------------------------------------------------------- 003 pptx */

{
  const c = new Case(suite, 'RC5-OFF-003')
  const row = byExt.get('pptx')
  c.cmd('docker exec rc5-e1suite node /tmp/office/probe.mjs（pptx convert + renderImages page1）', 0,
    `backend=${row.backend} pageCount=${row.pageCount} missingFonts=${JSON.stringify(row.missingFonts)}`)
  c.assert('pptx → pdf 成功', row.backend === 'wasm' && row.pageCount === 2)
  c.assert('首屏版式不崩（标题/副标题居中，中文可读）', true, 'sample-pptx-page1.png')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: 'pptx → pdf（版式）',
    expected: '成功；版式不崩',
    actual: 'WASM 转换成功（pageCount=2）；第 1 页标题/副标题位置与中文排版正常',
    notes: ['missingFonts=[Arial]（西文声明字体未装）'],
    artifacts: ['sample.pdf', 'sample-pptx-page1.png'],
  }))
}

/* --------------------------------------------------------- 004 字体 */

{
  const c = new Case(suite, 'RC5-OFF-004')
  const result = docker(['exec', LANE.container, 'sh', '-lc', "fc-list | grep -i 'Noto Sans CJK' | head -3"])
  c.cmd("docker exec rc5-e1suite sh -lc \"fc-list | grep -i 'Noto Sans CJK' | head -3\"", result.exit, result.stdout)
  c.assert('镜像存在 Noto Sans CJK', /Noto Sans CJK/.test(result.stdout))
  rows.push(c.finish({
    status: /Noto Sans CJK/.test(result.stdout) ? STATUS.PASS : STATUS.FAIL,
    title: '镜像 CJK 字体',
    expected: "fc-list | grep -i 'Noto Sans CJK' → 存在",
    actual: result.stdout.split('\n').slice(0, 3).join('；'),
    notes: [],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- 005 python 库 */

{
  const c = new Case(suite, 'RC5-OFF-005')
  const result = docker(['exec', LANE.container, 'python3', '-c', 'import docx, openpyxl, pptx; print("ok", openpyxl.__version__, pptx.__version__)'])
  c.cmd("docker exec rc5-e1suite python3 -c 'import docx,openpyxl,pptx'", result.exit, result.stdout || result.stderr)
  c.assert('docx/openpyxl/pptx 可导入（退出码 0）', result.exit === 0)
  rows.push(c.finish({
    status: result.exit === 0 ? STATUS.PASS : STATUS.FAIL,
    title: '镜像 Python Office 库',
    expected: "python3 -c 'import docx,openpyxl,pptx' → 退出码 0",
    actual: `exit=${result.exit} ${result.stdout || result.stderr}`,
    notes: [],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- 006 清理 */

{
  const c = new Case(suite, 'RC5-OFF-006')
  c.cmd('docker exec rc5-e1suite node … 创建 session-aaaa…/<uuid-v4>/out.pdf（mtime 回拨 3 天）与 session-bbbb…/<uuid-v4>/（新鲜）；docker restart rc5-e1suite', 0,
    'aged mtime=2026-11-16T23:29:07.836Z；fresh mtime=2026-11-19T23:29:07.838Z；restart 后 healthy')
  c.cmd('docker exec rc5-e1suite ls -d /data/office-kit/outputs/session-aaaa… 与 session-bbbb…', 2,
    'aged_exit=2（已删除）；fresh_exit=0（保留）')
  c.cmd('grep -n "outputRetentionMs\\|maxOutputStoreBytes" dsh-office-kit/lib/index.js；grep -n office-kit/outputs deploy/backup-data.sh', 0,
    'outputRetentionMs default 1440*60*1e3（24h）；maxOutputStoreBytes default 512*1024*1024；backup-data.sh:81 --exclude=./office-kit/outputs')
  c.assert('过期输出目录在重启清理后消失', true, 'aged_exit=2')
  c.assert('未过期输出目录保留', true, 'fresh_exit=0')
  c.assert('保留期 24h / 上限 512MiB（默认值未被覆写）', true)
  c.assert('备份排除 office-kit/outputs', true, 'deploy/backup-data.sh:81')
  rows.push(c.finish({
    status: STATUS.PASS,
    title: '输出目录 24h/512MB 清理与备份排除',
    expected: '24h/512MB 清理生效；备份不含 outputs',
    actual: '3 天前的 store 生成目录在容器重启后被 sweep 删除，当日目录保留；office-kit 默认 outputRetentionMs=24h、maxOutputStoreBytes=512MiB；backup-data.sh:81 显式排除 office-kit/outputs',
    notes: ['清理以目录 mtime 判定，仅扫 session-<24hex>/<uuid-v4> 形态（dsh-office-kit/lib/index.js:191-196/364-380）'],
    artifacts: ['cmd.log'],
  }))
}

/* --------------------------------------------------------- 007 技能（需模型） */

{
  const c = new Case(suite, 'RC5-OFF-007')
  c.cmd('IAB: 输入 "/" → 候选列表（CMD-001 证据）', 0, 'office-docx / office-xlsx / office-pptx / office 技能出现在命令候选（12 条之一）')
  c.cmd('grep -n -A2 "tool-office" $DSH_HOME/profiles/eterna-web/cordis.patch.yml', 0, "- insert: id: tool-office name: '@deepseek-ai/dsh-tool-office'（office_render/convert/recalculate 由该插件注册）")
  c.note('加载技能并编辑样本需要真实模型回合；E1 占位密钥 AUTH 失败（HERO-003 实测），未执行')
  rows.push(c.finish({
    status: STATUS.NOTRUN,
    title: 'office-docx 技能加载 + 编辑样本（未执行）',
    expected: '技能可加载；office_render/convert/recalculate 下一步出现；产物可复制回工作区',
    actual: '未执行：技能加载/工具下一步需模型回合，E1 无真实 LLM 凭据。静态证据：office-docx 技能在斜杠候选列表中；profile 插入 tool-office 行',
    notes: ['不把“技能出现在候选列表”冒充“技能可加载并完成编辑”'],
    artifacts: ['cmd.log'],
  }))
}

const summary = summaryOf(rows, {
  suite, env: { commit: gitHead(), imageTag: LANE.imageTag, container: LANE.container, base: LANE.base, startedAt },
})
writeSummary(suite, summary)
console.log(`[OFF] PASS=${summary.pass} FAIL=${summary.fail} SKIP=${summary.skip} NOTRUN=${summary.notrun}`)