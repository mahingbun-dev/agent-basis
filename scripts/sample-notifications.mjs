#!/usr/bin/env node
// 采真实 SDK 通知样本(T17,设计文档 18 §6-2:SDK 通知→事件映射校准)。
//
// 用 DSH 官方 Python SDK(deepseek-harness-sdk)在评测宿主
// (DSH_HOME=~/.dsh-evals,profile=sdk,litellm 路由 deepseek-official→deepseek-flash)
// 起 2 条真会话:
//   1. sample-tools     —— 简单预算计算(budget_calc 工具路径);
//   2. sample-approval  —— 定金支付(pay_deposit 审批路径,SDK approval_requests=True,
//                          编程应答器一律 rejected → approval/asked + approval/decided)。
// on_notification 收到的每条原始通知按 {method, payload} 逐条 JSON 落盘(NDJSON),
// 作为 tools/evals 两侧(python EventMapper / ts coerceEvents)「真实样本回放」单测的 fixture。
//
// 用法:node scripts/sample-notifications.mjs [输出jsonl](缺省 docs/acp-real-6/notifications-sample.jsonl)
//
// 凭据纪律:LITELLM_API_KEY 运行时从 .secrets/litellm-master-key.txt 读入子进程环境,
// 不写入任何仓库文件;dsh CLI 一律 /opt/homebrew/bin/dsh(避开 pip 包装脚本)。
import { spawn } from 'node:child_process'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = path.resolve(process.argv[2] ?? path.join(repoRoot, 'docs/acp-real-6/notifications-sample.jsonl'))
const keyFile = path.join(repoRoot, '.secrets/litellm-master-key.txt')

let apiKey = ''
try {
  apiKey = readFileSync(keyFile, 'utf8').trim()
} catch (cause) {
  console.error(`读不到 litellm key(${keyFile}):${String(cause)}`)
  process.exit(2)
}
if (apiKey === '') {
  console.error('litellm key 为空,无法起真会话')
  process.exit(2)
}

mkdirSync(path.dirname(outFile), { recursive: true })
const workspaceDir = mkdtempSync(path.join(tmpdir(), 'acp-sample-ws-'))

const PROMPTS = [
  {
    session_id: 'sample-tools',
    input: '用 budget_calc 工具计算:100 人婚礼,人均餐饮 1500 元,场地费 50000 元,其他杂费 20000 元。给出行小计与总预算,简要回报后结束。',
  },
  {
    session_id: 'sample-approval',
    input: '用 pay_deposit 工具支付定金:供应商「花好月圆宴会厅」,金额 30000 元,付款单号 DEP-SAMPLE-01。若审批被拒,直接说明被拒结果,不要重试。',
  },
]

// 采样器本体:python 内联脚本。on_notification 收到的 Notification 是 dataclass
// (method/payload,dsh-repo python/sdk/src/deepseek_harness/client.py:473),
// 原样序列化为 {method, payload} 一行一条,不做任何加工(样本要「原始」)。
const SAMPLER = `
import json, os, threading

out_path = os.environ["SAMPLE_OUT"]
prompts = json.loads(os.environ["SAMPLE_PROMPTS"])

from deepseek_harness import DeepSeekHarness

fh = open(out_path, "w", encoding="utf-8")
lock = threading.Lock()
count = 0

def on_notification(notification):
    global count
    method = getattr(notification, "method", None)
    payload = getattr(notification, "payload", None)
    record = {"method": method, "payload": payload if isinstance(payload, dict) else None}
    line = json.dumps(record, ensure_ascii=False)
    with lock:
        fh.write(line + "\\n")
        fh.flush()
        count += 1

harness = DeepSeekHarness(
    dsh_home=os.environ["DSH_HOME"],
    dsh_bin=os.environ.get("DSH_BIN") or None,
    provider=os.environ.get("DSH_PROVIDER", "deepseek-official"),
    model=os.environ.get("DSH_MODEL", "deepseek-flash"),
    cwd=os.environ["SAMPLE_CWD"],
    approval_requests=True,
)

def respond_all():
    # 审批应答器:一律 rejected(fail-closed),让样本同时采到 asked/decided 两个事件。
    client = harness.client
    while True:
        try:
            request = client.next_request()
        except Exception:
            return
        try:
            if getattr(request, "method", "") == "approval/request":
                client.respond(request.id, {"outcome": "rejected"})
            else:
                client.respond_error(request.id, code=-32601, message="sampler: unsupported client request")
        except Exception:
            return

threading.Thread(target=respond_all, daemon=True).start()

for item in prompts:
    result = harness.start_session(item["session_id"]).run(item["input"], on_notification=on_notification)
    head = (result.final_response or "")[:200].replace("\\n", " ")
    print(json.dumps({"session_id": item["session_id"], "finish_reason": result.finish_reason, "final_response_head": head}, ensure_ascii=False), flush=True)

harness.close()
fh.close()
print(json.dumps({"notifications": count, "out": out_path}, ensure_ascii=False), flush=True)
`

const child = spawn('python3', ['-c', SAMPLER], {
  env: {
    ...process.env,
    DSH_HOME: process.env.DSH_EVALS_DSH_HOME ?? '/Users/sunny/.dsh-evals',
    DSH_BIN: '/opt/homebrew/bin/dsh',
    DSH_PROVIDER: 'deepseek-official',
    DSH_MODEL: 'deepseek-flash',
    LITELLM_API_KEY: apiKey,
    SAMPLE_OUT: outFile,
    SAMPLE_CWD: workspaceDir,
    SAMPLE_PROMPTS: JSON.stringify(PROMPTS),
  },
  stdio: ['ignore', 'inherit', 'inherit'],
})
child.on('close', (code) => {
  if (code !== 0) {
    console.error(`采样失败:python 退出码 ${code}`)
    process.exit(code ?? 1)
  }
  const lines = readFileSync(outFile, 'utf8').split('\n').filter(line => line.trim() !== '')
  console.log(`样本落盘:${outFile}(${lines.length} 条通知)`)
  if (lines.length < 10) {
    console.error('通知不足 10 条,样本不达标')
    process.exit(1)
  }
})
