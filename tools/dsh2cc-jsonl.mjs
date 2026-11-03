#!/usr/bin/env node
// dsh2cc-jsonl.mjs — 把 @basis/evals 的 replay fixture(DSH SessionEvent 流)转换为
// ai-evo 会话导入可解析的 Claude Code .jsonl 格式(一个会话一个文件)。
// 用法: node tools/dsh2cc-jsonl.mjs <fixtures-dir> <out-dir>
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error("usage: node tools/dsh2cc-jsonl.mjs <fixtures-dir> <out-dir>");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

const iso = (ms) => new Date(ms).toISOString();

for (const f of readdirSync(srcDir).filter((n) => n.endsWith(".jsonl"))) {
  const sessionId = basename(f, ".jsonl");
  const rows = [];
  for (const line of readFileSync(join(srcDir, f), "utf8").split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    const t = ev.type;
    const ts = iso(ev.time ?? Date.now());
    if (t === "user/message" && ev.data?.message) {
      rows.push({ type: "user", sessionId, timestamp: ts, message: { role: "user", content: ev.data.message.content ?? [] } });
    } else if (t === "assistant/message" && ev.data?.message) {
      rows.push({ type: "assistant", sessionId, timestamp: ts, message: { role: "assistant", content: ev.data.message.content ?? [] } });
    } else if (t === "tool/call" && ev.data) {
      let input = {};
      try { input = typeof ev.data.arguments === "string" ? JSON.parse(ev.data.arguments) : (ev.data.arguments ?? {}); } catch { input = { raw: ev.data.arguments }; }
      rows.push({ type: "assistant", sessionId, timestamp: ts, message: { role: "assistant", content: [{ type: "tool_use", id: ev.data.callId, name: ev.data.name, input }] } });
    } else if (t === "tool/result" && ev.data?.message) {
      rows.push({ type: "user", sessionId, timestamp: ts, message: { role: "user", content: [{ type: "tool_result", tool_use_id: ev.data.message.toolCallId, is_error: false, content: ev.data.message.content ?? [] }] } });
    } else if (t === "approval/asked" && ev.data) {
      rows.push({ type: "system", sessionId, timestamp: ts, subtype: "approval_asked", data: { toolName: ev.data.toolName, callId: ev.data.callId, reason: ev.data.reason } });
    } else if (t === "approval/decided" && ev.data) {
      rows.push({ type: "system", sessionId, timestamp: ts, subtype: "approval_decided", data: { outcome: ev.data.outcome } });
    }
    // 其余事件(turn/*, step/*, workspace 等)对裁判与轨迹断言无信息量,不导出
  }
  writeFileSync(join(outDir, `${sessionId}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${sessionId}: ${rows.length} rows`);
}
console.log("done →", outDir);
