#!/usr/bin/env node
/**
 * 汇总 T08/T09 lane 证据 → artifacts/rc5/p1/env-api.json（只写该文件）。
 * 数据全部来自本 lane 已执行的命令与落盘日志；不重新跑检查。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const readJson = rel => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'))
const pins = readJson('artifacts/rc5/p1/env-api-logs/version-pins.json')
const staticReport = readJson('artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.json')
const section = id => staticReport.sections.find(item => item.id === id)
const assertions = id => section(id).assertions

/** 从 vitest 日志提取 "N 个测试文件 / M tests"；日志缺失即抛错，不猜数。 */
function vitestStats(rel) {
  const text = readFileSync(join(ROOT, rel), 'utf8')
  const files = text.match(/^ Test Files\s+(\d+) passed \((\d+)\)/m)
  const tests = text.match(/^      Tests\s+(\d+) passed \((\d+)\)/m)
  if (files === null || tests === null) throw new Error(`无法从 ${rel} 解析测试计数`)
  if (files[1] !== files[2] || tests[1] !== tests[2]) throw new Error(`${rel} 计数不自洽: ${files[0]} / ${tests[0]}`)
  return { files: Number(files[1]), tests: Number(tests[1]) }
}
const api001 = vitestStats('artifacts/rc5/p1/env-api-logs/api-001-compaction-verify.log')
const api002 = vitestStats('artifacts/rc5/p1/env-api-logs/api-002-memory-verify.log')
const api004 = vitestStats('artifacts/rc5/p1/env-api-logs/api-004-tasks-verify.log')

/** snapshot.txt 的 key=value 头（capturedAt/branch/head/...）；文件哈希行另存。 */
const snapshotText = readFileSync(join(ROOT, 'artifacts/rc5/p1/env-api-logs/snapshot.txt'), 'utf8')
const snapshot = Object.fromEntries(
  snapshotText.split('\n')
    .filter(line => /^[A-Za-z]+=/.test(line))
    .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
)

const env003 = section('ENV-003')
const env002 = section('ENV-002')
const env006 = section('ENV-006')
const env004 = section('ENV-004')
const api008 = section('API-008')
const api009 = section('API-009')

const env002Hits = env002.hits.map(hit => ({
  path: hit.path,
  line: hit.line,
  token: hit.token,
  kind: hit.kind,
  text: hit.text,
}))

const categories = {
  imagePin: {
    severity: 'P0',
    count: 1,
    items: env002Hits.filter(hit => hit.path === 'Dockerfile'),
    note: 'Dockerfile:63 仍是 0.2.2-alpha.3（dsh + dsh-mcp-client），ENV-006 与 ENV-004 静态半因此红。',
  },
  publishedManifestGenerator: {
    severity: 'P1',
    count: 5,
    items: env002Hits.filter(hit => hit.path === 'scripts/build-market.mjs'),
    note: '生成器把 >=4.0.6-alpha.1 / >=0.2.2-alpha.2 写进市场包清单；market/{glue,pack}-bundle 的现成清单就是它的产物。',
  },
  checkedInManifestFloors: {
    severity: 'WARN',
    count: 4,
    items: env002Hits.filter(hit => /^(market|packs)\//.test(hit.path) && hit.kind === 'live'),
    note: '4 条 >=4.0.6-alpha.1 是旧下限（非钉版，仍可解析 4.1.0）；ENV-003 记 WARN。',
  },
  runtimeDefault: {
    severity: 'P1',
    count: 1,
    items: env002Hits.filter(hit => hit.path === 'packages/access/src/market-publish.ts'),
    note: 'ETERNA_MARKET_DSH_RANGE 缺省仍是 >=0.2.2-alpha.2，发布的市场清单会带旧下限。',
  },
  smokeHarness: {
    severity: 'P1',
    count: 14,
    items: env002Hits.filter(hit =>
      hit.path === 'packages/browser-relay/smoke/gate-setup.mjs'
      || /^scripts\/(t7-(e2e|smoke|spike-verify)|ps-v2-ai-smoke)\.mjs$/.test(hit.path)),
    note: 'gate-setup 在 pnpm 目录查找 rc.1 包；本工作树 node_modules/.pnpm 中 rc.1 条目实测 0 个（rc.5 preset/mcp-client 在），firstPnpm 会抛「pnpm 内找不到」。t7/ps-v2 脚本生成的临时 profile 仍钉 rc.1。',
  },
  testFixture: {
    severity: 'P3',
    count: 4,
    items: env002Hits.filter(hit => /\.(test|spec)\.(ts|tsx)$/.test(hit.path)),
    note: '夹具/断言里的旧版本字面量；按 51 ENV-002「全仓命中 0」口径仍计入，但非生产默认。',
  },
}

const api009Comparisons = [
  {
    path: 'core/cordis/src/logger.ts',
    line: 96,
    code: 'const colors = !level ? [] : level >= 2 ? c256 : c16',
    verdict: 'allow',
    reason: 'vendor 配色选择；与实装 @deepseek-ai/cordis@4.1.0 lib/index.js:1007 逐字相同；只影响 ANSI 调色板，不影响消息是否输出。',
  },
  {
    path: 'packages/tasks/src/store/store.ts',
    line: 230,
    code: 'const parent = level > 0 ? this.committed[level - 1] : undefined',
    verdict: 'allow',
    reason: 'SQLite SAVEPOINT 嵌套深度（同文件 level = this.depth++），与 LoggerLevel 无关。',
  },
]

const report = {
  schema: 'rc5-p1-env-api/2',
  generatedAt: new Date().toISOString(),
  generatedBy: 'T08/T09 版本证据 lane（本文件由已执行命令的日志汇总）',
  worktree: ROOT,
  branch: 'feat/dsh-rc5-merge',
  head: '02f485788411b9aed1938a3c4b009793a090961e',
  headSubject: 'rc5: P1 依赖族统一 0.2.2-rc.5 + H1 LlmError + subagent/流动作适配 + UI 桥接补全',
  snapshot: {
    capturedAt: snapshot.capturedAt,
    worktreeDirtyFiles: Number(snapshot.worktreeDirtyFiles),
    hashes: 'artifacts/rc5/p1/env-api-logs/snapshot.txt',
    note: 'HEAD 未变；工作树有其他 lane 并行改动。本报告的所有检查在 capturedAt 前后按同一快照重跑过一轮。',
  },
  readingGuide: 'verify-rc5-env.mjs 的 check：exitCode 是整脚本退出码（任一硬门禁红即 1），单节判定看 sectionStatus；pnpm 命令的 exitCode 即该命令退出码。',
  concurrentWorktreeChanges: [
    'packages/access/package.json（02:20:31，并行 lane）：新增 @deepseek-ai/dsh-mcp-client / @deepseek-ai/dsh-scope（均 catalog:）；dsh* spec 61→63、dsh-family spec 86→88，不影响钉版结论',
    'packages/tasks 测试数 863→864（并行 lane 新增一例；最终值以本报告解析的日志为准）',
    'core/cordis/package.json：版本 4.0.6-alpha.1-basis.1→4.1.0-basis.1（并行 lane 的 RC5 升级；core/ 属清单扫描豁免面）',
  ],
  toolchain: {
    node: 'v24.18.0',
    pnpm: '11.7.0',
    installedDsh: '0.2.2-rc.5',
    installedCordis: '4.1.0',
    installedCosmokit: '1.9.0',
  },
  scope: {
    ask: '54 §4.3 T08/T09；51 ENV-001..003/007/008、API-001..004/008/009',
    run: [
      'ENV-002 全仓版本残留（脚本扫描 + 独立结构化清单扫描）',
      'ENV-003 版本族（46 个清单 + catalog）',
      'ENV-004 静态代理（workspace 实装 + Dockerfile 钉版）',
      'ENV-006 Dockerfile 内核钉版',
      'ENV-008 / API-003 llm-openai typecheck',
      'API-001 compaction verify',
      'API-002 memory verify',
      'API-004 tasks verify',
      'API-008 LlmError 构造签名静态扫描',
      'API-009 LoggerLevel 常量/数值比较静态扫描',
    ],
    notRun: [
      'ENV-001 pnpm install --frozen-lockfile（归主线 T08 门禁）',
      'ENV-007 pnpm -w run verify（按本 lane 指令不跑全仓 verify，主线门禁执行）',
      'ENV-004 运行时半（容器内 dsh --version，需 P5 镜像）',
      'API-005..007（E3 worker E2E，归 P6）',
      'API-009 行为半（触发 debug/info/warn 的 E2E，归 T49e）',
    ],
  },
  verdict: {
    overall: 'fail',
    taskItem1: {
      status: 'pass',
      detail: 'package.json(46 清单,免 v1/core)/pnpm-workspace.yaml/tools/packs/market 中 0.2.1 / 0.2.2-rc.1 / 4.0.6 钉版 = 0；另有 4 条 >=4.0.6-alpha.1 旧下限（非钉版，WARN）。',
    },
    hardGateFailures: [
      ...staticReport.summary.blockers,
      'ENV-008/API-003: pnpm --filter @eterna/llm-openai typecheck EXIT 2 — src/adapter.ts(107,9) TS2345（`HTTP_${string}` 不匹配 BuiltinLlmFailureCode）',
    ],
    warnings: staticReport.summary.warnings,
  },
  residue: {
    narrowSurface: {
      command: 'node artifacts/rc5/p1/env-api-logs/scan-version-pins.mjs',
      exitCode: 0,
      log: 'artifacts/rc5/p1/env-api-logs/version-pins.json',
      manifestScope: pins.manifestScope,
      manifestsScanned: pins.manifestsScanned,
      coverageByTopDir: readJson('artifacts/rc5/p1/env-api-logs/manifest-coverage.json').byTopDir,
      dshFamilySpecs: pins.dshFamilySpecs,
      specCounts: pins.specCounts,
      stalePins: pins.stalePins,
      staleFloors: pins.staleFloors,
      catalog: pins.catalog,
      verdict: 'stalePins=0（第 1 项达标）；staleFloors=4（WARN）',
    },
    pnpmStoreProbe: {
      command: "find node_modules/.pnpm -maxdepth 1 -name '*0.2.2-rc.1*' | wc -l（及 rc.5 preset/mcp-client 对照）",
      log: 'artifacts/rc5/p1/env-api-logs/pnpm-store-probe.log',
      rc1Entries: 0,
      rc5AgentPresetEntries: 2,
      rc5McpClientEntries: 1,
      note: 'gate-setup.mjs 的 firstPnpm 查找 rc.1 条目会落空并抛「pnpm 内找不到」；rc.5 条目存在。',
    },
    fullRepoEnv002: {
      command: 'node scripts/verify-rc5-env.mjs --api-static --json artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.json',
      sectionStatus: env002.status,
      gatedCount: env002.gatedCount,
      scannedFiles: env002.scannedFiles,
      selfScanned: env002.selfScanned,
      categories,
      informational: {
        comments: env002.informational.comments.total,
        docs: env002.informational.docs.total,
        manifestProse: env002.informational.manifestProse.total,
        weakBareTokens: env002.informational.weakBareTokens.total,
        note: '历史叙述/注释/清单 description 只留痕不门禁；完整前 400 条见 verify-rc5-env-api-static.json。',
      },
    },
  },
  checks: [
    {
      id: 'SELF',
      status: 'pass',
      command: 'node scripts/verify-rc5-env.mjs --api-static',
      exitCode: 1,
      sectionStatus: section('SELF').status,
      assertions: assertions('SELF'),
      note: 'exitCode 为整脚本退出码；SELF 节本身 PASS（16/16 规则样例）。',
    },
    {
      id: 'ENV-002',
      status: 'fail',
      command: 'node scripts/verify-rc5-env.mjs --api-static --json artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.json',
      exitCode: 1,
      sectionStatus: env002.status,
      assertions: assertions('ENV-002'),
      hitsTotal: env002.gatedCount,
      hits: env002Hits,
      log: 'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    },
    {
      id: 'ENV-003',
      status: 'warn',
      command: 'node scripts/verify-rc5-env.mjs --api-static',
      exitCode: 1,
      sectionStatus: env003.status,
      assertions: assertions('ENV-003'),
      hitsTotal: env003.hits.length,
      hits: env003.hits,
      scanned: env003.scanned,
      log: 'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    },
    {
      id: 'ENV-004',
      status: 'fail',
      command: 'node scripts/verify-rc5-env.mjs --api-static',
      exitCode: 1,
      sectionStatus: env004.status,
      assertions: assertions('ENV-004'),
      runtime: 'not-run',
      note: '静态半通过 workspace 实装 rc.5，但 Dockerfile 钉 alpha.3 ⇒ 镜像静态代理失败；容器内 dsh --version 未跑。',
      log: 'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    },
    {
      id: 'ENV-006',
      status: 'fail',
      command: 'node scripts/verify-rc5-env.mjs --api-static',
      exitCode: 1,
      sectionStatus: env006.status,
      assertions: assertions('ENV-006'),
      hitsTotal: env006.hits.length,
      hits: env006.hits,
      log: 'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    },
    {
      id: 'ENV-008',
      status: 'fail',
      command: 'pnpm --filter @eterna/llm-openai typecheck',
      exitCode: 2,
      assertions: [
        { name: 'typecheck 退出码 0', ok: false, detail: 'Exit status 2；src/adapter.ts(107,9): error TS2345' },
      ],
      log: 'artifacts/rc5/p1/env-api-logs/llm-openai-typecheck.log',
      sameEvidenceAs: 'API-003',
    },
    {
      id: 'API-001',
      status: 'pass',
      command: 'pnpm --filter @eterna/compaction verify',
      exitCode: 0,
      assertions: [
        { name: 'build:client + oxlint + tsc + vitest 全绿', ok: true, detail: `${api001.files} 个测试文件 / ${api001.tests} tests 通过；oxlint 0 warnings 0 errors` },
      ],
      log: 'artifacts/rc5/p1/env-api-logs/api-001-compaction-verify.log',
    },
    {
      id: 'API-002',
      status: 'pass',
      command: 'pnpm --filter @eterna/memory verify',
      exitCode: 0,
      assertions: [
        { name: 'build:client + oxlint + tsc + vitest 全绿', ok: true, detail: `${api002.files} 个测试文件 / ${api002.tests} tests 通过；oxlint 0 warnings 0 errors` },
      ],
      log: 'artifacts/rc5/p1/env-api-logs/api-002-memory-verify.log',
    },
    {
      id: 'API-003',
      status: 'fail',
      command: 'pnpm --filter @eterna/llm-openai typecheck',
      exitCode: 2,
      assertions: [
        { name: 'typecheck 退出码 0', ok: false, detail: 'src/adapter.ts(107,9): error TS2345: Argument of type `HTTP_${string}` is not assignable to parameter of type BuiltinLlmFailureCode' },
      ],
      log: 'artifacts/rc5/p1/env-api-logs/llm-openai-typecheck.log',
    },
    {
      id: 'API-004',
      status: 'pass',
      command: 'pnpm --filter @eterna/tasks verify',
      exitCode: 0,
      assertions: [
        { name: 'build:client + oxlint + tsc + vitest 全绿', ok: true, detail: `${api004.files} 个测试文件 / ${api004.tests} tests 通过；oxlint 0 warnings 0 errors` },
      ],
      log: 'artifacts/rc5/p1/env-api-logs/api-004-tasks-verify.log',
    },
    {
      id: 'API-008',
      status: 'fail',
      command: 'node scripts/verify-rc5-env.mjs --api-static',
      exitCode: 1,
      sectionStatus: api008.status,
      assertions: assertions('API-008'),
      constructionSites: api008.hits.filter(hit => hit.token === 'new-LlmError' || hit.token === 'invalid-llm-error-arg').length,
      violations: api008.hits.filter(hit => hit.kind === 'stale-signature'),
      fromFailureSites: api008.fromFailureSites,
      signature: {
        source: 'node_modules/.pnpm/@deepseek-ai+dsh-llm@0.2.2-rc.5_*/node_modules/@deepseek-ai/dsh-llm/lib/types/index.d.ts:67',
        ctor: 'constructor(message: string, code: BuiltinLlmFailureCode, options?: LlmErrorOptions)',
        codeType: 'BuiltinLlmFailureCode = keyof typeof LLM_FAILURE_CODES | `HTTP_${number}`',
        fromFailure: 'static fromFailure(failure: LlmFailure, options?: ErrorOptions): LlmError',
      },
      independentScan: 'artifacts/rc5/p1/env-api-logs/api-008-independent-scan.log',
      log: 'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    },
    {
      id: 'API-009',
      status: 'pass',
      command: 'node scripts/verify-rc5-env.mjs --api-static',
      exitCode: 1,
      sectionStatus: api009.status,
      assertions: assertions('API-009'),
      behavior: 'not-run',
      note: '静态半 PASS；真行为（触发 debug/info/warn）归 T49e，未跑。',
      log: 'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    },
  ],
  api009: {
    vendorSource: { path: 'core/cordis/src/logger.ts', line: 22, values: api009.assertions[0].detail },
    builtTypes: { path: 'core/cordis/lib/types/logger.d.ts', values: api009.assertions[1].detail },
    upstreamInstalled: {
      version: '4.1.0',
      src: 'node_modules/.pnpm/@deepseek-ai+cordis@4.1.0_*/node_modules/@deepseek-ai/cordis/src/logger.ts (const enum LoggerLevel: ERROR=0, WARN=1, INFO=2, DEBUG=3)',
      bundle: 'node_modules/.pnpm/@deepseek-ai+cordis@4.1.0_*/node_modules/@deepseek-ai/cordis/lib/index.js:1007 (level >= 2 ? c256 : c16)',
    },
    threshold: {
      symbol: 'exporter.levels?.[this.name] ?? exporter.levels?.default ?? this.level ?? LoggerLevel.INFO (logger.ts:159)',
      direction: 'targetLevel < level (logger.ts:160)',
    },
    numericComparisons: api009Comparisons,
    independentScan: {
      log: 'artifacts/rc5/p1/env-api-logs/api-009-independent-scan.log',
      summary: {
        levelVsLiteral: '3 处：vendor 配色 allow + tasks savepoint allow（另 2 条是扫描器自身的模式串）',
        literalVsLevel: '0 处（grep exit 1）',
        severityLiteralMaps: '仅 vendor 常量 + 2 条无关误报（tools/aievo-run.mjs 的 EXIT 码表、packages/tasks/src/effects/effects.ts 的 FAILURES_BEFORE_ERROR 重试阈值）',
        ordinalArrays: '仅 core/cordis/src/logger.ts:274 的方法注册数组（error/info/warn/debug 方法定义顺序，不做级别索引）',
      },
    },
    conclusion: '未发现按 4.0.6 旧数值（INFO=1/WARN=2）写死的判断；仓库源码对 LoggerLevel 的消费只有 vendor 自身，阈值缺省用 LoggerLevel.INFO 符号，过滤方向与上游 4.1.0 一致。',
  },
  leftovers: [
    'ENV-006-DOCKERFILE-ALPHA3 | Dockerfile:63 仍 npm i -g @deepseek-ai/dsh@0.2.2-alpha.3 与 dsh-mcp-client@0.2.2-alpha.3，ENV-006/ENV-004 静态半红 | P0 | 改钉 0.2.2-rc.5；按 49 §4 评估移除全局 dsh-mcp-client（宿主内嵌）',
    'API-003-LLMOPENAI-TS2345 | packages/llm-openai/src/adapter.ts:105-107 用 HTTP_${String(response.status)} 作 LlmError code，与 BuiltinLlmFailureCode 的 HTTP_${number} 不兼容，typecheck EXIT 2 | P0 | 改为裸数值模板 HTTP_${response.status}（String() 会退化成 HTTP_${string}）',
    'ENV-002-MARKET-GENERATOR | scripts/build-market.mjs:134-136/193-194 生成市场清单时写 >=4.0.6-alpha.1 / >=0.2.2-alpha.2，已生成的 market/{glue,pack}-bundle 与 packs/{event-planning,industrial-analysis} peer 落旧下限 | P1 | 生成器与现成清单统一改 >=0.2.2-rc.5 / >=4.1.0（或 catalog 同版）',
    'ENV-002-ACCESS-MARKET-DEFAULT | packages/access/src/market-publish.ts:59 缺省 ETERNA_MARKET_DSH_RANGE=\">=0.2.2-alpha.2\"，发布清单会带旧下限 | P1 | 缺省改 >=0.2.2-rc.5，同步 3 处 spec 夹具',
    'ENV-002-SMOKE-HARNESS-RC1 | packages/browser-relay/smoke/gate-setup.mjs:121-122 与 scripts/{t7-e2e,t7-smoke,t7-spike-verify,ps-v2-ai-smoke}.mjs 仍钉/查找 0.2.2-rc.1（共 14 处）；本工作树 pnpm 目录 rc.1 条目实测 0 个，gate-setup 的 firstPnpm 会抛「pnpm 内找不到」 | P1 | 改 rc.5；不随主线维护的 t7 系脚本显式标 legacy 并从 ENV-002 门禁豁免清单登记',
    'ENV-002-TEST-FIXTURES | packages/access/tests/market-publish.spec.ts:38/74/282 与 packages/brand/tests/brand.test.ts:183 的 rc.1/alpha.2 字面量（4 处） | P3 | 夹具改 rc.5，或门禁显式排除 tests/fixtures（否则「全仓命中 0」口径长期红）',
    'ENV-004-RUNTIME-NOTRUN | 容器内 dsh --version 未执行，需 P5 镜像 | P2 | P5 构建后补跑运行时半并归档容器输出',
    'API-009-BEHAVIOR-NOTRUN | 触发 debug/info/warn 的真行为未跑（51 API-009 的 S 半） | P2 | T49e E2E 触发三级日志，核对显示级别',
    'ENV-001-007-NOTRUN | install --frozen-lockfile 与全仓 pnpm -w run verify 未在本 lane 执行（按指令不跑全仓 verify） | P2 | 主线 T08 门禁执行并记录 EXIT/包数',
    'SCRIPT-SELF-EXEMPT | scripts/verify-rc5-env.mjs 在 ENV-002/API-008/API-009 扫描中跳过自身（模式串/断言文案必然含 token） | info | 以 16/16 样例自检 + 人工复核兜底；若要更严可把模式串外置 fixtures 并让扫描面包含脚本',
    'WORKTREE-CONCURRENT | 检查期间其他 lane 修改了 packages/access/package.json（+2 catalog 依赖）与 tasks 测试（863→864），HEAD 未变；证据已按 02:27Z 快照整体重跑 | info | 主线收口时在最终工作树上再跑一次 scripts/verify-rc5-env.mjs --api-static 与本组 pnpm 命令，避免并行改动漂移',
  ],
  evidenceFiles: [
    'artifacts/rc5/p1/env-api.json (本文件)',
    'artifacts/rc5/p1/env-api-logs/snapshot.txt',
    'artifacts/rc5/p1/env-api-logs/verify-rc5-env-env-only.log',
    'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.log',
    'artifacts/rc5/p1/env-api-logs/verify-rc5-env-api-static.json',
    'artifacts/rc5/p1/env-api-logs/version-pins.json',
    'artifacts/rc5/p1/env-api-logs/version-residue-manifests.txt',
    'artifacts/rc5/p1/env-api-logs/manifest-coverage.json',
    'artifacts/rc5/p1/env-api-logs/scan-version-pins.mjs',
    'artifacts/rc5/p1/env-api-logs/llm-openai-typecheck.log',
    'artifacts/rc5/p1/env-api-logs/api-001-compaction-verify.log',
    'artifacts/rc5/p1/env-api-logs/api-002-memory-verify.log',
    'artifacts/rc5/p1/env-api-logs/api-004-tasks-verify.log',
    'artifacts/rc5/p1/env-api-logs/api-008-independent-scan.log',
    'artifacts/rc5/p1/env-api-logs/api-009-independent-scan.log',
    'artifacts/rc5/p1/env-api-logs/pnpm-store-probe.log',
    'artifacts/rc5/p1/env-api-logs/evidence-sha256.txt',
  ],
  discipline: {
    fullRepoVerify: 'not-run（按指令留主线门禁）',
    containers: '未触碰任何容器/生产环境',
    git: '未 push/merge/commit',
    deepseekHarness: '未写入',
    sourceChanges: '本 lane 未改 packages/**、Dockerfile 等源码；只改动 scripts/verify-rc5-env.mjs（此前为未跟踪文件）与新增 artifacts/rc5/p1/env-api-logs/**、artifacts/rc5/p1/env-api.json',
    preexistingArtifacts: 'artifacts/rc5/p1/verify-rc5-env.{json,log} 与 h2-* 为先前/并行 lane 产物；本报告不引用其结论，全部证据来自 env-api-logs/ 下本次执行',
    credentials: '证据脚本 walk 层强制跳过 .secrets/.env*（ENV-002 另有「扫描面 0 凭据文件」硬断言）；人工只查看过 .env.example（空占位，无凭据）。证据中无密钥/token',
  },
}

writeFileSync(join(ROOT, 'artifacts/rc5/p1/env-api.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log('written artifacts/rc5/p1/env-api.json')
console.log(JSON.stringify({
  overall: report.verdict.overall,
  taskItem1: report.verdict.taskItem1.status,
  env002Hits: report.residue.fullRepoEnv002.gatedCount,
  leftovers: report.leftovers.length,
}, null, 2))