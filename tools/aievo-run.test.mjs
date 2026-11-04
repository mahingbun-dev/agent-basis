#!/usr/bin/env node
/**
 * aievo-run 单测(node --test,零依赖,mock fetch 不触网)。
 * 运行: node --test tools/aievo-run.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, judgeGate, normalizeBaseUrl, EXIT } from './aievo-run.mjs';

const BASE = 'http://mock:8201/api/v1';
const TASK_ID = 'task_x';
const GATE = { mode: 'all', enabled: true, thresholds: [
  { metric: 'pass_rate', op: '>=', value: 0.85 },
  { metric: 'trajectory_match_rate', op: '>=', value: 0.8 },
] };

/** 轻量 res mock:代码只依赖 ok/status/json()/text()。 */
function res(status, body) {
  return {
    ok: status < 400,
    status,
    json: async () => {
      if (status >= 400) throw new Error('no json');
      return body;
    },
    text: async () => JSON.stringify(body ?? {}),
  };
}

const ok = (body, status = 200) => ({ status, body });

/** 路由表:match(method, url) 命中 → reply() 返回显式包装 {status, body}。 */
function router(routes) {
  return async (url, init) => {
    const method = init?.method ?? 'GET';
    for (const r of routes) {
      if (r.match(method, url)) {
        const reply = r.reply(method, url);
        return res(reply.status ?? 200, reply.body);
      }
    }
    throw new Error(`unexpected fetch ${method} ${url}`);
  };
}

function mockIO({ fetch, root }) {
  const outLines = [];
  const errLines = [];
  return { root, fetch, sleep: async () => {}, out: (s) => outLines.push(s), err: (s) => errLines.push(s), outLines, errLines };
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aievo-run-test-'));
}

/** 预置已配置凭据的临时 root(测试不触真平台)。 */
function configedRoot() {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, '.secrets'), { recursive: true });
  fs.writeFileSync(path.join(root, '.secrets', 'aievo-cli.json'), JSON.stringify({ url: BASE, key: 'k' }));
  return root;
}

const okResult = (successRate) => ({
  total: 12,
  success_count: Math.round(12 * successRate),
  failed_count: 12 - Math.round(12 * successRate),
  success_rate: successRate,
  trajectory_match_rate: 1,
  trajectory: { total: 12, passed: 12, failed: 0, pass_rate: 1 },
});
const gateTask = (gate) => ({ id: TASK_ID, gate_config: gate, name: 'mock-task' });

// ---------- normalizeBaseUrl ----------
test('normalizeBaseUrl:补 /api/v1、去尾斜杠、已带不重复补、非法报错', () => {
  assert.equal(normalizeBaseUrl('http://MaNas:8201'), 'http://MaNas:8201/api/v1');
  assert.equal(normalizeBaseUrl('http://MaNas:8201/'), 'http://MaNas:8201/api/v1');
  assert.equal(normalizeBaseUrl('http://MaNas:8201/api/v1/'), 'http://MaNas:8201/api/v1');
  assert.throws(() => normalizeBaseUrl('ftp://x'), /http/);
});

// ---------- judgeGate(纯函数)----------
test('judgeGate:pass_rate 走 success_rate 别名,mode=all 全过 → passed', () => {
  const v = judgeGate(gateTask(GATE), okResult(1));
  assert.equal(v.decided, true);
  assert.equal(v.passed, true);
  assert.equal(v.checks[0].source, 'result.success_rate');
});

test('judgeGate:阈值不满足 → failed;mode=any 一票通过', () => {
  const v = judgeGate(gateTask(GATE), okResult(0.5));
  assert.equal(v.decided, true);
  assert.equal(v.passed, false);
  const any = judgeGate(gateTask({ mode: 'any', enabled: true, thresholds: GATE.thresholds }), okResult(0.5));
  assert.equal(any.passed, true); // trajectory_match_rate=1 满足 → any 放行
});

test('judgeGate:未启用/无阈值/指标缺失 → decided=false(CI 侧 exit 2)', () => {
  assert.equal(judgeGate(gateTask({ enabled: false, thresholds: GATE.thresholds }), okResult(1)).decided, false);
  assert.equal(judgeGate(gateTask({ enabled: true, thresholds: [] }), okResult(1)).decided, false);
  const miss = judgeGate(gateTask({ enabled: true, thresholds: [{ metric: 'nope', op: '>=', value: 1 }] }), okResult(1));
  assert.equal(miss.decided, false);
  assert.match(miss.reason, /nope/);
});

// ---------- config ----------
test('config add 写 .secrets/aievo-cli.json(0600,url 规范化),config show 打码不泄 key', async () => {
  const root = tmpRoot();
  const io = mockIO({ fetch: async () => { throw new Error('不应触网'); }, root });
  const key = 'jwt_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  assert.equal(await main(['config', 'add', 'http://MaNas:8201', key], io), EXIT.PASS);
  const stored = JSON.parse(fs.readFileSync(path.join(root, '.secrets', 'aievo-cli.json'), 'utf8'));
  assert.equal(stored.url, 'http://MaNas:8201/api/v1');
  assert.equal(stored.key, key);
  assert.equal(fs.statSync(path.join(root, '.secrets', 'aievo-cli.json')).mode & 0o777, 0o600);
  assert.equal(await main(['config', 'show'], io), EXIT.PASS);
  assert.ok(!io.outLines.join('\n').includes(key), '完整 key 不得出现在输出');
  assert.match(io.outLines.join('\n'), /url=http:\/\/MaNas:8201\/api\/v1/);
});

// ---------- run --wait ----------
function runRoutes({ execResult, execStatus = 'completed', taskGate = GATE } = {}) {
  let execCalls = 0;
  const oldExec = { id: 'exec_1', execution_number: 1, status: 'completed', result: okResult(1) };
  const newExec = {
    id: 'exec_2',
    execution_number: 2,
    status: execStatus,
    ...(execStatus === 'completed' ? { result: execResult } : {}),
  };
  return router([
    { match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}`), reply: () => ok(gateTask(taskGate)) },
    {
      match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}/executions`),
      reply: () => {
        execCalls += 1;
        return ok(execCalls === 1 ? [oldExec] : [oldExec, newExec]);
      },
    },
    { match: (m, u) => m === 'POST' && u.endsWith(`/evaluation/tasks/${TASK_ID}/run`), reply: () => ok({ execution_number: 2, status: 'started' }) },
    {
      match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}/status`),
      reply: () => ok({ status: 'completed', progress: 100, completed_questions: 12, total: 12 }),
    },
  ]);
}

test('run --wait 门禁通过 → exit 0,--json 输出含 gate.passed=true', async () => {
  const io = mockIO({ fetch: runRoutes({ execResult: okResult(1) }), root: configedRoot() });
  const code = await main(['run', TASK_ID, '--wait', '--timeout', '5', '--json'], io);
  assert.equal(code, EXIT.PASS);
  const payload = JSON.parse(io.outLines.at(-1));
  assert.equal(payload.gate.passed, true);
  assert.equal(payload.execution.execution_number, 2);
  assert.equal(payload.aggregate.pass_rate, 1);
});

test('run --wait 质量不达标(success_rate 0.5)→ exit 1', async () => {
  const io = mockIO({ fetch: runRoutes({ execResult: okResult(0.5) }), root: configedRoot() });
  assert.equal(await main(['run', TASK_ID, '--wait', '--timeout', '5'], io), EXIT.FAIL);
  assert.match(io.outLines.join('\n'), /failed/);
});

test('run --wait 执行 error 终态(无 result)→ exit 2', async () => {
  const io = mockIO({ fetch: runRoutes({ execStatus: 'error' }), root: configedRoot() });
  assert.equal(await main(['run', TASK_ID, '--wait', '--timeout', '5'], io), EXIT.ERROR);
  assert.match(`${io.errLines.join('\n')}${io.outLines.join('\n')}`, /执行未完成/);
});

test('run --wait 等待超时(status 恒 running)→ exit 2 并报超时', async () => {
  const routes = [
    { match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}`), reply: () => ok(gateTask(GATE)) },
    { match: (m, u) => m === 'GET' && u.endsWith('/executions'), reply: () => ok([]) },
    { match: (m, u) => m === 'POST' && u.endsWith('/run'), reply: () => ok({}) },
    { match: (m, u) => m === 'GET' && u.endsWith('/status'), reply: () => ok({ status: 'running', progress: 10 }) },
  ];
  const io = mockIO({ fetch: router(routes), root: configedRoot() });
  const code = await main(['run', TASK_ID, '--wait', '--timeout', '0.05'], io);
  assert.equal(code, EXIT.ERROR);
  assert.match(io.errLines.join('\n'), /超时/);
});

test('run --wait 链路 401 → exit 2,stderr 含 HTTP 401', async () => {
  const io = mockIO({ fetch: async () => res(401, { code: 401, message: '未提供认证信息' }), root: configedRoot() });
  assert.equal(await main(['run', TASK_ID, '--wait'], io), EXIT.ERROR);
  assert.match(io.errLines.join('\n'), /HTTP 401/);
});

test('run 未配置凭据 → exit 2,不触网', async () => {
  const io = mockIO({ fetch: async () => { throw new Error('不应触网'); }, root: tmpRoot() });
  assert.equal(await main(['run', TASK_ID, '--wait'], io), EXIT.ERROR);
  assert.match(io.errLines.join('\n'), /未配置凭据/);
});

// ---------- results ----------
test('results 取 execution_number 最大执行判门禁 → exit 0', async () => {
  const routes = [
    { match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}`), reply: () => ok(gateTask(GATE)) },
    {
      match: (m, u) => m === 'GET' && u.endsWith('/executions'),
      reply: () => ok([
        { id: 'exec_1', execution_number: 1, status: 'completed', result: okResult(0.5) },
        { id: 'exec_9', execution_number: 9, status: 'completed', result: okResult(1) },
      ]),
    },
  ];
  const io = mockIO({ fetch: router(routes), root: configedRoot() });
  const code = await main(['results', TASK_ID, '--json'], io);
  assert.equal(code, EXIT.PASS);
  const payload = JSON.parse(io.outLines.at(-1));
  assert.equal(payload.execution.execution_number, 9);
  assert.equal(payload.gate.passed, true);
});

test('results 门禁未配置 → exit 2(gate.decided=false)', async () => {
  const routes = [
    { match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}`), reply: () => ok(gateTask({ enabled: false, thresholds: GATE.thresholds })) },
    { match: (m, u) => m === 'GET' && u.endsWith('/executions'), reply: () => ok([{ id: 'exec_1', execution_number: 1, status: 'completed', result: okResult(1) }]) },
  ];
  const io = mockIO({ fetch: router(routes), root: configedRoot() });
  assert.equal(await main(['results', TASK_ID], io), EXIT.ERROR);
  assert.match(io.outLines.join('\n'), /未配置门禁/);
});

test('results 尚无执行记录 → exit 2', async () => {
  const routes = [
    { match: (m, u) => m === 'GET' && u.endsWith(`/evaluation/tasks/${TASK_ID}`), reply: () => ok(gateTask(GATE)) },
    { match: (m, u) => m === 'GET' && u.endsWith('/executions'), reply: () => ok([]) },
  ];
  const io = mockIO({ fetch: router(routes), root: configedRoot() });
  assert.equal(await main(['results', TASK_ID], io), EXIT.ERROR);
  assert.match(io.errLines.join('\n'), /尚无执行记录/);
});

// ---------- CLI 边界 ----------
test('--help → exit 0 打印用法;未知子命令 → exit 2', async () => {
  const io = mockIO({ fetch: async () => { throw new Error('不应触网'); }, root: tmpRoot() });
  assert.equal(await main(['--help'], io), EXIT.PASS);
  assert.match(io.outLines.join('\n'), /config add/);
  assert.equal(await main(['frobnicate'], io), EXIT.ERROR);
  assert.match(io.errLines.join('\n'), /未知子命令/);
});
