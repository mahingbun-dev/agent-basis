#!/usr/bin/env node
/**
 * 发布说明脚手架(55 号 §5.4 第 2 步)。
 *
 * 用法:
 *   node scripts/release-notes-new.mjs 0.2.2 [--set-version]
 *
 * - 建 `releases/<v>/release.json`(cover + 4 feature + end 骨架)与 `assets/`;
 * - `--set-version` 同时把仓库根 `VERSION` 改成该版本(唯一事实源);
 * - 骨架里的占位文案含 TODO、媒体引用指向不存在的文件——**故意让门禁红着**,
 *   因为接下来必须补文案与截图。骨架能过门禁,才是「空着不写」的口子。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9a-z.]+)?$/

const version = process.argv[2]
if (version === undefined || !VERSION_RE.test(version)) {
  console.error('用法: node scripts/release-notes-new.mjs <x.y.z[-tag]> [--set-version]')
  process.exit(2)
}
const setVersion = process.argv.includes('--set-version')
const dir = join(repoRoot, 'releases', version)
if (existsSync(dir)) {
  console.error(`releases/${version} 已存在——同版本重发会让已读用户看不到新内容,请升版本号`)
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const skeleton = {
  version,
  releasedAt: today,
  announce: !version.includes('-'),
  theme: 'TODO 一句话主题（≤18 字）',
  summary: 'TODO 两句话说明本次更新的重点（面向用户，不用内部代号）。',
  highlights: [
    { n: '01', text: 'TODO 亮点一' },
    { n: '02', text: 'TODO 亮点二' },
    { n: '03', text: 'TODO 亮点三' },
  ],
  slides: [
    { id: 'cover', kind: 'cover', title: 'TODO 主题（与 theme 一致）' },
    {
      id: 'feature-1',
      kind: 'feature',
      kicker: 'TODO 分类',
      title: 'TODO 标题（≤18 字）',
      body: 'TODO 正文（≤120 字）：用户能感知到什么变化。',
      facts: ['TODO 要点（≤24 字）'],
      media: { src: '01-feature-1.webp', alt: 'TODO 截图的完整描述（无障碍文本）', caption: 'TODO 图注（≤40 字）' },
    },
    {
      id: 'feature-2',
      kind: 'feature',
      kicker: 'TODO 分类',
      title: 'TODO 标题（≤18 字）',
      body: 'TODO 正文（≤120 字）。',
      facts: ['TODO 要点（≤24 字）'],
      media: { src: '02-feature-2.webp', alt: 'TODO 截图描述', caption: 'TODO 图注' },
    },
    {
      id: 'feature-3',
      kind: 'feature',
      kicker: 'TODO 分类',
      title: 'TODO 标题（≤18 字）',
      body: 'TODO 正文（≤120 字）。',
      facts: ['TODO 要点（≤24 字）'],
      media: { src: '03-feature-3.webp', alt: 'TODO 截图描述', caption: 'TODO 图注' },
    },
    {
      id: 'feature-4',
      kind: 'feature',
      kicker: 'TODO 分类',
      title: 'TODO 标题（≤18 字）',
      body: 'TODO 正文（≤120 字）。',
      facts: ['TODO 要点（≤24 字）'],
      media: { src: '04-feature-4.webp', alt: 'TODO 截图描述', caption: 'TODO 图注' },
    },
    {
      id: 'end',
      kind: 'end',
      title: 'TODO 收尾标题',
      body: 'TODO 收尾说明。',
      links: [
        { label: '完整更新记录', note: '设置 → 更新记录', action: 'settings.release-notes' },
        { label: '直接开始用', note: '说明随时可回看', action: 'dialog.close' },
      ],
      footerNote: 'TODO 反馈渠道。',
    },
  ],
}

mkdirSync(join(dir, 'assets'), { recursive: true })
writeFileSync(join(dir, 'release.json'), `${JSON.stringify(skeleton, null, 2)}\n`)
if (setVersion) {
  writeFileSync(join(repoRoot, 'VERSION'), `${version}\n`)
} else {
  const current = readFileSync(join(repoRoot, 'VERSION'), 'utf8').trim()
  if (current !== version) {
    console.log(`提示:VERSION 仍是 ${current};发布前改 VERSION=${version}(或用 --set-version 重来)`)
  }
}

console.log(`已建 releases/${version}/release.json + assets/`)
console.log('下一步:')
console.log(`  1) 截图: node scripts/release-shots.mjs ${version}`)
console.log('  2) 改文案,把 TODO/占位标题全部替换掉(门禁会拦 TODO)')
console.log(`  3) 回填哈希: node scripts/release-notes-gate.mjs --version=${version} --hash`)
console.log(`  4) 过门禁: node scripts/release-notes-gate.mjs --version=${version}`)
console.log('  5) 部署前: bash deploy/release-notes-check.sh')