#!/usr/bin/env node
// dsh2cc-jsonl.mjs — 把 @eterna/evals 的事件流(replay fixture 或 acp 真会话 runner 另存的
// events/<case>.jsonl,同为 DSH SessionEvent 每行一个)转换为 ai-evo 会话导入可解析的
// Claude Code .jsonl 格式(一个会话一个文件)。
// 用法: node tools/dsh2cc-jsonl.mjs <events-dir> <out-dir>
//
// 两种输入的实测形态差异(2026-11-04,docs/acp-real-6-r2 六条真会话 vs packs fixtures):
//   user/message:replay 载荷在 data.message.content;真会话直挂 data.content,且带
//     data.source.kind(user=真人输入;runtime-context/skill-catalog/time-context 为
//     宿主注入,不属会话对话面,导出会污染 user_input 抽取与裁判输入,跳过)。
//   assistant/message:真会话 content 混有 reasoning(CoT)与 tool-call 块 —— 工具调用
//     已由独立 tool/call 事件表达,tool-call 块保留会造成平台 tool_call_count 双计,
//     轨迹匹配随之失真;reasoning 是 DSH 内部形态,CC 格式无对应,一并滤除。
//   tool/result:真会话 message.isError 标记被拒/失败调用(如 "user rejected tool"),
//     映射 is_error 供裁判看见失败语义。
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
    // 宿主注入的 user/message(runtime-context 等)不属对话面,跳过;无 source 字段
    // 的 replay fixture 形态视为真人输入保留。
    const HARNESS_INJECTED_SOURCES = new Set(["runtime-context", "skill-catalog", "time-context"]);
    const userContent = ev.data?.message?.content ?? ev.data?.content;
    const userSourceKind = ev.data?.source?.kind;
    if (t === "user/message" && userContent && !(userSourceKind !== undefined && HARNESS_INJECTED_SOURCES.has(userSourceKind))) {
      rows.push({ type: "user", sessionId, timestamp: ts, message: { role: "user", content: userContent } });
    } else if (t === "assistant/message" && ev.data?.message) {
      const content = (ev.data.message.content ?? []).filter(
        (block) => block?.type === "text" || block?.type === "tool_use",
      );
      if (content.length > 0) rows.push({ type: "assistant", sessionId, timestamp: ts, message: { role: "assistant", content } });
    } else if (t === "tool/call" && ev.data) {
      let input = {};
      try { input = typeof ev.data.arguments === "string" ? JSON.parse(ev.data.arguments) : (ev.data.arguments ?? {}); } catch { input = { raw: ev.data.arguments }; }
      rows.push({ type: "assistant", sessionId, timestamp: ts, message: { role: "assistant", content: [{ type: "tool_use", id: ev.data.callId, name: ev.data.name, input }] } });
    } else if (t === "tool/result" && ev.data?.message) {
      rows.push({ type: "user", sessionId, timestamp: ts, message: { role: "user", content: [{ type: "tool_result", tool_use_id: ev.data.message.toolCallId, is_error: Boolean(ev.data.message.isError), content: ev.data.message.content ?? [] }] } });
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
