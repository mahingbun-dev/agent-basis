/**
 * route-golden-pack.mjs 单测(G2-A9;53 号 §4-P1):
 * 生成 pack 的产物形态(20 evals + 20 fixtures)、生成的 YAML 直接过 dsh-evals
 * 真实 schema(parseGoldenCase,tools/evals/src/schema.ts,ts 依赖其包内 yaml)、
 * fixture 逐行合法(DSH SessionEvent 形态)且末条 assistant/message 的记录裁决
 * 与 answer.contains(route=<kind>)自洽、判例语义(routeMeta 种子/byGate/名单扩展)、
 * id 全小写映射与幂等重建。数据源 = tests/route-golden/entries.ts 真源——判例
 * 增补后本测试与生成产物同步,不维护第二事实源。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generatePack } from './route-golden-pack.mjs'
import { ROUTING_GOLDEN } from '../packages/tasks/tests/route-golden/entries.ts'
import { parseGoldenCase } from '../tools/evals/src/schema.ts'

function tmpDir() {
  return mkdtempSync(join(tmpdir(), 'route-golden-pack-test-'))
}

test('generatePack:20 evals + 20 fixtures 文件齐全,id 全小写且与判例一一对应', async () => {
  const dir = tmpDir()
  try {
    const { outDir, count } = await generatePack(dir)
    assert.equal(count, ROUTING_GOLDEN.length)
    assert.equal(outDir, dir)
    const evals = readdirSync(join(dir, 'evals')).sort()
    const fixtures = readdirSync(join(dir, 'fixtures')).sort()
    assert.equal(evals.length, ROUTING_GOLDEN.length)
    assert.equal(fixtures.length, ROUTING_GOLDEN.length)
    const expectedIds = ROUTING_GOLDEN.map(entry => `${entry.id.toLowerCase()}.yaml`).sort()
    assert.deepEqual(evals, expectedIds)
    assert.deepEqual(fixtures, expectedIds.map(name => name.replace(/\.yaml$/, '.jsonl')))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('生成的 YAML 全部过 dsh-evals 真实 schema;user_input/tags/answer 与判例一致', async () => {
  const dir = tmpDir()
  try {
    await generatePack(dir)
    for (const entry of ROUTING_GOLDEN) {
      const id = entry.id.toLowerCase()
      const sourceFile = join(dir, 'evals', `${id}.yaml`)
      const caseData = parseGoldenCase(readFileSync(sourceFile, 'utf8'), sourceFile)
      assert.equal(caseData.id, id, `${entry.id} → ${id}(CASE_ID_RE 全小写)`)
      assert.equal(caseData.user_input, entry.trigger.text, `${entry.id}: 触发原文逐字进 user_input`)
      assert.deepEqual(caseData.tags, ['route-golden', entry.kind])
      assert.equal(caseData.answer?.contains, `route=${entry.replay.kind}`)
      assert.equal(caseData.description.includes(entry.kind), true, `${entry.id}: description 登记 kind`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('fixture 逐行合法 SessionEvent;末条 assistant/message 记录裁决含 answer 断言面', async () => {
  const dir = tmpDir()
  try {
    await generatePack(dir)
    for (const entry of ROUTING_GOLDEN) {
      const id = entry.id.toLowerCase()
      const lines = readFileSync(join(dir, 'fixtures', `${id}.jsonl`), 'utf8').trim().split('\n')
      const events = lines.map((line, index) => {
        const parsed = JSON.parse(line) // 任一行非合法 JSON 即在此失败
        assert.equal(typeof parsed.type, 'string', `${id}:${index + 1}: 有 type`)
        assert.equal(typeof parsed.seq, 'number', `${id}:${index + 1}: 有 seq`)
        assert.equal(typeof parsed.time, 'number', `${id}:${index + 1}: 有 time`)
        return parsed
      })
      const last = events.at(-1)
      assert.equal(last.type, 'assistant/message', `${id}: 末条为记录裁决`)
      const text = last.data.message.content.find(block => block.type === 'text').text
      assert.ok(text.startsWith(`route=${entry.replay.kind}`), `${id}: 记录裁决以 route=<kind> 开头`)
      const user = events.filter(event => event.type === 'user/message').at(-1)
      assert.equal(user.data.message.content[0].text, entry.trigger.text, `${id}: 触发原文逐字进会话事件`)
      // 触发原文 = 压缩强制保留项:记录面与断言面两侧都逐字可追溯。
      assert.equal(events.some(event => event.type === 'turn/start'), true, `${id}: 有 turn/start`)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('判例语义进 routeMeta:种子(ready)/名单外 bot 的 byGate/名单扩展/bot 消息', async () => {
  const dir = tmpDir()
  try {
    await generatePack(dir)
    const metaOf = id => {
      const lines = readFileSync(join(dir, 'fixtures', `${id.toLowerCase()}.jsonl`), 'utf8').trim().split('\n')
      return lines.map(line => JSON.parse(line))
        .filter(event => event.type === 'user/message')
        .map(event => event.data.routeMeta)
    }
    // RG-16(名单外 bot,byGate=true)。
    const rg16 = metaOf('RG-16').at(-1)
    assert.equal(rg16.byGate, true)
    assert.equal(rg16.human, false)
    assert.equal(rg16.bot, 'spam-bot')
    // RG-10(种子工单已结束)。
    const rg10 = metaOf('RG-10')
    assert.deepEqual(rg10[0], { role: 'seed', seedId: 's10', ready: true })
    assert.equal(rg10.at(-1).role, 'case')
    // RG-03(名单扩展 allowed=[u-bob])与 RG-12(bots 登记)。
    assert.deepEqual(metaOf('RG-03').at(-1).allowed, ['u-bob'])
    assert.deepEqual(metaOf('RG-12').at(-1).registerBots, ['ci-bot'])
    assert.equal(metaOf('RG-12').at(-1).human, false)
    // RG-01(无 setup):无种子事件。
    assert.equal(metaOf('RG-01').length, 1)
    assert.equal(metaOf('RG-01').at(-1).role, 'case')
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('幂等:重复生成不残留旧文件(整目录重建)', async () => {
  const dir = tmpDir()
  try {
    await generatePack(dir)
    writeFileSync(join(dir, 'evals', 'rg-stale.yaml'), 'id: rg-stale\nuser_input: "x"\ntags: []\n', 'utf8')
    await generatePack(dir)
    const evals = readdirSync(join(dir, 'evals')).sort()
    assert.equal(evals.includes('rg-stale.yaml'), false, '旧产物被清空')
    assert.equal(evals.length, ROUTING_GOLDEN.length)
    assert.equal(statSync(join(dir, 'evals', 'rg-01.yaml')).isFile(), true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
