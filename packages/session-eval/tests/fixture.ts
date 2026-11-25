/**
 * 验收样本会话(两个测试文件共用):2 轮 / 2 步 / 4 次调用 / 1 次审批拒绝 / 1 次异常结束。
 *
 * 刻意包含四类硬情形:
 * - 被拒调用仍记 tool/call(c2:参数非法 + 结果 isError + 审批 rejected);
 * - 不在工具面清单里的调用(c3:shell_exec;清单来自 request/header.header.tools);
 * - 同名同参重复调用(c4 重复 c1);
 * - 异常结束轮(turn 2 的 reason.kind = error)。
 */
import type { SessionEventLike } from '../src/types.ts'

export const FIXTURE_EVENTS: readonly SessionEventLike[] = [
  { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 1005, data: { turn: 1, step: 1 } },
  {
    type: 'request/header',
    seq: 3,
    time: 1010,
    data: { header: { config: { provider: 'deepseek', model: 'deepseek-chat' }, tools: [{ name: 'fs_read' }, { name: 'fs_grep' }] } },
  },
  {
    type: 'assistant/message',
    seq: 4,
    time: 1500,
    data: { turn: 1, step: 1, message: {}, stream: [], usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 3000 } },
  },
  { type: 'tool/call', seq: 5, time: 1600, data: { turn: 1, step: 1, callId: 'c1', name: 'fs_read', arguments: '{"path":"a"}' } },
  { type: 'tool/result', seq: 6, time: 1700, data: { turn: 1, step: 1, message: { toolCallId: 'c1', isError: false } } },
  { type: 'tool/call', seq: 7, time: 1800, data: { turn: 1, step: 1, callId: 'c2', name: 'fs_grep', arguments: 'not-json' } },
  {
    type: 'tool/result',
    seq: 8,
    time: 1900,
    data: { turn: 1, step: 1, message: { toolCallId: 'c2', isError: true }, error: { name: 'ToolError', code: 'BAD_ARGS' } },
  },
  { type: 'approval/asked', seq: 9, time: 2000, data: { id: 'ap1', callId: 'c2', toolName: 'fs_grep' } },
  { type: 'approval/decided', seq: 10, time: 2100, data: { id: 'ap1', outcome: 'rejected' } },
  { type: 'turn/end', seq: 11, time: 9000, data: { turn: 1, reason: { kind: 'completed' } } },
  { type: 'turn/start', seq: 12, time: 10000, data: { turn: 2 } },
  { type: 'step/start', seq: 13, time: 10010, data: { turn: 2, step: 1 } },
  { type: 'tool/call', seq: 14, time: 10100, data: { turn: 2, step: 1, callId: 'c3', name: 'shell_exec', arguments: '{"cmd":"ls"}' } },
  {
    type: 'tool/result',
    seq: 15,
    time: 10200,
    data: { turn: 2, step: 1, message: { toolCallId: 'c3', isError: true }, error: { code: 'UNKNOWN_TOOL' } },
  },
  { type: 'tool/call', seq: 16, time: 10300, data: { turn: 2, step: 1, callId: 'c4', name: 'fs_read', arguments: '{"path":"a"}' } },
  { type: 'tool/result', seq: 17, time: 10400, data: { turn: 2, step: 1, message: { toolCallId: 'c4', isError: false } } },
  { type: 'turn/end', seq: 18, time: 15000, data: { turn: 2, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } } },
]
