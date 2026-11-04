#!/usr/bin/env node
/**
 * aievo-run —— ai-evo 评测平台 CLI 封装(等价替代官方 aievo-cli,官方包在 NAS /data/ai-evo/repo/cli,本机不可直达)。
 * 零依赖(Node >= 18 原生 fetch / node:test),覆盖 CI 门禁所需三条命令:
 *
 *   node tools/aievo-run.mjs config add <url> <key>    # 凭据写入 .secrets/aievo-cli.json(目录整体 gitignored,0600)
 *   node tools/aievo-run.mjs run <task_id> [--wait] [--timeout <s>] [--poll-interval <s>] [--json]
 *   node tools/aievo-run.mjs results <task_id> [--json]
 *
 * run:POST /api/v1/evaluation/tasks/<id>/run 触发;--wait 轮询 status 至终态,取最新 execution 判门禁。
 * results:拉最新 execution 聚合 + 门禁判定(不触发新执行)。
 * 退出码(平台语义):0=门禁 passed;1=failed(质量不达标:阈值不满足);2=error(链路/未配门禁/执行失败/超时)。
 * 认证:Bearer <key>(平台按 token 形态识别;实测 evaluation 端点仅接受账号 JWT,API Key 即便带 tasks:read/tasks:run scope 也 403)。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const EXIT = { PASS: 0, FAIL: 1, ERROR: 2 };

const DEFAULT_TIMEOUT_S = 1800;
const DEFAULT_POLL_S = 5;
const TERMINAL_STATUS = new Set(['completed', 'failed', 'error', 'stopped']);
const OPS = {
  '>=': (a, b) => a >= b,
  '>': (a, b) => a > b,
  '<=': (a, b) => a <= b,
  '<': (a, b) => a < b,
  '==': (a, b) => a === b,
  '!=': (a, b) => a !== b,
};
// 阈值指标名 → result 聚合字段别名(平台 gate_config 用 pass_rate,result 顶层叫 success_rate)
const METRIC_ALIASES = { pass_rate: ['success_rate'] };

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
}

/** 规范化 API base:去尾斜杠;若未带 /api/v1 则补全(config add http://MaNas:8201 即可用)。 */
export function normalizeBaseUrl(raw) {
  const base = String(raw ?? '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) throw new ApiError(`url 必须以 http(s):// 开头:${raw}`);
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

export function configPath(root) {
  return path.join(root, '.secrets', 'aievo-cli.json');
}

export function loadConfig(root) {
  const p = configPath(root);
  if (!fs.existsSync(p)) return null;
  try {
    const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!cfg?.url || !cfg?.key) return null;
    return cfg;
  } catch {
    throw new ApiError(`配置文件损坏(非 JSON):${p}`);
  }
}

export function saveConfig(root, url, key) {
  const p = configPath(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify({ url: normalizeBaseUrl(url), key }, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(p, 0o600);
  return p;
}

async function api(cfg, pathname, io, { method = 'GET', body } = {}) {
  const url = `${cfg.url}${pathname}`;
  let res;
  try {
    res = await io.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${cfg.key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new ApiError(`网络请求失败 ${method} ${url}:${e.message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch?.(() => '') ?? '';
    throw new ApiError(`HTTP ${res.status} ${method} ${pathname}:${String(text).slice(0, 300)}`, res.status);
  }
  try {
    return await res.json();
  } catch (e) {
    throw new ApiError(`${method} ${pathname} 响应非 JSON:${e.message}`);
  }
}

const fetchTask = (cfg, taskId, io) => api(cfg, `/evaluation/tasks/${encodeURIComponent(taskId)}`, io);
const fetchStatus = (cfg, taskId, io) => api(cfg, `/evaluation/tasks/${encodeURIComponent(taskId)}/status`, io);
const fetchExecutions = (cfg, taskId, io) => api(cfg, `/evaluation/tasks/${encodeURIComponent(taskId)}/executions`, io);

/** 最新执行:取 execution_number 最大者(数组无序也稳);无执行记录返回 null。 */
export function pickLatestExecution(executions) {
  if (!Array.isArray(executions) || executions.length === 0) return null;
  return executions.reduce((best, cur) => ((cur?.execution_number ?? -1) > (best?.execution_number ?? -1) ? cur : best));
}

/** 阈值指标取值:result 顶层同名字段 → 别名(success_rate 等)→ 嵌套 trajectory.pass_rate。 */
function resolveMetric(result, metric) {
  const r = result ?? {};
  if (typeof r[metric] === 'number') return { value: r[metric], source: `result.${metric}` };
  for (const alias of METRIC_ALIASES[metric] ?? []) {
    if (typeof r[alias] === 'number') return { value: r[alias], source: `result.${alias}` };
  }
  if (metric.includes('.') && metric.startsWith('trajectory.')) {
    const v = r.trajectory?.[metric.slice('trajectory.'.length)];
    if (typeof v === 'number') return { value: v, source: `result.${metric}` };
  }
  return null;
}

/**
 * 门禁判定(纯函数)。返回:
 *   { decided: true, passed, mode, checks: [{metric, op, value, actual, source, ok}], summary }
 *   { decided: false, reason } —— 未配门禁 / 指标缺失 / 算子不支持(decided=false 一律 exit 2)
 */
export function judgeGate(task, result) {
  const gate = task?.gate_config;
  if (!gate || gate.enabled !== true) {
    return { decided: false, reason: '未配置门禁(gate_config.enabled != true)' };
  }
  const thresholds = Array.isArray(gate.thresholds) ? gate.thresholds : [];
  if (thresholds.length === 0) return { decided: false, reason: '门禁未配阈值(gate_config.thresholds 为空)' };
  const mode = gate.mode === 'any' ? 'any' : 'all';
  const checks = [];
  for (const th of thresholds) {
    const { metric, op, value } = th ?? {};
    if (!metric || !(op in OPS)) {
      return { decided: false, reason: `阈值配置不合法:${JSON.stringify(th)}` };
    }
    const resolved = resolveMetric(result, String(metric));
    if (!resolved) {
      return { decided: false, reason: `指标 ${metric} 不在执行结果聚合中,无法判定` };
    }
    checks.push({
      metric: String(metric),
      op,
      value,
      actual: resolved.value,
      source: resolved.source,
      ok: OPS[op](resolved.value, value),
    });
  }
  const passed = mode === 'any' ? checks.some((c) => c.ok) : checks.every((c) => c.ok);
  const summary = checks.map((c) => `${c.metric}(${c.source})=${c.actual} ${c.op} ${c.value} ${c.ok ? '✓' : '✗'}`).join(', ');
  return { decided: true, passed, mode, checks, summary: `${passed ? 'passed' : 'failed'}(mode=${mode}: ${summary})` };
}

/** 执行聚合行(人类可读报告与 --json 共用)。 */
function aggregateOf(result) {
  const r = result ?? {};
  return {
    total: r.total ?? null,
    success_count: r.success_count ?? null,
    failed_count: r.failed_count ?? null,
    pass_rate: typeof r.success_rate === 'number' ? r.success_rate : null,
    average_score: r.average_score ?? null,
    trajectory_match_rate: typeof r.trajectory_match_rate === 'number' ? r.trajectory_match_rate : null,
    trajectory_pass_rate: typeof r.trajectory?.pass_rate === 'number' ? r.trajectory.pass_rate : null,
  };
}

/**
 * 轮询至出现"晚于 baselineNumber 的新执行"且到终态。
 * status 端点是任务级聚合,触发后可能短暂残留旧终态,故以 execution_number 消歧;timeoutMs 总包。
 */
async function awaitNewExecution(cfg, taskId, io, { baselineNumber, timeoutMs, pollMs, jsonMode }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await fetchStatus(cfg, taskId, io);
    const progress = `completed ${st.completed_questions ?? '?'}/${st.total ?? st.total_questions ?? '?'}`;
    if (!jsonMode) io.out(`[poll] status=${st.status} ${progress}`);
    else io.err(`[poll] status=${st.status} ${progress}`);
    if (TERMINAL_STATUS.has(st.status)) {
      const exec = pickLatestExecution(await fetchExecutions(cfg, taskId, io));
      if (exec && (exec.execution_number ?? 0) > (baselineNumber ?? 0) && TERMINAL_STATUS.has(exec.status)) return exec;
      if (exec && (exec.execution_number ?? 0) > (baselineNumber ?? 0) && !TERMINAL_STATUS.has(exec.status)) {
        // status 聚合已终态但最新执行未终态:以执行为准继续等
      }
    }
    if (Date.now() >= deadline) {
      throw new ApiError(`等待超时(${Math.round(timeoutMs / 1000)}s):任务 status=${st.status},尚未出现 > ${baselineNumber ?? 0} 的终态执行`);
    }
    await io.sleep(pollMs);
  }
}

/** 终态执行 → 门禁判定 → { exitCode, verdict }。exec.status 非 completed 且无 result 可判 → exit 2。 */
function verdictOf(task, exec) {
  const status = exec?.status;
  const result = exec?.result ?? null;
  if (status === 'completed' || (result && (result.total ?? 0) > 0)) {
    const gate = judgeGate(task, result);
    if (!gate.decided) return { exitCode: EXIT.ERROR, gate, reason: gate.reason };
    return {
      exitCode: gate.passed ? EXIT.PASS : EXIT.FAIL,
      gate,
      reason: gate.summary,
    };
  }
  return { exitCode: EXIT.ERROR, gate: null, reason: `执行未完成(status=${status}),无结果可判` };
}

function printReport(io, { taskId, exec, gate, exitCode, reason, jsonMode }) {
  const aggregate = aggregateOf(exec?.result);
  const payload = {
    task_id: taskId,
    execution: exec ? { id: exec.id ?? null, execution_number: exec.execution_number ?? null, status: exec.status ?? null, completed_at: exec.result?.completed_at ?? null } : null,
    aggregate,
    gate: gate && gate.decided ? { decided: true, passed: gate.passed, mode: gate.mode, checks: gate.checks } : { decided: false, reason: gate?.reason ?? reason },
    exit_code: exitCode,
    reason,
  };
  if (jsonMode) {
    io.out(JSON.stringify(payload));
    return;
  }
  io.out(`task=${taskId} execution#${exec?.execution_number ?? '?'} status=${exec?.status ?? '?'}`);
  io.out(`aggregate: ${JSON.stringify(aggregate)}`);
  io.out(`gate: ${payload.gate.decided ? payload.gate.checks.map((c) => `${c.metric}=${c.actual} ${c.op} ${c.value} ${c.ok ? '✓' : '✗'}`).join(' | ') : payload.gate.reason}`);
  io.out(`verdict: exit=${exitCode} (${exitCode === EXIT.PASS ? '门禁 passed' : exitCode === EXIT.FAIL ? '门禁 failed(质量不达标)' : 'error(链路/未配门禁)'}) ${reason ?? ''}`.trimEnd());
}

function parseFlags(argv, spec) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a in spec) {
      if (spec[a]) flags[a] = argv[++i];
      else flags[a] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

export async function cmdConfig(argv, io) {
  const [sub, url, key] = argv;
  if (sub !== 'add' && sub !== 'show') {
    io.err('用法: config add <url> <key> | config show');
    return EXIT.ERROR;
  }
  if (sub === 'show') {
    const cfg = loadConfig(io.root);
    if (!cfg) {
      io.err(`未配置(先: config add <url> <key>),配置路径 ${configPath(io.root)}`);
      return EXIT.ERROR;
    }
    const masked = cfg.key.length > 12 ? `${cfg.key.slice(0, 8)}…${cfg.key.slice(-4)}` : '***';
    io.out(`url=${cfg.url}\nkey=${masked}(${cfg.key.length} chars)\nfile=${configPath(io.root)}`);
    return EXIT.PASS;
  }
  if (!url || !key) {
    io.err('用法: config add <url> <key>');
    return EXIT.ERROR;
  }
  try {
    const p = saveConfig(io.root, url, key);
    io.out(`已写入 ${p}(0600;目录 .secrets/ 已被 gitignore):${normalizeBaseUrl(url)}`);
    return EXIT.PASS;
  } catch (e) {
    io.err(`config add 失败:${e.message}`);
    return EXIT.ERROR;
  }
}

export async function cmdRun(argv, io) {
  const { flags, rest } = parseFlags(argv, { '--wait': false, '--json': false, '--timeout': true, '--poll-interval': true });
  const taskId = rest[0];
  if (!taskId) {
    io.err('用法: run <task_id> [--wait] [--timeout <s>] [--poll-interval <s>] [--json]');
    return EXIT.ERROR;
  }
  const cfg = loadConfig(io.root);
  if (!cfg) {
    io.err(`未配置凭据(先: config add <url> <key>),配置路径 ${configPath(io.root)}`);
    return EXIT.ERROR;
  }
  let task;
  try {
    task = await fetchTask(cfg, taskId, io);
    const before = pickLatestExecution(await fetchExecutions(cfg, taskId, io));
    const baselineNumber = before?.execution_number ?? 0;
    io.err(`触发执行: POST /evaluation/tasks/${taskId}/run(基线 execution_number=${baselineNumber})`);
    const startResp = await api(cfg, `/evaluation/tasks/${taskId}/run`, io, { method: 'POST', body: {} });
    io.err(`触发响应: ${JSON.stringify(startResp).slice(0, 300)}`);
    if (!flags['--wait']) {
      io.out(`已触发(未 --wait,不等待结果;用 results ${taskId} 查看最新执行):${JSON.stringify(startResp).slice(0, 300)}`);
      return EXIT.PASS;
    }
    const timeoutMs = Math.max(1, Number(flags['--timeout'] ?? DEFAULT_TIMEOUT_S)) * 1000;
    const pollMs = Math.max(0, Number(flags['--poll-interval'] ?? DEFAULT_POLL_S) * 1000);
    const exec = await awaitNewExecution(cfg, taskId, io, {
      baselineNumber,
      timeoutMs,
      pollMs,
      jsonMode: Boolean(flags['--json']),
    });
    const freshTask = await fetchTask(cfg, taskId, io); // 门禁配置以触发时任务定义为准,终态后再拉一次
    const verdict = verdictOf(freshTask ?? task, exec);
    printReport(io, { taskId, exec, gate: verdict.gate, exitCode: verdict.exitCode, reason: verdict.reason, jsonMode: Boolean(flags['--json']) });
    return verdict.exitCode;
  } catch (e) {
    io.err(`run 失败:${e.message}`);
    return EXIT.ERROR;
  }
}

export async function cmdResults(argv, io) {
  const { flags, rest } = parseFlags(argv, { '--json': false });
  const taskId = rest[0];
  if (!taskId) {
    io.err('用法: results <task_id> [--json]');
    return EXIT.ERROR;
  }
  const cfg = loadConfig(io.root);
  if (!cfg) {
    io.err(`未配置凭据(先: config add <url> <key>),配置路径 ${configPath(io.root)}`);
    return EXIT.ERROR;
  }
  try {
    const task = await fetchTask(cfg, taskId, io);
    const exec = pickLatestExecution(await fetchExecutions(cfg, taskId, io));
    if (!exec) {
      io.err(`task=${taskId} 尚无执行记录(先 run ${taskId} --wait)`);
      return EXIT.ERROR;
    }
    const verdict = verdictOf(task, exec);
    printReport(io, { taskId, exec, gate: verdict.gate, exitCode: verdict.exitCode, reason: verdict.reason, jsonMode: Boolean(flags['--json']) });
    return verdict.exitCode;
  } catch (e) {
    io.err(`results 失败:${e.message}`);
    return EXIT.ERROR;
  }
}

const HELP = `aievo-run —— ai-evo 评测平台 CLI 封装(官方 aievo-cli 的零依赖等价最小集)

用法:
  node tools/aievo-run.mjs config add <url> <key>    凭据写入 .secrets/aievo-cli.json(gitignored,0600);url 为平台根地址(自动补 /api/v1)
  node tools/aievo-run.mjs config show               查看已配凭据(key 打码)
  node tools/aievo-run.mjs run <task_id> [--wait] [--timeout <s>] [--poll-interval <s>] [--json]
      触发 POST /evaluation/tasks/<id>/run;--wait 轮询 status 至终态并判门禁(默认 timeout=1800s,poll=5s)
  node tools/aievo-run.mjs results <task_id> [--json]
      拉最新执行聚合 + 门禁判定,不触发新执行

退出码(平台语义,CI 用):
  0  门禁 passed
  1  门禁 failed(质量不达标:阈值不满足)
  2  error(链路失败/未配门禁/执行未完成/等待超时)

门禁判定:gate_config{enabled,mode=all|any,thresholds[{metric,op,value}]},指标从执行 result 聚合取值
  (pass_rate→result.success_rate,trajectory_match_rate→result.trajectory_match_rate;别名解析带 source 标注)。`;

export async function main(argv, io = {}) {
  const resolved = {
    root: io.root ?? repoRoot(),
    fetch: io.fetch ?? globalThis.fetch.bind(globalThis),
    sleep: io.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
    out: io.out ?? ((s) => process.stdout.write(`${s}\n`)),
    err: io.err ?? ((s) => process.stderr.write(`${s}\n`)),
  };
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    resolved.out(HELP);
    return cmd ? EXIT.PASS : EXIT.ERROR;
  }
  if (cmd === 'config') return cmdConfig(rest, resolved);
  if (cmd === 'run') return cmdRun(rest, resolved);
  if (cmd === 'results') return cmdResults(rest, resolved);
  resolved.err(`未知子命令:${cmd}(可用:config | run | results,--help 查看用法)`);
  return EXIT.ERROR;
}

// 入口判断两侧 realpath:经符号链接调用(如工作区根 tools -> agent-basis/tools)时,
// ESM 会把 import.meta.url 解析为物理路径而 process.argv[1] 仍是符号路径,严格字符串比较会静默跳过 main()。
const isMain = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return import.meta.url === pathToFileURL(argv1).href;
  }
})();
if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
