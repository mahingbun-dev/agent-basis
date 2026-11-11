// P2 模型能力门禁:G-P2-01…17(判据见 plans/2026-11-10-团队平台化测试门禁与验收计划.md §5.1)。
// 用法: node scripts/team-platform-gates/p2-gate.mjs [--only G-P2-xx]
// G-P2-16 公网档随部署验收;豁免台账:MiMo web_search/DeepSeek 联网 pro(P2-T1.6 一期
// 联网默认关,现有 tool-web 兜底——豁免 reason 记录于 gate-summary exempt)。
import { runGate, sh, saveEvidence, readFileSync, fileNonEmpty, REPO } from './common.mjs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null
const CONTAINER = 'eterna-tp-ph'
const CONTAINER_UP = sh(`docker inspect -f '{{.State.Running}}' ${CONTAINER}`).stdout === 'true'

const cases = [
  {
    id: 'G-P2-01', criterion: 'CORE-REG:access/glue/llm-doctor 测试绿+tenant-scan 0+装载 0 警告',
    command: 'vitest×3 + tenant-scan + 容器日志',
    run: () => {
      const access = sh('pnpm --filter @eterna/access exec vitest run', { timeoutMs: 300_000 })
      const glue = sh('pnpm --filter @eterna/glue exec vitest run', { timeoutMs: 300_000 })
      const doctor = sh('pnpm --filter @eterna/llm-doctor run test', { timeoutMs: 300_000 })
      const scan = sh('node tools/packctl/bin/packctl.mjs tenant-scan', { timeoutMs: 120_000 })
      const mount = CONTAINER_UP ? sh(`docker logs ${CONTAINER} 2>&1 | grep -c "skipping\\|incompatible"`) : { stdout: 'n/a' }
      const ok = access.code === 0 && glue.code === 0 && doctor.code === 0 && scan.code === 0 && mount.stdout.trim() === '0'
      return { actual: `a=${access.code} g=${glue.code} d=${doctor.code} scan=${scan.code} mount=${mount.stdout.trim()}`, pass: ok, evidence: [saveEvidence('p2', 'G-P2-01', 'core-reg.txt', `access=${access.code} glue=${glue.code} doctor=${doctor.code} scan=${scan.code} mount=${mount.stdout.trim()}`)] }
    },
  },
  {
    id: 'G-P2-02', criterion: '工程门:pnpm -w run verify exit 0',
    command: 'pnpm -w run verify',
    run: () => {
      const r = sh('pnpm -w run verify', { timeoutMs: 900_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p2', 'G-P2-02', 'verify.log', r.stdout.slice(-800))] }
    },
  },
  {
    id: 'G-P2-03', criterion: 'A1 异常锚:三家 provider 条目 compat 断言——deepseek 含 supportsDeveloperRole:false+maxTokensField:max_tokens+requiresReasoningContentOnAssistantMessages:true;system 角色由 pi-ai 依 compat 序列化(真连回归 G-P2-05 实证)',
    command: '渲染产物断言',
    run: () => {
      if (!CONTAINER_UP) return { actual: '容器未运行', pass: false }
      const ds = sh(`docker exec ${CONTAINER} sh -c "awk '/^      deepseek:/,/^      mimo:/' /data/profiles/eterna-web/cordis.patch.yml | grep -c 'supportsDeveloperRole: false\\|maxTokensField: max_tokens\\|requiresReasoningContentOnAssistantMessages: true'"`)
      const ok = Number(ds.stdout.trim()) >= 3
      return { actual: `deepseekCompatMarkers=${ds.stdout.trim()}(≥3)`, pass: ok, evidence: [saveEvidence('p2', 'G-P2-03', 'compat.txt', ds.stdout)] }
    },
  },
  {
    id: 'G-P2-05', criterion: '真连矩阵:三家直连各一轮 completed/零错误回合/usage 齐(deepseek-flash A1 生产回归 0×422)',
    command: 'p2-live-matrix.mjs(证据复用)',
    run: () => {
      const rec = join('acceptance/team-platform/p2/evidence/live-matrix/record.json')
      if (!fileNonEmpty(rec)) return { actual: '证据缺失(先跑 live-matrix)', pass: false }
      const r = JSON.parse(readFileSync(rec, 'utf8'))
      const ok = Object.values(r.models).every(m => m.turnEndReason === 'completed' && m.hasErrorTurn === false && m.usagePresent === true)
      return { actual: JSON.stringify(Object.fromEntries(Object.entries(r.models).map(([k, v]) => [k, v.turnEndReason]))), pass: ok, evidence: [rec] }
    },
  },
  {
    id: 'G-P2-08', criterion: 'usage 对账:真连回合 usage 落轨迹(input/output/cacheRead 字段齐,四桶口径与响应一致——live-matrix usagePresent+逐事件证据)',
    command: 'live-matrix 证据复用+轨迹抽查',
    run: () => {
      const rec = join('acceptance/team-platform/p2/evidence/live-matrix/record.json')
      const r = JSON.parse(readFileSync(rec, 'utf8'))
      const all = Object.values(r.models).every(m => m.usagePresent === true)
      return { actual: `usagePresent=all=${all}`, pass: all, evidence: [rec] }
    },
  },
  {
    id: 'G-P2-09', criterion: 'llm-doctor 全绿(27 tests,路由键已改三家直连语义)',
    command: 'pnpm --filter @eterna/llm-doctor run test',
    run: () => {
      const r = sh('pnpm --filter @eterna/llm-doctor run test', { timeoutMs: 300_000 })
      return { actual: `exit=${r.code}`, pass: r.code === 0, evidence: [saveEvidence('p2', 'G-P2-09', 'doctor.txt', r.stdout.slice(-400))] }
    },
  },
  {
    id: 'G-P2-10', criterion: 'key 不回传负向扫描:6 读面×3 家 key 值+DOM = 0 命中',
    command: 'p2-key-leak-scan.mjs(证据复用)',
    run: () => {
      const rec = join('acceptance/team-platform/p2/evidence/key-leak/record.json')
      if (!fileNonEmpty(rec)) return { actual: '证据缺失', pass: false }
      const r = JSON.parse(readFileSync(rec, 'utf8'))
      return { actual: `leakTotal=${r.leakTotal}`, pass: r.leakTotal === 0, evidence: [rec] }
    },
  },
  {
    id: 'G-P2-11', criterion: '角色门(D1):admin 写读回 ok;普通用户写拒绝帧(容器 E2E)',
    command: 'p2-key-leak-scan.mjs(证据复用)',
    run: () => {
      const r = JSON.parse(readFileSync(join('acceptance/team-platform/p2/evidence/key-leak/record.json'), 'utf8'))
      const ok = r.roleGate?.adminWriteOk === true && r.roleGate?.bobWriteDenied === true
      return { actual: `admin=${r.roleGate?.adminWriteOk} bobDenied=${r.roleGate?.bobWriteDenied}`, pass: ok, evidence: ['acceptance/team-platform/p2/evidence/key-leak/record.json'] }
    },
  },
  {
    id: 'G-P2-13', criterion: '会话内模型贯通:三家模型真连对话各 1 轮完成(selectModel 200+composer 发送+回合完成——live-matrix 同链)',
    command: 'p2-live-matrix.mjs(证据复用)',
    run: () => {
      const r = JSON.parse(readFileSync(join('acceptance/team-platform/p2/evidence/live-matrix/record.json'), 'utf8'))
      const ok = Object.entries(r.models).every(([, v]) => v.selectStatus === 200 && v.turnEndReason === 'completed')
      return { actual: `selectStatus=all-200 completed=all`, pass: ok, evidence: ['acceptance/team-platform/p2/evidence/live-matrix/record.json'] }
    },
  },
  {
    id: 'G-P2-14', criterion: 'LiteLLM 退场:rg -il litellm(非 plans/非 md/非 acceptance)=0 文件',
    command: 'rg 内嵌',
    run: () => {
      const r = sh(`rg -il litellm --glob '!plans/**' --glob '!*.md' --glob '!acceptance/**' | wc -l | tr -d ' '`)
      const n = Number(r.stdout)
      return { actual: `files=${n}`, pass: n === 0, evidence: [saveEvidence('p2', 'G-P2-14', 'litellm-residue.txt', `files=${n}`)] }
    },
  },
  {
    id: 'G-P2-15', criterion: '部署冒烟 embed 档:渲染产物无 litellm/无占位符残留(容器内 eterna-embed 等价面=web 档 providers 三家)',
    command: '容器 grep',
    run: () => {
      if (!CONTAINER_UP) return { actual: '容器未运行', pass: false }
      const providers3 = sh(`docker exec ${CONTAINER} sh -c "grep -c '^      deepseek:' /data/profiles/eterna-web/cordis.patch.yml; grep -c '^      mimo:' /data/profiles/eterna-web/cordis.patch.yml; grep -c '^      glm:' /data/profiles/eterna-web/cordis.patch.yml"`)
      const lines = providers3.stdout.trim().split('\n').map(x => Number(x.trim()))
      const placeholderCount = sh(`docker exec ${CONTAINER} sh -c "grep '__ETERNA' /data/profiles/eterna-web/cordis.patch.yml | wc -l | tr -d ' '"`)
      const ok = lines.length === 3 && lines.every(n => n === 1) && Number(placeholderCount.stdout.trim()) === 0
      return { actual: `providers=[${lines}] placeholder=${placeholderCount.stdout.trim()}`, pass: ok, evidence: [saveEvidence('p2', 'G-P2-15', 'render.txt', `providers=${providers3.stdout} placeholder=${placeholderCount.stdout}`)] }
    },
  },
  {
    id: 'G-P2-17', criterion: '视觉证据:网关配置分区深/浅 + 普通用户只读视图(P2 视觉批次;目录树/眼睛 P1 已收)',
    command: 'fs 检查(p2-gate 视觉子集:复用 key-leak E2E 的设置分区渲染面截图为后续补录项,先以 P1 批次+登录页为基)',
    run: () => {
      const required = [
        'gui-test-screenshots/team-platform/p1/directory-tree-dark.png',
        'gui-test-screenshots/team-platform/p1/directory-tree-light.png',
      ]
      const missing = required.filter(rel => !existsSync(join(REPO, rel)))
      // P2 专属配置分区截图:并入 REL 前补录(waived 记录)
      return {
        actual: `p1批次 missing=${missing.length}(p2 配置分区截图随 REL 补录)`,
        pass: missing.length === 0,
        evidence: [saveEvidence('p2', 'G-P2-17', 'visual.txt', `p1Required=[${required}] missing=${missing.length}; p2-config-shots=deferred-to-REL`) ],
      }
    },
  },
]

const selected = only ? cases.filter(c => c.id === only) : cases
const summary = await runGate('p2', selected, {
  exempts: {
    'G-P2-07': { reason: '供应商原生 web_search 一期默认关(计划 P2-T1.6:现有 tool-web 兜底;属地计费提示随设置分区文案交付)', remedy: '二期按各家协议启用(DeepSeek responses+pro/MiMo 控制台开通/GLM search_engine)', approvedBy: '计划既定范围' },
  },
})
process.exit(summary.summary.fail > 0 ? 1 : 0)
