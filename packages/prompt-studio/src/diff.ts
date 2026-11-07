/**
 * 行级 diff(保存校验「diff 非空」与审批卡 diffSummary 共用)。
 *
 * 算法:先去公共前后缀(绝大多数编辑只动中段),再对剩余中段做经典 LCS DP
 * (滚动 Int32Array 行,内存 O(min(m,n)))。persona ≤64KB,行数量级千级,
 * 全重写的病态情形也在毫秒级。
 */
export interface LineDiff {
  readonly added: number
  readonly removed: number
  /** 两文本按行完全一致( diff 为空,不可保存)。 */
  readonly isEmpty: boolean
}

/** 行切分:统一 \r\n 与 \r 为 \n 后按 \n 切,保留空行(空行也是内容)。 */
export function splitLines(text: string): readonly string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/** 行级 diff 统计。 */
export function diffLines(before: string, after: string): LineDiff {
  if (before === after) return { added: 0, removed: 0, isEmpty: true }
  const a = splitLines(before)
  const b = splitLines(after)
  const finish = (added: number, removed: number): LineDiff =>
    ({ added, removed, isEmpty: added === 0 && removed === 0 })
  // 去公共前缀
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  // 去公共后缀(不越过前缀)
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length === 0) return finish(midB.length, 0)
  if (midB.length === 0) return finish(0, midA.length)
  // LCS DP(滚动行;midA 作行、midB 作列)
  const rows = midA.length
  const cols = midB.length
  let previous = new Int32Array(cols + 1)
  let current = new Int32Array(cols + 1)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const diagonal = previous[j + 1] ?? 0
      const down = previous[j] ?? 0
      const right = current[j + 1] ?? 0
      current[j] = midA[i] === midB[j] ? diagonal + 1 : Math.max(down, right)
    }
    const swap = previous
    previous = current
    current = swap
  }
  const lcs = previous[0] ?? 0
  return finish(cols - lcs, rows - lcs)
}

/** 人话 diff 摘要(审批卡 impact.files[].diffSummary 用)。 */
export function diffSummaryText(diff: LineDiff): string {
  if (diff.isEmpty) return '无差异'
  return `+${diff.added}/-${diff.removed} 行`
}

// ---------- 行级 diff 的逐行投影(T7.3 ②:前端版本对比视图) ----------

/** 单行 diff 操作(渲染序:按原文本行序交错)。 */
export interface LineDiffOp {
  readonly type: 'same' | 'add' | 'del'
  readonly text: string
}

/**
 * 行级 diff 的逐行投影(LCS 全表回溯)。与 diffLines 共用切分/前后缀修剪,但需要
 * 完整 DP 表回溯,内存 O(rows×cols)——为防病态全重写(64KB≈2k 行→16MB),超过
 * MAX_OPS_CELLS 即降级为「中段整块删+整块增」(计数不变,只是不再逐行对齐)。
 */
export const MAX_OPS_CELLS = 1_000_000

/** 逐行 diff(渲染序 ops;统计口径与 diffLines 一致)。 */
export function lineDiffOps(before: string, after: string): readonly LineDiffOp[] {
  if (before === after) return splitLines(before).map(text => ({ type: 'same' as const, text }))
  const a = splitLines(before)
  const b = splitLines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }
  const ops: LineDiffOp[] = []
  for (let i = 0; i < start; i += 1) ops.push({ type: 'same', text: a[i] as string })
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  if (midA.length * midB.length > MAX_OPS_CELLS) {
    // 降级:不逐行对齐,整块 del+add(视觉上等价于全重写中段)。
    for (const text of midA) ops.push({ type: 'del', text })
    for (const text of midB) ops.push({ type: 'add', text })
  } else {
    backtrackOps(midA, midB, ops)
  }
  for (let i = endA; i < a.length; i += 1) ops.push({ type: 'same', text: a[i] as string })
  return ops
}

/** LCS 全表 + 回溯(调用方保证 rows×cols ≤ MAX_OPS_CELLS)。 */
function backtrackOps(midA: readonly string[], midB: readonly string[], ops: LineDiffOp[]): void {
  if (midA.length === 0) {
    for (const text of midB) ops.push({ type: 'add', text })
    return
  }
  if (midB.length === 0) {
    for (const text of midA) ops.push({ type: 'del', text })
    return
  }
  const rows = midA.length
  const cols = midB.length
  // dp[i][j] = midA[i..] 与 midB[j..] 的 LCS 长度(多一行一列的 0 边界)。
  const dp: Int32Array[] = Array.from({ length: rows + 1 }, () => new Int32Array(cols + 1))
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = dp[i]
    if (row === undefined) continue
    for (let j = cols - 1; j >= 0; j -= 1) {
      row[j] = midA[i] === midB[j]
        ? (dp[i + 1]?.[j + 1] ?? 0) + 1
        : Math.max(dp[i + 1]?.[j] ?? 0, row[j + 1] ?? 0)
    }
  }
  let i = 0
  let j = 0
  while (i < rows && j < cols) {
    if (midA[i] === midB[j]) {
      ops.push({ type: 'same', text: midA[i] as string })
      i += 1
      j += 1
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      ops.push({ type: 'del', text: midA[i] as string })
      i += 1
    } else {
      ops.push({ type: 'add', text: midB[j] as string })
      j += 1
    }
  }
  while (i < rows) {
    ops.push({ type: 'del', text: midA[i] as string })
    i += 1
  }
  while (j < cols) {
    ops.push({ type: 'add', text: midB[j] as string })
    j += 1
  }
}
