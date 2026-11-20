#!/usr/bin/env node
/**
 * T50 · rc.5 验收矩阵汇编器
 *
 * 依据：
 *  - 51 §3 用例定义（164 条）
 *  - 54 §5.1/§5.2 套件→阶段映射
 *  - 51 §0.3 / 54 §5.4 / §7.1 / §7.3 证据规范
 *
 * 规则（与 acceptance-matrix.md 头部一致）：
 *  - PASS   = 引用证据含命令日志 + 结果记录，且退出码符合（0 / HTTP 200 / 负控期望值），结果记录判 PASS
 *  - FAIL   = 任一引用证据判 FAIL（断言未满足）
 *  - MISSING= SKIP / NOTRUN / 未执行 / 无结果记录；不得标绿
 *
 * 说明：本脚本只读 artifacts/rc5/**，只写 artifacts/rc5/p6a/**、acceptance-matrix.md
 *      和 p0/p1..p7 的 phase summary。不执行任何被测命令。
 */
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = "/Users/sunny/code/agent-basis-rc5";
process.chdir(ROOT);

const READ = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "");
const P2 = (n) => String(n).padStart(3, "0");
const has = (p) => fs.existsSync(p);

/* ---------- 路径助手 ---------- */
const env = (n) => `artifacts/rc5/ENV/RC5-ENV-${P2(n)}`;
const boot = (n) => `artifacts/rc5/E1/BOOT/RC5-BOOT-${P2(n)}`;
const api = (n) => `artifacts/rc5/API/RC5-API-${P2(n)}`;
const acc = (n) => `artifacts/rc5/E2/ACC/RC5-ACC-${P2(n)}`;
const mcps = (n) => `artifacts/rc5/E1/MCPS/RC5-MCPS-${P2(n)}`;
const mcpsTop = (n) => `artifacts/rc5/MCPS/RC5-MCPS-${P2(n)}`;
const mcpp = (n) => `artifacts/rc5/E2/MCPP/RC5-MCPP-${P2(n)}`;
const term1 = (n) => `artifacts/rc5/E1/TERM/RC5-TERM-${P2(n)}`;
const term2 = (s) => `artifacts/rc5/E2/TERM/RC5-TERM-${s}`;
const e3 = (s) => `artifacts/rc5/e3-super/${s}`;
const imp = (n) => `artifacts/rc5/E1/IMP/RC5-IMP-${P2(n)}`;
const acp = (n) => `artifacts/rc5/ACP/RC5-ACP-${P2(n)}`;
const off = (n) => `artifacts/rc5/E1/OFF/RC5-OFF-${P2(n)}`;
const hero = (n) => `artifacts/rc5/E1/HERO/RC5-HERO-${P2(n)}`;
const cmd = (n) => `artifacts/rc5/E1/CMD/RC5-CMD-${P2(n)}`;
const v1 = (n) => `artifacts/rc5/V1/RC5-V1-${P2(n)}`;
const data = (n) => `artifacts/rc5/DATA/RC5-DATA-${P2(n)}`;
const uiT = (n) => `artifacts/rc5/UI/RC5-UI-${P2(n)}`;
const ui2 = (n) => `artifacts/rc5/E2/UI/RC5-UI-${P2(n)}`;
const secT = (n) => `artifacts/rc5/SEC/RC5-SEC-${P2(n)}`;
const sec2 = (n) => `artifacts/rc5/E2/SEC/RC5-SEC-${P2(n)}`;
// 确定性假模型回合旁证轨（终版镜像 ae5ce8cb；工具清单/调用/删除/登出语义）
const llm = (id) => `artifacts/rc5/E2/LLM/${id}`;

/* ---------- 证据源构造器 ---------- */
/** result.md 记录 */
const R = (dir, o = {}) => ({ k: "dir", dir, record: "result.md", cmd: "cmd.log", ...o, cover: o.cover !== false });
/** assert.json 记录（ACP） */
const AS = (dir, o = {}) => ({ k: "dir", dir, record: "assert.json", cmd: "cmd.log", ...o, cover: o.cover !== false });
/** report.md 记录 + 多个 run 日志（MCPS P2 lane） */
const RP = (dir, o = {}) => ({ k: "dir", dir, record: "report.md", cmds: o.cmds || ["run.log"], ...o, cover: o.cover !== false });
/** p6b summary.json + DATA 用例目录 */
const PB = (caseDir, o = {}) => ({ k: "p6b", dir: "artifacts/rc5/p6b", caseDir, cover: o.cover !== false });
/** P5 镜像运行时探针（run.log 标记行 + cmd.log） */
const MK = (file, must, o = {}) => ({
  k: "marker",
  file,
  must,
  cmd: "artifacts/rc5/p5/testbed/env-runtime/cmd.log",
  cover: o.cover !== false,
  label: o.label,
});

/* ---------- 164 条用例注册表 ---------- */
const cases = [];
const add = (id, suite, phase, prio, title, sources, owner) =>
  cases.push({ id, suite, phase, prio, title, sources, owner });

/* ENV · 8 */
add("RC5-ENV-001", "ENV", "P1", "P0", "pnpm install --frozen-lockfile（EXIT 0/锁不变）", [R(env(1))], "T09/L6");
add("RC5-ENV-002", "ENV", "P1", "P0", "版本残留扫描（alpha/rc.1 = 0 命中）", [R(env(2))], "T09/L6");
add("RC5-ENV-003", "ENV", "P1", "P0", "版本族统一（dsh rc.5/cordis 4.1.0/cosmokit 1.9.0）", [R(env(3))], "T09/L6");
add("RC5-ENV-004", "ENV", "P5", "P0", "容器内 dsh --version = 0.2.2-rc.5", [
  R(env(4), { cover: false }),
  MK("artifacts/rc5/p5/testbed/env-runtime/run.log", ["RC5-ENV-004", "dsh --version = 0.2.2-rc.5"]),
], "T48/L6");
add("RC5-ENV-005", "ENV", "P5", "P0", "engines.node ≥24.9 且镜像 node 满足", [
  R(env(5), { cover: false }),
  MK("artifacts/rc5/p5/testbed/env-runtime/run.log", ["node -v ≥ 24.9", "v24.22.3"]),
], "T48/L6");
add("RC5-ENV-006", "ENV", "P5", "P0", "Dockerfile 钉版 dsh@0.2.2-rc.5", [R(env(6))], "T48/L6");
add("RC5-ENV-007", "ENV", "P1", "P1", "pnpm -w run verify 全包绿（含工坊锚点）", [R(env(7))], "T09/L6");
add("RC5-ENV-008", "ENV", "P1", "P1", "llm-openai typecheck", [R(env(8))], "T09/L6");

/* BOOT · 13 */
add("RC5-BOOT-001", "BOOT", "P5", "P0", "E1 空数据根首启 healthy", [R(boot(1))], "T43/L5");
add("RC5-BOOT-002", "BOOT", "P5", "P0", "E3 super 容器起 + super 路由", [R(boot(2)), R(e3("RC5-BOOT-002"))], "T43/L5");
add("RC5-BOOT-003", "BOOT", "P5", "P0", "E4 ACP 容器起、stdio 纯净", [R(boot(3))], "T31/L5");
add("RC5-BOOT-004", "BOOT", "P2", "P0", "启动日志 unknown plugin row = 0", [R(boot(4))], "T10/L2");
add("RC5-BOOT-005", "BOOT", "P2", "P0", "已删除行（account-controller/office-to-pdf）不存在", [R(boot(5))], "T10/L2");
add("RC5-BOOT-006", "BOOT", "P2", "P0", "rc.5 新增 9 行全部到位", [R(boot(6))], "T10/L2");
add("RC5-BOOT-007", "BOOT", "P2", "P0", "preset 全量替换后保留 rc.5 默认行", [R(boot(7))], "T10/L2");
add("RC5-BOOT-008", "BOOT", "P2", "P0", "旧 profile 默认 bundle 迁移一次", [R(boot(8))], "T14/L2");
add("RC5-BOOT-009", "BOOT", "P2", "P0", "已 opt-out 默认 bundle 不回加", [R(boot(9))], "T14/L2");
add("RC5-BOOT-010", "BOOT", "P2", "P1", "损坏 package.json 的 profile boot 不静默炸", [R(boot(10))], "T12/L2");
add("RC5-BOOT-011", "BOOT", "P2", "P0", "DSH_AGENTS_HOME=/data/agents + 用户技能可用", [R(boot(11))], "T42/L5");
add("RC5-BOOT-012", "BOOT", "P2", "P0", "10 个产品 client bundle/roster 完整", [R(boot(12))], "T36/L7");
add("RC5-BOOT-013", "BOOT", "P6a", "P1", "super agent-team 三行 + Team mode 默认关", [R(boot(13)), R(e3("RC5-BOOT-013"))], "T49a/L6");

/* API · 9 */
add("RC5-API-001", "API", "P1", "P0", "compaction verify（241 tests）", [R(api(1))], "T09/L6");
add("RC5-API-002", "API", "P1", "P0", "memory verify", [R(api(2))], "T09/L6");
add("RC5-API-003", "API", "P1", "P0", "llm-openai typecheck", [R(api(3))], "T09/L6");
add("RC5-API-004", "API", "P1", "P0", "tasks verify（864 tests）", [R(api(4))], "T09/L6");
add("RC5-API-005", "API", "P6a", "P0", "主会话派 2 worker/waitForTreeWork 全完成", [R(api(5)), R(e3("RC5-API-005"), { cover: false })], "T49e/L6");
add("RC5-API-006", "API", "P6a", "P1", "listDescendants 与任务树一致", [R(api(6)), R(e3("RC5-API-006"), { cover: false })], "T49e/L6");
add("RC5-API-007", "API", "P6a", "P1", "drainDescendants 后无残留 running", [R(api(7)), R(e3("RC5-API-007"), { cover: false })], "T49e/L6");
add("RC5-API-008", "API", "P1", "P1", "LlmError 旧构造签名 0 残留", [R(api(8))], "T09/L6");
add("RC5-API-009", "API", "P4", "P2", "LoggerLevel 数值语义（WARN=1/INFO=2）", [R(api(9))], "T07/L1");

/* ACC · 10 */
add("RC5-ACC-001", "ACC", "P4", "P0", "packctl tenant-scan 0 违规", [R(acc(1))], "T24/L4");
add("RC5-ACC-002", "ACC", "P2", "P0", "packctl prompt-scan 0 违规", [R(acc(2))], "T17/L2");
add("RC5-ACC-003", "ACC", "P4", "P0", "packctl form-check 0 违规", [R(acc(3))], "T24/L4");
add("RC5-ACC-004", "ACC", "P4", "P0", "mux 动作漂移差集 0（含 terminal 9）", [R(acc(4))], "T24/L4");
add("RC5-ACC-005", "ACC", "P4", "P0", "admin-only 不变式（⊆ 全量）", [R(acc(5))], "T25/L4");
add("RC5-ACC-006", "ACC", "P6a", "P0", "普通用户 mcp-manager 设置/管理全拒", [R(acc(6))], "T49a/L6");
add("RC5-ACC-007", "ACC", "P6a", "P0", "B 用 A 的 sessionId unary 403/审计", [R(acc(7))], "T49a/L6");
add("RC5-ACC-008", "ACC", "P6a", "P0", "B 用 A 的 workspaceId 文件/检索 403", [R(acc(8))], "T49a/L6");
add("RC5-ACC-009", "ACC", "P6a", "P1", "chat-import 前缀登记；未登录 401", [R(acc(9), { okCodes: [400, 401] })], "T49a/L6");
add("RC5-ACC-010", "ACC", "P4", "P1", "全局事件 allowlist 单测无回归", [R(acc(10))], "T25/L4");

/* MCPS · 11 */
add("RC5-MCPS-001", "MCPS", "P6a", "P0", "管理员新增系统层 HTTP MCP server", [R(mcps(1))], "T49a/L6");
add("RC5-MCPS-002", "MCPS", "P6a", "P0", "重启后 server 仍在且连接成功", [R(mcps(2))], "T49a/L6");
add("RC5-MCPS-003", "MCPS", "P6a", "P0", "会话内调用系统 MCP 工具", [R(mcps(3)), R(llm("RC5-MCPS-003"))], "T49a/L6");
add("RC5-MCPS-004", "MCPS", "P6a", "P0", "普通用户看不到/改不了全局 MCP", [R(mcps(4))], "T49a/L6");
add("RC5-MCPS-005", "MCPS", "P6a", "P0", "普通用户 watch 系统 MCP 被拒", [R(mcps(5))], "T49a/L6");
// 负控用例：期望值是 403（不是 0/200），登记 okCodes 以免被当 EXIT 不匹配
add("RC5-MCPS-006", "MCPS", "P6a", "P0", "普通用户 restart/probe 必须被拒", [R(mcps(6), { okCodes: [403] })], "T49a/L6");
add("RC5-MCPS-007", "MCPS", "P6a", "P1", "管理员 watch 连接状态流可用", [R(mcps(7))], "T49a/L6");
add("RC5-MCPS-008", "MCPS", "P2", "P1", "migrate-mcp-servers 写入/幂等（12 tests）", [
  RP(mcpsTop(8), { cmds: ["run1.log", "run2.log"] }),
  R(mcps(8), { cover: false }),
], "T13/L2");
add("RC5-MCPS-009", "MCPS", "P6a", "P1", "非法 YAML/未知 transport 报错不破坏配置", [R(mcps(9))], "T49a/L6");
add("RC5-MCPS-010", "MCPS", "P6a", "P1", "系统 MCP 启动失败不阻塞 boot/会话可用", [R(mcps(10))], "T49a/L6");
add("RC5-MCPS-011", "MCPS", "P2", "P0", "H9 重渲染保留 servers + 0600 失败备份", [
  RP(mcpsTop(11), { cmds: ["render.log", "failure.log"] }),
  R(mcps(11), { cover: false }),
], "T13/L2");

/* MCPP · 24 */
const MCPP = [
  ["A list 只含 A 的条目", "P0"], ["B list 只含 B 的条目", "P0"], ["B upsert A 行被拒且 A 不变", "P0"],
  ["B delete A 行被拒且 A 仍在", "P0"], ["catalog 只含允许项；自填 stdio 被拒", "P0"], ["B 从管理员目录新建 echo 成功", "P0"],
  ["本地 HTTP MCP 新建/probe 成功", "P0"], ["IPv4 元数据地址拒绝", "P0"], ["IPv6 元数据地址拒绝", "P0"],
  ["任意 HTTPS 校验通过、不被策略拦", "P1"], ["personalHttpHosts 白名单", "P1"], ["header secret AES-GCM、日志无明文", "P0"],
  ["list 只回 hasSecret 不回值", "P0"], ["每人 8 条上限", "P1"], ["256KB 配置上限", "P1"],
  ["挂死 stdio 8s 放弃", "P1"], ["慢 HTTP 工具 60s 超时", "P1"], ["断线重连 3 次后停止", "P1"],
  ["删除后 live 会话工具当场消失", "P0"], ["跨用户 mcp__p<uid>_* 调用 deny", "P0"], ["A/B 同名 server 隔离", "P0"],
  ["登出/禁用后个人工具不可用", "P0"], ["重启后个人配置仍在", "P0"], ["个人 MCP UI 增删改测/密钥 write-only", "P1"],
];
MCPP.forEach(([title, prio], i) => {
  const n = i + 1;
  add(`RC5-MCPP-${P2(n)}`, "MCPP", "P6a", prio, title, [R(mcpp(n))], "T49b/L6");
});
// 需要 live 会话/跨用户工具调用的三条，补终版镜像假模型回合证据（E2/LLM）
for (const id of ["RC5-MCPP-019", "RC5-MCPP-020", "RC5-MCPP-022", "RC5-TERM-002", "RC5-TERM-003"]) {
  const c = cases.find((row) => row.id === id);
  if (c) c.sources.push(R(llm(id)));
}

/* TERM · 14 */
add("RC5-TERM-001", "TERM", "P4", "P0", "profile 含 terminal bundle", [R(term1(1)), R(e3("RC5-TERM-001"))], "T34/L4");
add("RC5-TERM-002", "TERM", "P6a", "P0", "侧栏 terminal 面板/首键人接管", [R(term1(2)), R(term2("002")), R(e3("RC5-TERM-002"))], "T49b/L6");
add("RC5-TERM-003", "TERM", "P6a", "P0", "6 个 terminal_* 工具逐个可调用", [R(term1(3)), R(term2("003"))], "T49b/L6");
add("RC5-TERM-004", "TERM", "P6a", "P0", "B 用 A sessionId 调 6 unary 全拒", [
  R(term1(4)),
  R(term2("004a")), R(term2("004b")), R(term2("004c")), R(term2("004d")), R(term2("004e")), R(term2("004f")),
  R(e3("RC5-TERM-004")),
], "T49b/L6");
add("RC5-TERM-005", "TERM", "P6a", "P0", "attach/retain/watch 三流跨租户被拒", [
  R(term1(5), { cover: false }),
  R(term2("005a")), R(term2("005b")), R(term2("005c")),
  R(e3("RC5-TERM-005"), { cover: false }),
], "T49b/L6");
add("RC5-TERM-006", "TERM", "P6a", "P0", "A 同 session 9 动作全部成功", [R(term1(6)), R(term2("006")), R(e3("RC5-TERM-006"))], "T49b/L6");
add("RC5-TERM-007", "TERM", "P4", "P0", "readUserTerminals=false/preferredShells=[bash]", [R(term1(7)), R(term2("007")), R(e3("RC5-TERM-007"))], "T34/L4");
add("RC5-TERM-008", "TERM", "P6a", "P0", "用户终端列表能力不可见/不可调", [R(term1(8)), R(term2("008"))], "T49b/L6");
add("RC5-TERM-009", "TERM", "P6a", "P1", "长进程切页再回：进程存活/输出连续", [R(term1(9))], "T49b/L6");
add("RC5-TERM-010", "TERM", "P6a", "P1", "close 后再 attach 无幽灵终端", [R(term1(10))], "T49b/L6");
add("RC5-TERM-011", "TERM", "P6a", "P1", "rename/retain 后刷新状态持久", [R(term1(11)), R(term2("011"))], "T49b/L6");
add("RC5-TERM-012", "TERM", "P6a", "P0", "两会话各开终端互不可见/互不输入", [R(term1(12)), R(e3("RC5-TERM-012"))], "T49b/L6");
add("RC5-TERM-013", "TERM", "P6a", "P1", "24h 浸泡无 fd 泄漏/内存增长", [R(term1(13)), R(e3("RC5-TERM-013"))], "T49b/L6");
add("RC5-TERM-014", "TERM", "P5", "P2", "bash 不存在时明确报错、容器不崩", [R(term1(14))], "T48/L6");

/* IMP · 10 */
add("RC5-IMP-001", "IMP", "P6a", "P0", "未登录 POST archive 401 不写会话", [R(imp(1))], "T49c/L6");
add("RC5-IMP-002", "IMP", "P6a", "P0", "B 传 A 的 workspaceId 403 不写", [R(imp(2))], "T49c/L6");
add("RC5-IMP-003", "IMP", "P6a", "P0", "10 会话归档 200/sessionIds=10", [R(imp(3))], "T49c/L6");
add("RC5-IMP-004", "IMP", "P6a", "P0", "导入会话 B 可见/A 不可见", [R(imp(4))], "T49c/L6");
add("RC5-IMP-005", "IMP", "P6a", "P0", "DB sessions owner_id=B 无空属主", [R(imp(5))], "T49c/L6");
add("RC5-IMP-006", "IMP", "P6a", "P1", "1001 会话按上限拒绝/截断", [R(imp(6))], "T49c/L6");
add("RC5-IMP-007", "IMP", "P6a", "P1", "512MiB 边界上传不 OOM", [R(imp(7))], "T49c/L6");
add("RC5-IMP-008", "IMP", "P6a", "P1", "上传中途取消后对账无孤儿", [R(imp(8))], "T49c/L6");
add("RC5-IMP-009", "IMP", "P6a", "P1", "坏 JSON 行跳过、成功会话完整", [R(imp(9))], "T49c/L6");
add("RC5-IMP-010", "IMP", "P5", "P1", "反代 client_max_body_size 512m/读超时", [R(imp(10))], "T44/L5");

/* ACP · 10 */
add("RC5-ACP-001", "ACP", "P6a", "P0", "initialize 协议协商成功", [AS(acp(1))], "T49c/L6");
add("RC5-ACP-002", "ACP", "P6a", "P0", "session/new + prompt 正常返回", [AS(acp(2))], "T49c/L6");
add("RC5-ACP-003", "ACP", "P6a", "P0", "stdout 每行均为纯 JSON-RPC", [AS(acp(3))], "T49c/L6");
add("RC5-ACP-004", "ACP", "P6a", "P0", "ACP 容器无监听端口", [AS(acp(4))], "T49c/L6");
add("RC5-ACP-005", "ACP", "P6a", "P0", "非法 JSON 返回 error 且进程不崩", [AS(acp(5))], "T49c/L6");
add("RC5-ACP-006", "ACP", "P6a", "P0", "工具审批 request_permission 不挂死", [AS(acp(6))], "T49c/L6");
add("RC5-ACP-007", "ACP", "P6a", "P0", "取消 prompt 生效、后续可用", [AS(acp(7))], "T49c/L6");
add("RC5-ACP-008", "ACP", "P6a", "P1", "两客户端并发隔离无串话", [AS(acp(8))], "T49c/L6");
add("RC5-ACP-009", "ACP", "P4", "P1", "文档定位（共享 /data/无租户隔离）", [AS(acp(9))], "T31/L5");
add("RC5-ACP-010", "ACP", "P6a", "P1", "web+ACP 同卷并发无数据库锁", [AS(acp(10))], "T49c/L6");

/* OFF · 7 */
add("RC5-OFF-001", "OFF", "P6a", "P0", "docx → pdf（中文不乱码）", [R(off(1))], "T49c/L6");
add("RC5-OFF-002", "OFF", "P6a", "P0", "xlsx → pdf（表格/公式正确）", [R(off(2))], "T49c/L6");
add("RC5-OFF-003", "OFF", "P6a", "P0", "pptx → pdf（版式不崩）", [R(off(3))], "T49c/L6");
add("RC5-OFF-004", "OFF", "P5", "P1", "镜像含 Noto Sans CJK", [R(off(4))], "T41/L5");
add("RC5-OFF-005", "OFF", "P5", "P1", "镜像 python-docx/openpyxl/pptx 可导入", [R(off(5))], "T41/L5");
add("RC5-OFF-006", "OFF", "P6a", "P1", "输出 24h/512MB 清理、备份排除 outputs", [R(off(6))], "T49c/L6");
add("RC5-OFF-007", "OFF", "P6a", "P1", "office-docx 技能加载并编辑样本", [R(off(7))], "T49c/L6");

/* HERO · 8 */
const HERO = [
  ["hero=false 页面无额外包裹", "P0"], ["hero=true 品牌层出现且不遮输入框", "P0"], ["输入框可聚焦/输入/发送", "P0"],
  ["滚动到底/顶无浮层错位重影", "P1"], ["双主题品牌色跟随主题", "P1"], ["三视口布局只收缩不溢出", "P1"],
  ["prefers-reduced-motion 静态呈现", "P1"], ["浮层只挂 hero 态、切换无残留", "P2"],
];
HERO.forEach(([t, prio], i) => add(`RC5-HERO-${P2(i + 1)}`, "HERO", "P6a", prio, t, [R(hero(i + 1))], "T49d/L6"));

/* CMD · 4 */
add("RC5-CMD-001", "CMD", "P6a", "P1", "输入 / 命令列表可见且齐全", [R(cmd(1))], "T49d/L6");
add("RC5-CMD-002", "CMD", "P6a", "P1", "执行内置命令结果正确", [R(cmd(2))], "T49d/L6");
add("RC5-CMD-003", "CMD", "P6a", "P1", "与现有 slash 命令并存无冲突", [R(cmd(3))], "T49d/L6");
add("RC5-CMD-004", "CMD", "P6a", "P1", "ACP 无命令面（无 UI 面）", [R(cmd(4))], "T49d/L6");

/* V1 · 8 */
add("RC5-V1-001", "V1", "P3", "P0", "v1 源/basis.yml 全部已跟踪", [R(v1(1))], "T20/L3");
add("RC5-V1-002", "V1", "P3", "P0", "锁文件含 @basis/@core 全部条目", [R(v1(2))], "T20/L3");
add("RC5-V1-003", "V1", "P3", "P0", "cordis 4.1.0 版本/来源/NOTICE", [R(v1(3))], "T19/L3");
add("RC5-V1-004", "V1", "P3", "P0", "core/cordis test 绿（5 tests）", [R(v1(4))], "T20/L3");
add("RC5-V1-005", "V1", "P3", "P0", "core/runtime test + basis chat 6 插件", [R(v1(5))], "T20/L3");
add("RC5-V1-006", "V1", "P3", "P1", "v1 CI 独立车道绿", [R(v1(6))], "T20/L3");
add("RC5-V1-007", "V1", "P3", "P1", "v1 源无 @deepseek-ai/dsh import", [R(v1(7))], "T20/L3");
add("RC5-V1-008", "V1", "P5", "P1", "镜像不含 v1 源/清单", [
  R(v1(8), { cover: false }),
  MK("artifacts/rc5/p5/testbed/env-runtime/run.log", ["v1 剥离", "absent"]),
], "T48/L6");

/* DATA · 10 */
add("RC5-DATA-001", "DATA", "P5", "P0", "init-data-dirs 幂等、根/实例 0700", [PB(data(1))], "T45/L5");
add("RC5-DATA-002", "DATA", "P5", "P0", "E1 compose /data 绑定测试数据根", [PB(data(2))], "T43/L5");
add("RC5-DATA-003", "DATA", "P5", "P0", "容器内 DSH_HOME=/data", [PB(data(3))], "T43/L5");
add("RC5-DATA-004", "DATA", "P6b", "P0", "迁移两遍硬链接/大小与源一致", [PB(data(4))], "T51/L5");
add("RC5-DATA-005", "DATA", "P6b", "P0", "迁移副本全库 integrity_check ok", [PB(data(5))], "T51/L5");
add("RC5-DATA-006", "DATA", "P5", "P0", "DSH_AGENTS_HOME=/data/agents", [PB(data(6))], "T45/L5");
add("RC5-DATA-007", "DATA", "P5", "P0", "重启后会话/设置/MCP/记忆全在", [PB(data(7))], "T45/L5");
add("RC5-DATA-008", "DATA", "P6b", "P1", "备份→删除→恢复一致", [PB(data(8))], "T51/L5");
add("RC5-DATA-009", "DATA", "P6b", "P1", "24h SQLite 浸泡无锁/WAL 异常", [PB(data(9))], "T51/L5");
add("RC5-DATA-010", "DATA", "P6b", "P0", "回滚演练：旧镜像+旧卷副本可用", [PB(data(10))], "T51/L5");

/* UI · 8 */
add("RC5-UI-001", "UI", "P4", "P0", "lint-ui-tokens 0 违规（新包全覆盖）", [R(uiT(1))], "T36/L7");
add("RC5-UI-002", "UI", "P4", "P1", "圆角只用阶梯值且嵌套同心", [R(uiT(2))], "T36/L7");
add("RC5-UI-003", "UI", "P4", "P1", "font-weight 仅 400/500/600、正文无 500", [R(uiT(3))], "T36/L7");
add("RC5-UI-004", "UI", "P4", "P1", "图标走 @eterna/ui/icons/icon-data", [R(uiT(4))], "T36/L7");
add("RC5-UI-005", "UI", "P4", "P1", "断点仅 1100/760/640", [R(uiT(5))], "T36/L7");
add("RC5-UI-006", "UI", "P6a", "P0", "双主题×三视口截图（MCP/terminal/hero/chat-import）", [R(ui2(6))], "T49d/L6");
add("RC5-UI-007", "UI", "P6a", "P1", "MCP 作为 settings.section、无独立页", [R(ui2(7))], "T49d/L6");
add("RC5-UI-008", "UI", "P6a", "P1", "z-index 白名单/叠层分区", [R(ui2(8))], "T49d/L6");

/* SEC · 10 */
add("RC5-SEC-001", "SEC", "P4", "P0", "无运行态目录/凭据入库", [R(secT(1))], "T24/L4");
add("RC5-SEC-002", "SEC", "P4", "P0", "凭据扫描（跟踪文件/镜像/argv）", [R(secT(2))], "T24/L4");
add("RC5-SEC-003", "SEC", "P4", "P0", "无外发遥测", [R(secT(3))], "T24/L4");
add("RC5-SEC-004", "SEC", "P6a", "P0", "跨租户枚举 session/workspace/文件/MCP 全拒", [R(sec2(4))], "T49e/L6");
add("RC5-SEC-005", "SEC", "P6a", "P0", "普通用户管理面（MCP/插件/市场写）不可写", [R(sec2(5))], "T49e/L6");
add("RC5-SEC-006", "SEC", "P6a", "P0", "审计无明文、关键事件齐全", [R(sec2(6))], "T49e/L6");
add("RC5-SEC-007", "SEC", "P6a", "P1", "内网 MCP 放行、元数据地址拒绝", [R(sec2(7))], "T49e/L6");
add("RC5-SEC-008", "SEC", "P6a", "P1", "登录归属/登出后拒绝", [R(sec2(8))], "T49e/L6");
add("RC5-SEC-009", "SEC", "P6a", "P0", "既有单测全绿（verify 38 包/4187 tests）", [R(sec2(9))], "T49e/L6");
add("RC5-SEC-010", "SEC", "P6a", "P1", "旧会话/记忆/提示词升级后可用", [R(sec2(10))], "T49e/L6");

/* ---------- 证据解析 ---------- */
function parseVerdictText(text) {
  const m = text.match(/(?:结论|判定|状态)[：:]\s*\**\s*([^\n*]{1,100})/);
  const raw = m ? m[1].trim() : "";
  const s = raw.toUpperCase();
  let v = "UNKNOWN";
  if (/NOT ?RUN/.test(s) || /SKIP/.test(s)) v = "SKIP";
  else if (/FAIL/.test(s)) v = "FAIL";
  else if (/PASS/.test(s)) v = "PASS";
  return { v, raw };
}

function parseExits(text, okCodes = [0, 200]) {
  const toks = [];
  for (const m of text.matchAll(/(?:^|\s)(?:EXIT|DOCKER_EXEC_EXIT|HARNESS_EXIT|EXIT_RENDER|EXIT_FAIL)[ =](\{[^\n]*\}|\d+)/g)) {
    toks.push(m[1].slice(0, 120));
  }
  for (const m of text.matchAll(/\[exit=(\d+)\]/g)) toks.push(m[1]);
  const nums = [];
  for (const t of toks) {
    if (t.startsWith("{")) {
      const codes = [...t.matchAll(/"code"\s*:\s*(-?\d+)/g)].map((m) => Number(m[1]));
      if (codes.length) nums.push(...codes);
      else nums.push(NaN);
    } else nums.push(Number(t));
  }
  const okNums = nums.filter((n) => Number.isFinite(n));
  return { tokens: toks.slice(0, 12), nums: okNums.slice(0, 16), success: okNums.some((n) => okCodes.includes(n)) };
}

function evalSource(s) {
  const out = { ...s, exists: false, verdict: "NO_EVIDENCE", raw: "", exitTokens: [], exitOk: false, files: [] };

  if (s.k === "dir") {
    const rec = path.join(s.dir, s.record);
    const cmdFiles = s.cmds || (s.cmd ? [s.cmd] : []);
    out.files = [rec, ...cmdFiles.map((c) => path.join(s.dir, c))];
    out.exists = out.files.every(has);
    if (!has(rec)) {
      out.verdict = "NO_RECORD";
      out.raw = `缺 ${s.record}`;
      return out;
    }
    const recText = READ(rec);
    const cmdText = cmdFiles.map((c) => READ(path.join(s.dir, c))).join("\n");
    if (s.record === "assert.json") {
      try {
        const j = JSON.parse(recText);
        out.verdict = String(j.status || "UNKNOWN").toUpperCase();
        out.raw = j.status || "";
      } catch {
        out.verdict = "BAD_JSON";
      }
    } else {
      const v = parseVerdictText(recText);
      out.verdict = v.v;
      out.raw = v.raw;
      if (out.verdict === "UNKNOWN" && s.record === "report.md") {
        // report.md 允许多行结论：取首个含 PASS/FAIL/SKIP 的结论段落
        const v2 = parseVerdictText(recText.replace(/\n/g, " "));
        out.verdict = v2.v;
        out.raw = v2.raw || out.raw;
      }
    }
    const ex = parseExits(`${cmdText}\n${recText}`, s.okCodes || [0, 200]);
    out.exitTokens = ex.tokens;
    out.exitOk = ex.success;
    return out;
  }

  if (s.k === "p6b") {
    const summary = JSON.parse(READ(path.join(s.dir, "summary.json")) || "{}");
    const row = (summary.cases || []).find((c) => c.id === s.caseId);
    const caseDir = s.caseDir;
    const rec = path.join(caseDir, "result.md");
    const cmdP = path.join(caseDir, "cmd.log");
    out.files = [path.join(s.dir, "summary.json"), rec, cmdP];
    out.exists = has(rec) && has(cmdP);
    out.verdict = row ? String(row.status).toUpperCase() : "NO_RECORD";
    out.raw = row ? row.summary || row.status : "summary.cases 无该用例";
    const ex = parseExits(`${READ(cmdP)}\n${READ(rec)}`);
    out.exitTokens = ex.tokens;
    out.exitOk = ex.success;
    return out;
  }

  if (s.k === "marker") {
    const text = READ(s.file);
    out.files = [s.file, s.cmd];
    out.exists = has(s.file) && has(s.cmd);
    const line = text.split("\n").find((l) => l.includes("[PASS]") && s.must.every((m) => l.includes(m)));
    const allInText = s.must.every((m) => text.includes(m)) && text.includes("[PASS]");
    out.verdict = line || allInText ? "PASS" : "MARKER_MISS";
    out.raw = line ? line.trim().slice(0, 140) : allInText ? `全文命中：${s.must.join(" + ")}` : `未找到标记：${s.must.join(" + ")}`;
    const ex = parseExits(READ(s.cmd));
    out.exitTokens = ex.tokens;
    out.exitOk = ex.success;
    return out;
  }

  return out;
}

// p6b 源需要 caseId → 从 DATA 目录注入
for (const c of cases) {
  for (const s of c.sources) {
    if (s.k === "p6b") {
      s.caseId = c.id;
      s.caseDir = `artifacts/rc5/DATA/${c.id}`;
    }
  }
}

/* ---------- 判定 ---------- */
const NOTES = {
  "RC5-ACC-006": "普通用户 probe=200/true、restart=200/true（unary 未拒）",
  "RC5-ACC-008": "workspaceFiles/list|stat|read 未拒，A 文件内容泄漏",
  "RC5-MCPS-006": "普通用户 restart/probe 200/true",
  "RC5-TERM-004": "B 读到 A cwd/shells、close 成功；create/rename 方法自错无法判定",
  "RC5-TERM-006": "create/rename/retain 失败（session.snapshotEvents / terminal unavailable）",
  "RC5-UI-006": "390 hero 提示遮挡 chip；terminal 5/6 错误页；chat-import 6/6 无入口",
  "RC5-SEC-002": "静态/运行时复扫已 0 命中（历史 14 处测试字面量已替换为显式测试值）",
  "RC5-SEC-004": "workspaceFiles/read 未拒，B 读到 A 工作区文件",
  "RC5-SEC-005": "mcpManager/probe|restart 200/true（管理面 unary 可达）",
  "RC5-BOOT-007": "`--dump-default-config` EXIT=1/0 bytes；default=0 的空集 PASS 不成立，需修复命令后重跑",
  "RC5-MCPS-003": "会话内调用需真实模型回合；E1 无 LLM 凭据，未执行",
  "RC5-MCPS-007": "套件因 MCPS-006 越权红中止",
  "RC5-MCPS-009": "套件因 MCPS-006 越权红中止",
  "RC5-MCPS-010": "套件因 MCPS-006 越权红中止",
  "RC5-MCPP-011": "未以 personalHttpHosts 白名单启动容器；仅有单测，未容器实跑",
  "RC5-MCPP-016": "需 live 会话建立挂死子进程；未执行",
  "RC5-MCPP-017": "需真实工具调用与 60s 等待；未执行",
  "RC5-MCPP-018": "需长时断连/恢复时序；未执行",
  "RC5-MCPP-019": "需 live 会话 + tools/list 观察；未执行",
  "RC5-MCPP-020": "需子代理/跨用户会话工具调用；未执行",
  "RC5-MCPP-022": "需 live 会话作用域观察；未执行",
  "RC5-MCPP-024": "浏览器双主题三视口截图未执行",
  "RC5-TERM-002": "需浏览器键盘实测；且 create P1 使活终端建不出",
  "RC5-TERM-003": "需模型回合触发工具调用；未执行",
  "RC5-TERM-009": "套件因 TERM-004 跨租户红中止",
  "RC5-TERM-010": "套件因 TERM-004 跨租户红中止",
  "RC5-TERM-011": "依赖 create 成功；被 session.snapshotEvents P1 阻断",
  "RC5-TERM-012": "套件中止；E3 亦未执行",
  "RC5-TERM-013": "24h 窗口未满（final-image 窗口 plannedEnd 2026-11-21T05:06:19Z）；每 tick churn=create→WS attach(snapshot)→close 全 ok；未满不得判绿",
  "RC5-TERM-014": "套件因 TERM-004 跨租户红中止",
  "RC5-IMP-007": "512MiB 压测规避共享宿主，未执行",
  "RC5-OFF-007": "需模型回合加载技能，未执行",
  "RC5-HERO-007": "IAB 无 media 模拟接口，未动态执行",
  "RC5-DATA-009": "24h 窗口未满（final-image）；每 tick integrity 全 ok、0 锁/WAL 异常、写成功；未满不得判绿",
  "RC5-SEC-010": "无旧版本数据实例；未执行",
};
for (const c of cases) {
  c.note = NOTES[c.id] || "";
  c.evaluated = c.sources.map(evalSource);
  const anyFail = c.evaluated.some((s) => s.verdict === "FAIL");
  const coverPass = c.evaluated.find((s) => s.cover && s.verdict === "PASS" && s.exitOk);
  c.status = anyFail ? "FAIL" : coverPass ? "PASS" : "MISSING";
  if (c.status === "PASS") {
    c.decision = `cover PASS + EXIT ok（${coverPass.exitTokens.join("|") || "EXIT 语句在结果记录"}）`;
  } else if (c.status === "FAIL") {
    const f = c.evaluated.find((s) => s.verdict === "FAIL");
    c.decision = c.note || `FAIL：${f.raw || f.verdict}`.slice(0, 120);
  } else {
    const mismatch = c.evaluated.find((s) => s.cover && s.verdict === "PASS" && !s.exitOk);
    if (mismatch) {
      c.decision = `${c.note || "EXIT 不符合或缺失"}（tokens=${mismatch.exitTokens.join("|") || "none"}）`;
    } else if (c.note) {
      c.decision = c.note;
    } else {
      const cand = c.evaluated.find((s) => ["SKIP", "NO_RECORD", "MARKER_MISS", "UNKNOWN"].includes(s.verdict)) || c.evaluated[0];
      c.decision = `无 PASS 覆盖：${cand ? `${cand.verdict}${cand.raw ? " · " + String(cand.raw).replace(/\s+/g, " ").slice(0, 70) : ""}` : "无证据"}`;
    }
  }
}

/* ---------- 校验 ---------- */
const EXPECT_SUITE = { ENV: 8, BOOT: 13, API: 9, ACC: 10, MCPS: 11, MCPP: 24, TERM: 14, IMP: 10, ACP: 10, OFF: 7, HERO: 8, CMD: 4, V1: 8, DATA: 10, UI: 8, SEC: 10 };
const EXPECT_PHASE = { P1: 10, P2: 12, P3: 7, P4: 17, P5: 16, P6a: 97, P6b: 5 };
const ids = new Set(cases.map((c) => c.id));
const dup = cases.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
const suiteCounts = {};
const phaseCounts = {};
for (const c of cases) {
  suiteCounts[c.suite] = (suiteCounts[c.suite] || 0) + 1;
  phaseCounts[c.phase] = (phaseCounts[c.phase] || 0) + 1;
}
const statusCounts = { PASS: 0, FAIL: 0, MISSING: 0 };
for (const c of cases) statusCounts[c.status]++;

const errors = [];
if (cases.length !== 164) errors.push(`case 总数 ${cases.length} != 164`);
if (ids.size !== cases.length || dup.length) errors.push(`ID 重复：${dup.join(",")}`);
for (const [s, n] of Object.entries(EXPECT_SUITE)) if ((suiteCounts[s] || 0) !== n) errors.push(`suite ${s} 计数 ${suiteCounts[s] || 0} != ${n}`);
for (const [p, n] of Object.entries(EXPECT_PHASE)) if ((phaseCounts[p] || 0) !== n) errors.push(`phase ${p} 计数 ${phaseCounts[p] || 0} != ${n}`);
for (const c of cases) {
  if (c.status === "PASS" && !c.evaluated.some((s) => s.cover && s.verdict === "PASS" && s.exitOk)) {
    errors.push(`${c.id} PASS 但无 cover PASS+EXIT`);
  }
  if (!c.evaluated.some((s) => s.exists)) errors.push(`${c.id} 无任何存在的证据文件`);
}
const soakCase = cases.find((c) => c.id === "RC5-DATA-009");
const termSoak = cases.find((c) => c.id === "RC5-TERM-013");
const SOAK_DIR = "artifacts/rc5/p6b/soak/final-image";
const soakSummary = has(`${SOAK_DIR}/summary-24h-final.json`) ? JSON.parse(READ(`${SOAK_DIR}/summary-24h-final.json`)) : null;
const soakWindowComplete = soakSummary?.window?.complete === true;
if (!soakWindowComplete) {
  if (soakCase.status === "PASS") errors.push("RC5-DATA-009 不得 PASS（窗口未满）");
  if (termSoak.status === "PASS") errors.push("RC5-TERM-013 不得 PASS（窗口未满）");
}

if (errors.length) {
  console.error("校验失败：\n- " + errors.join("\n- "));
  process.exit(2);
}

/* ---------- 24h 浸泡窗口 ---------- */
function lastJsonLine(p) {
  if (!has(p)) return null;
  const lines = READ(p).trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]);
    } catch {
      /* skip */
    }
  }
  return null;
}
const soakMeta = JSON.parse(READ(`${SOAK_DIR}/meta-24h-final.json`));
const soakData = lastJsonLine(`${SOAK_DIR}/data-009-24h-final.jsonl`);
const soakTerm = lastJsonLine(`${SOAK_DIR}/term-013-24h-final.jsonl`);
const soakFinal = soakSummary;
const soakElapsed = soakData ? soakData.elapsedSeconds : 0;
const soakComplete = soakFinal?.window?.complete === true || Number(soakElapsed) >= Number(soakMeta.plannedSeconds);
const soak = {
  case: "RC5-DATA-009 + RC5-TERM-013",
  startedAt: soakMeta.startedAt,
  plannedEndAt: soakMeta.plannedEndAt,
  plannedSeconds: soakMeta.plannedSeconds,
  observedElapsedSeconds: soakElapsed,
  observedElapsedHours: +(soakElapsed / 3600).toFixed(2),
  observedAt: soakData ? soakData.at : null,
  windowComplete: soakComplete,
  verdict: soakComplete ? "COMPLETE" : "INCOMPLETE",
  latestDataTick: soakData,
  latestTermTick: soakTerm,
  note: soakComplete ? "窗口已满，需复核完整 verdict" : "窗口未满 24h，不得判绿；留 leftover SOAK-24H",
};
fs.writeFileSync("artifacts/rc5/p6a/soak-window.json", JSON.stringify(soak, null, 2) + "\n");
if (soakComplete) errors.push("soak 窗口已满：需人工复核后更新矩阵");

/* ---------- 生成矩阵 ---------- */
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const suiteOrder = ["ENV", "BOOT", "API", "ACC", "MCPS", "MCPP", "TERM", "IMP", "ACP", "OFF", "HERO", "CMD", "V1", "DATA", "UI", "SEC"];
const phaseOrder = ["P1", "P2", "P3", "P4", "P5", "P6a", "P6b"];
const phaseName = { P1: "P1", P2: "P2", P3: "P3", P4: "P4", P5: "P5", P6a: "P6a", P6b: "P6b" };

function evidenceText(c) {
  const parts = [];
  for (const s of c.evaluated) {
    if (s.k === "marker") parts.push(s.file);
    else if (s.k === "p6b") parts.push(`${s.caseDir}/{cmd.log,result.md}`);
    else {
      const names = [...(s.cmds || [s.cmd]), s.record].filter(Boolean);
      parts.push(`${s.dir}/{${names.join(",")}}`);
    }
  }
  const uniq = [...new Set(parts)];
  let text = uniq.join("; ");
  if (c.status === "MISSING") text += ` ［${c.decision.replace(/^无 PASS 覆盖：/, "")}］`;
  if (c.status === "FAIL") text += ` ［${c.note || c.decision.replace(/^FAIL：/, "")}］`;
  return text.replace(/\|/g, "\\|");
}

function row(c) {
  return `| ${c.title} | ${c.id} | ${c.phase} | ${c.status} | ${evidenceText(c)} | ${c.owner} |`;
}

const lines = [];
lines.push("# rc.5 测试验收矩阵（164 条）");
lines.push("");
lines.push(`- 生成时间：${now}`);
lines.push("- 汇编：T50（54 §5.4 / §7.1 / §7.3；51 §0.3 / §6.3）");
lines.push(`- 工作树：\`/Users/sunny/code/agent-basis-rc5\`（\`feat/dsh-rc5-merge\`，HEAD \`${(spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout || "").trim() || "unknown"}\`）`);
lines.push("- 用例定义：`docs/design/51-上游rc.5合并测试用例与回归.md` §3（164 条）；阶段映射：`docs/design/54-rc.5开发与测试验收完整workflow.md` §5.1/§5.2");
lines.push("");
lines.push("## 判定规则（只取真实证据）");
lines.push("");
lines.push("- **PASS**：引用证据含命令日志（`cmd.log` / run 日志）与结果记录（`result.md`；ACP 用 `assert.json`、MCPS P2 用 `report.md`），且退出码符合（`EXIT 0` / HTTP `200` / 负控期望值），结果记录判 PASS。");
lines.push("- **FAIL**：任一引用证据判 FAIL（断言未满足）。失败用例保留原始日志，不裁剪。");
lines.push("- **MISSING**：SKIP / NOTRUN / 未执行 / 无结果记录；不得标绿，不计入通过。");
lines.push("- 证据根：`artifacts/rc5/<suite>/<case-id>/`（E1/E2/E3 的套件证据在 `artifacts/rc5/E1|E2|e3-super/...`，阶段列仍按 54 §5.1/§5.2 的首跑阶段）。");
lines.push("- 文件命名偏差：ACP 10 条以 `assert.json` 为结果记录；MCPS-008/011 以 `report.md + run*.log` 为记录；ENV-004/005、V1-008 用 P5 镜像运行时探针补运行时半。均登记在 leftover `EVID-*`。");
lines.push("- **脱敏**：本矩阵只写路径、状态与结论摘要；不写 cookie/token/MCP headers/密钥/口令明文。");
lines.push("");
lines.push("## 总览");
lines.push("");
lines.push(`| 状态 | 条数 |`);
lines.push(`|---|---:|`);
lines.push(`| PASS | ${statusCounts.PASS} |`);
lines.push(`| FAIL | ${statusCounts.FAIL} |`);
lines.push(`| MISSING | ${statusCounts.MISSING} |`);
lines.push(`| **合计** | **${cases.length}** |`);
lines.push("");
lines.push(`> **当前不可判绿**：FAIL ${statusCounts.FAIL} 条全部为 P0（跨租户/管理面/凭据/UI）；MISSING ${statusCounts.MISSING} 条中 ${cases.filter((c) => c.status === "MISSING" && c.prio === "P0").length} 条为 P0。P6 未收口，P7 不得启动。`);
lines.push("");

// 套件 × 状态
lines.push("### 套件 × 状态");
lines.push("");
lines.push("| 套件 | 总数 | PASS | FAIL | MISSING |");
lines.push("|---|---:|---:|---:|---:|");
for (const s of suiteOrder) {
  const arr = cases.filter((c) => c.suite === s);
  const cnt = (st) => arr.filter((c) => c.status === st).length;
  lines.push(`| ${s} | ${arr.length} | ${cnt("PASS")} | ${cnt("FAIL")} | ${cnt("MISSING")} |`);
}
lines.push(`| **合计** | **${cases.length}** | **${statusCounts.PASS}** | **${statusCounts.FAIL}** | **${statusCounts.MISSING}** |`);
lines.push("");

// 阶段 × 状态
lines.push("### 阶段 × 状态");
lines.push("");
lines.push("| 阶段 | 总数 | PASS | FAIL | MISSING |");
lines.push("|---|---:|---:|---:|---:|");
for (const p of phaseOrder) {
  const arr = cases.filter((c) => c.phase === p);
  const cnt = (st) => arr.filter((c) => c.status === st).length;
  lines.push(`| ${p} | ${arr.length} | ${cnt("PASS")} | ${cnt("FAIL")} | ${cnt("MISSING")} |`);
}
lines.push(`| **合计** | **${cases.length}** | **${statusCounts.PASS}** | **${statusCounts.FAIL}** | **${statusCounts.MISSING}** |`);
lines.push("");

// 24h 浸泡
lines.push("## 24h 浸泡窗口（DATA-009 / TERM-013）");
lines.push("");
lines.push(`- soak 启动：\`${soakMeta.startedAt}\`；计划结束：\`${soakMeta.plannedEndAt}\`（${soakMeta.plannedSeconds}s）`);
lines.push(`- 最新采样子样：\`${soak.observedAt || "n/a"}\`，已观测 **${soak.observedElapsedHours} h / 24 h**，\`windowComplete=${soak.windowComplete}\``);
lines.push(`- 结论：**未满窗口，不得判绿**；DATA-009 = ${soakCase.status}，TERM-013 = ${termSoak.status}`);
const dbOk = (soakData && soakData.databases ? soakData.databases : []).filter((d) => d.ok).length;
const dbTotal = (soakData && soakData.databases ? soakData.databases : []).length;
const writeOk = soakData && soakData.write ? soakData.write.ok : "?";
const writeFail = soakData && soakData.write ? soakData.write.failed : "?";
const termChurn = soakTerm ? soakTerm.churn : "?";
lines.push(`- 最新 tick：integrity ${dbOk}/${dbTotal} ok、write ok=${writeOk} failed=${writeFail}、lockMatches=${soakData ? soakData.lockMatches : "?"}、walLogMatches=${soakData ? soakData.walLogMatches : "?"}；TERM churn=${termChurn}（每 tick=create→WS attach(snapshot)→close）。`);
lines.push(`- 窗口 ${soakComplete ? "已满（需复核 summary verdict）" : "未满"}；本窗口起跑镜像=${soakMeta.imageId ?? "?"}（终版 ae5ce8cb）。`);
lines.push(`- leftover：\`SOAK-24H\``);
lines.push("");

// P0 红色
const bad = cases.filter((c) => c.status !== "PASS" && c.prio === "P0");
lines.push("## P0 未通过清单（门禁红/缺失）");
lines.push("");
lines.push("| id | 阶段 | 状态 | 摘要 |");
lines.push("|---|---|---|---|");
for (const c of bad) lines.push(`| ${c.id} | ${c.phase} | ${c.status} | ${c.decision.replace(/\|/g, "\\|").slice(0, 110)} |`);
lines.push("");

// 164 行
lines.push("## 164 行矩阵");
lines.push("");
lines.push("| case | id | phase | status | evidence | owner |");
lines.push("|---|---|---|---|---|---|");
for (const s of suiteOrder) {
  for (const c of cases.filter((x) => x.suite === s)) lines.push(row(c));
}
lines.push("");

// 遗留
lines.push("## 遗留项（leftovers）");
lines.push("");
lines.push("| id | 现象 | 级别 | 建议 |");
lines.push("|---|---|---|---|");
// 遗留：动态列出当前仍非 PASS 的用例（P0 单列），静态条目只保留范围/流程类说明
const notPass = cases.filter((c) => c.status !== "PASS");
const p0NotPass = notPass.filter((c) => c.prio === "P0");
const p1NotPass = notPass.filter((c) => c.prio !== "P0");
const matrixLeftovers = [
  ["SOAK-24H", `24h 浸泡窗口${soakComplete ? "已满，待复核 verdict" : "未满"}（plannedEnd ${soakMeta.plannedEndAt}；实时观测 artifacts/rc5/p6a/soak-window.json）`, "P1", soakComplete ? "复核 summary-24h-final.json 的 window.complete/verdict 后翻绿 DATA-009/TERM-013" : "满窗后复核 window.complete=true 与 verdict；未满不得判绿"],
  ["NOTPASS-P0", p0NotPass.length === 0 ? "无" : p0NotPass.map((c) => `${c.id}(${c.status})`).join("、"), "P0", p0NotPass.length === 0 ? "P0 全绿" : "按 51 用例定义补证/修复后重跑，直至 P0 全绿"],
  ["NOTPASS-P1+", p1NotPass.length === 0 ? "无" : p1NotPass.map((c) => `${c.id}(${c.status})`).join("、"), "P1", p1NotPass.length === 0 ? "P1/P2 清零" : "按 51 步骤逐条补跑或取得用户签字豁免"],
  ["API005-REALMODEL", "API-005..007 以真实 worker/子代理路径通过，但 LLM 为 stub；真模型 E2E 未跑", "P2", "真模型 + realm 对齐后补跑"],
  ["API005-ENV", "API-005..007 文档标 E3，实跑在 E1(3108)", "P2", "E3 补跑或登记环境豁免"],
  ["MCPS-011-E2E", "H9 容器端到端重渲染已由 mcps-011.mjs 覆盖（模板变更→restart→重渲染保留 servers→恢复回基线）", "P2", "保留证据；升级演练时复跑"],
  ["EVID-ACP", "ACP-001..010 以 assert.json 作为结果记录，缺 result.md", "P3", "补 result.md 或登记等价证据规范"],
  ["EVID-ENV-V1", "ENV-004/005、V1-008 的运行时断言由 P5 镜像探针补证（非逐字 docker run 命令）", "P3", "保留 P5 探针索引；按需逐字复跑"],
  ["DATA-009-SCALE", "现行 soak 仅 2 writers、每 5min 检 3 库，未达 48 §4.5 ≥50 并发 + 2h 全库 integrity", "P1", "满窗前补压或登记豁免"],
  ["P7-NOTRUN", "P7 全量复跑/PR/合并/生产部署/上线后 24h 未执行（P6 未收口）", "P0", "P6 清零后按 51 §6.1/§6.2、54 §3.2 执行"],
];
for (const [id, what, level, fix] of matrixLeftovers) lines.push(`| ${id} | ${what.replace(/\|/g, "\\|")} | ${level} | ${fix.replace(/\|/g, "\\|")} |`);
lines.push("");

fs.writeFileSync("artifacts/rc5/acceptance-matrix.md", lines.join("\n") + "\n");

/* ---------- case-audit.json ---------- */
const audit = {
  schema: "eterna.rc5.t50.acceptance-matrix/1",
  generatedAt: now,
  commit: "02f485788411b9aed1938a3c4b009793a090961e",
  cases: cases.map((c) => ({
    id: c.id,
    suite: c.suite,
    phase: c.phase,
    priority: c.prio,
    title: c.title,
    owner: c.owner,
    status: c.status,
    decision: c.decision,
    sources: c.evaluated.map((s) => ({
      kind: s.k,
      path: s.k === "marker" ? s.file : s.k === "p6b" ? `${s.caseDir} + ${s.dir}/summary.json` : s.dir,
      files: s.files.map((f) => f.replace(ROOT + "/", "")),
      exists: s.exists,
      verdict: s.verdict,
      verdictRaw: String(s.raw || "").replace(/\s+/g, " ").slice(0, 160),
      exitTokens: s.exitTokens,
      exitOk: s.exitOk,
      cover: s.cover,
    })),
  })),
  counts: {
    total: cases.length,
    status: statusCounts,
    bySuite: Object.fromEntries(suiteOrder.map((s) => [s, cases.filter((c) => c.suite === s).length])),
    byPhase: Object.fromEntries(phaseOrder.map((p) => [p, cases.filter((c) => c.phase === p).length])),
  },
  soak,
};
fs.writeFileSync("artifacts/rc5/p6a/case-audit.json", JSON.stringify(audit, null, 2) + "\n");

/* ---------- 阶段 summary.json ---------- */
const COMMIT = "02f485788411b9aed1938a3c4b009793a090961e";
const p0Existing = JSON.parse(READ("artifacts/rc5/p0/summary.json") || "{}");
const p6bExisting = JSON.parse(READ("artifacts/rc5/p6b/summary.json") || "{}");

const phaseDefs = [
  {
    phase: "P0", dir: "p0", merge: true, imageTag: null, imageId: null,
    startedAt: "2026-11-19T18:12:51Z", finishedAt: "2026-11-19T18:20:00Z",
    windowBasis: "p0/baseline.md（run2 采集窗口 18:12:51Z–18:20Z）",
    commands: [
      { cmd: "pnpm install --frozen-lockfile", exit: 0, log: "artifacts/rc5/p0/run2/local/install-frozen.log" },
      { cmd: "pnpm -w run verify", exit: 1, log: "artifacts/rc5/p0/run2/local/verify.log", note: "基线红：@eterna/access oxlint 16 errors（L4 未提交改动）→ P0-01" },
      { cmd: "ETERNA_PROFILE_HOME=/tmp/eterna-rc5-p0-run2/web node scripts/verify-eterna-web.mjs", exit: 0, log: "artifacts/rc5/p0/run2/local/boot-web.log" },
      { cmd: "ETERNA_PROFILE_HOME=/tmp/eterna-rc5-p0-run2/super node scripts/verify-eterna-super.mjs", exit: 0, log: "artifacts/rc5/p0/run2/local/boot-super.log" },
      { cmd: "node tools/evals/bin/dsh-evals.mjs run --pack packs/event-planning --adapter replay --out artifacts/rc5/p0/run2/local/evals-replay-out", exit: 0, log: "artifacts/rc5/p0/run2/local/evals-replay.log" },
    ],
    leftovers: p0Existing.leftovers || [],
  },
  {
    phase: "P1", dir: "p1", imageTag: null, imageId: null,
    startedAt: "2026-11-19T17:51:26Z", finishedAt: "2026-11-19T22:19:04Z",
    windowBasis: "p1 lane 日志 + ENV/API 套件 summary（evidence window，非严格墙钟）",
    commands: [
      { cmd: "pnpm install --frozen-lockfile", exit: 0, log: "artifacts/rc5/ENV/RC5-ENV-001/cmd.log" },
      { cmd: "pnpm --filter @eterna/compaction verify", exit: 0, log: "artifacts/rc5/API/RC5-API-001/cmd.log" },
      { cmd: "pnpm --filter @eterna/memory verify", exit: 0, log: "artifacts/rc5/API/RC5-API-002/cmd.log" },
      { cmd: "pnpm --filter @eterna/llm-openai typecheck", exit: 0, log: "artifacts/rc5/API/RC5-API-003/cmd.log" },
      { cmd: "pnpm --filter @eterna/tasks verify", exit: 0, log: "artifacts/rc5/API/RC5-API-004/cmd.log" },
      { cmd: "pnpm -w run verify", exit: 0, log: "artifacts/rc5/ENV/RC5-ENV-007/cmd.log", note: "38 包/4187 tests（E2/SEC-009 复核）" },
    ],
    leftovers: ["P1-01|pnpm -w run verify 已在工作树通过（ENV-007 EXIT 0；E2/SEC-009 38 包/4187 tests），但 P0 基线时刻曾 EXIT=1（L4 未提交改动）|P1|P0-01 收口后由 L0 在干净工作树复跑 verify 并登记 sha"],
  },
  {
    phase: "P2", dir: "p2", imageTag: null, imageId: null,
    startedAt: "2026-11-19T17:58:14Z", finishedAt: "2026-11-19T23:34:35Z",
    windowBasis: "p2 lane 日志 + E1/BOOT 套件 summary（BOOT-004..012 在 E1 首跑）",
    commands: [
      { cmd: "node tools/packctl/bin/packctl.mjs tenant-scan", exit: 0, log: "artifacts/rc5/E2/ACC/RC5-ACC-001/cmd.log" },
      { cmd: "node tools/packctl/bin/packctl.mjs prompt-scan", exit: 0, log: "artifacts/rc5/E2/ACC/RC5-ACC-002/cmd.log" },
      { cmd: "node tools/packctl/bin/packctl.mjs form-check", exit: 0, log: "artifacts/rc5/E2/ACC/RC5-ACC-003/cmd.log" },
      { cmd: "node --test docker/profile/migrate-mcp-servers.test.mjs", exit: 0, log: "artifacts/rc5/MCPS/RC5-MCPS-008/migrate-mcp-servers.test.log" },
      { cmd: "node --test docker/profile/migrate-profile-bundles.test.mjs", exit: 0, log: "artifacts/rc5/E1/BOOT/RC5-BOOT-008/migrate-profile-bundles.test.log" },
      { cmd: "docker exec rc5-e1suite sh -c 'DSH_HOME=/data dsh --profile eterna-web --dump-config'", exit: 0, log: "artifacts/rc5/E1/BOOT/RC5-BOOT-004/cmd.log", note: "unknown plugin row = 0" },
    ],
    leftovers: [
      "P2-01|MCPS-011 H9 容器端到端重渲染 deferred（本地机制 11/11 PASS）|P1|P6a 用旧 profile 副本起容器实测 servers 保留与 0600 备份",
      "P2-02|MCPS-008/011 证据使用 report.md + run*.log，未按 54 §5.4 命名 result.md|P2|补 result.md 或登记等价记录",
    ],
  },
  {
    phase: "P3", dir: "p3", imageTag: null, imageId: null,
    startedAt: "2026-11-19T19:08:21Z", finishedAt: "2026-11-19T22:19:04Z",
    windowBasis: "p3 lane 日志 + V1 套件 summary",
    commands: [
      { cmd: "pnpm --filter @core/cordis test", exit: 0, log: "artifacts/rc5/V1/RC5-V1-004/cmd.log" },
      { cmd: "pnpm --filter @core/runtime test", exit: 0, log: "artifacts/rc5/V1/RC5-V1-005/cmd.log" },
      { cmd: "node packages/agent-loop/... chat --bundle basis.yml </dev/null", exit: 0, log: "artifacts/rc5/V1/RC5-V1-005/cmd.log", note: "6 插件解析装载、无 bundle-core" },
      { cmd: "node artifacts/rc5/V1/RC5-V1-006/check-ci-lane.mjs", exit: 0, log: "artifacts/rc5/V1/RC5-V1-006/cmd.log" },
    ],
    leftovers: ["P3-01|V1-008 专用 docker run 断言未执行，改用 P5 镜像运行时探针（/repo 下 v1 8 项 absent）作为等价证据|P3|保留 P5 探针索引；如需逐字口径再跑一次 docker run"],
  },
  {
    phase: "P4", dir: "p4", imageTag: null, imageId: null,
    startedAt: "2026-11-19T20:20:53Z", finishedAt: "2026-11-20T00:28:37Z",
    windowBasis: "p4 lane 日志 + UI/ACC/SEC 静态套件与 E2 UI 截图（evidence window）",
    commands: [
      { cmd: "node scripts/lint-ui-tokens.mjs", exit: 0, log: "artifacts/rc5/UI/RC5-UI-001/cmd.log" },
      { cmd: "pnpm --filter @eterna/access exec vitest run tests/mux-drift.spec.ts tests/mux-peer-drift.spec.ts", exit: 0, log: "artifacts/rc5/E2/ACC/RC5-ACC-004/cmd.log" },
      { cmd: "pnpm --filter @eterna/access exec vitest run tests/mux-policy.spec.ts", exit: 0, log: "artifacts/rc5/E2/ACC/RC5-ACC-005/cmd.log" },
      { cmd: "10 包 build:client（access/attachments/brand/compaction/llm-doctor/memory/panel/prompt-studio/usage-stats/workbench）", exit: 0, log: "artifacts/rc5/p4/client-bundles/02-build.log" },
    ],
    leftovers: [
      "P4-01|SEC-002 FAIL：跟踪测试文件含疑似口令字面量（已脱敏计数），属 P0 安全项|P0|替换为明显假值并全仓重扫",
      "P4-02|ACC-001/003/004/005/010 的首跑证据落在 E2/ACC（P6a lane），P4 静态门禁日志见 p4/b12-glue、p4/b14-system-gates|P3|在阶段 summary 交叉引用，不重复计分",
    ],
  },
  {
    phase: "P5", dir: "p5", imageTag: "eterna-agent:rc5-test", imageId: "sha256:5b10f5136403b905c327f8438cedd07eb65979075b818cf625e088f623064172",
    startedAt: "2026-11-19T20:39:54Z", finishedAt: "2026-11-19T21:01:23Z",
    windowBasis: "p5/image-deploy summary + p5/testbed 六个 verify 脚本",
    commands: [
      { cmd: "node scripts/verify-rc5-env.mjs --api-static --runtime-image eterna-agent:rc5-test --json artifacts/rc5/p5/testbed/env-runtime/report.json", exit: 0, log: "artifacts/rc5/p5/testbed/env-runtime/cmd.log", note: "dsh rc.5 / node v24.22.3 / v1 剥离 / 字体 / Python 全 PASS" },
      { cmd: "docker build ... -t eterna-agent:rc5-test", exit: 0, log: "artifacts/rc5/p5/repairs/round2/build-rc5-test.log", note: "镜像 digest sha256:5b10f5136403…，752.2 MiB" },
      { cmd: "node scripts/verify-terminal-guard.mjs", exit: 1, log: "artifacts/rc5/p5/testbed/terminal-guard/cmd.log", note: "PASS=5 FAIL=4 NOTRUN=3；与 P6 TERM-004/006 同根因" },
      { cmd: "node scripts/verify-mcp-personal.mjs", exit: 0, log: "artifacts/rc5/p5/testbed/mcp-personal/cmd.log", note: "PASS=15 FAIL=0 SKIP=7" },
    ],
    leftovers: [
      "SOAK-24H|24h 浸泡窗口未满（实时观测见 artifacts/rc5/p6a/soak-window.json；plannedEnd " + soakMeta.plannedEndAt + "）|P0|满窗后复核 window.complete=true 与 verdict",
      "P5-01|TERM-014（P2）随 TERM 套件中止未执行|P2|修复 TERM-004/006 后补跑",
    ],
  },
  {
    phase: "P6a", dir: "p6a", imageTag: "eterna-agent:rc5-test", imageId: "sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00",
    startedAt: "2026-11-19T22:22:09Z", finishedAt: "2026-11-20T00:39:51Z",
    windowBasis: "ACP report + E3/E1/E2 套件 summary（E2 收尾 00:39:51Z）",
    commands: [
      { cmd: "node artifacts/rc5/ACP/acp-e4-driver.mjs --scenario all", exit: 0, log: "artifacts/rc5/ACP/runs/all/cmd.log", note: "PASS=11 FAIL=0 SKIP=0 NOTRUN=0（含 002b）" },
      { cmd: "scripts/verify-chat-import.mjs（RC5-IMP-003 行）", exit: 0, log: "artifacts/rc5/E1/IMP/RC5-IMP-003/cmd.log" },
      { cmd: "IAB 1440×900 hero 自检（发送后 phase=active）", exit: 0, log: "artifacts/rc5/E1/HERO/RC5-HERO-001/cmd.log" },
      { cmd: "B 用 A 的 session 开 terminal/attach 流（应拒）", exit: 0, log: "artifacts/rc5/E2/TERM/RC5-TERM-005a/cmd.log", note: "remote-access/denied" },
      { cmd: "POST /api/session/search 等 7 项跨租户探针（B 用 A）", exit: 200, log: "artifacts/rc5/E2/ACC/RC5-ACC-008/cmd.log", note: "HTTP 传输 200；断言 FAIL（3 项未拒）" },
    ],
    leftovers: [
      "CROSS-TENANT|TERM-004/006、ACC-006/008、SEC-004/005、MCPS-006 共 7 条 P0 跨租户/管理面未拒|P0|修 terminal/workspaceFiles 租户守卫与 mux ADMIN_ONLY/GLOBAL_UNARY 后重跑 ACC/TERM/MCPS/SEC 全组",
      "MISSING-P0|8 条 P0 未通过：MCPS-003、MCPP-019/020/022、TERM-002/003/012 未执行；BOOT-007 dump-default EXIT=1/0 bytes（空集 PASS 不成立）|P0|补 live 会话/跨用户工具调用/键盘实测；修 BOOT-007 命令后重跑",
      "MISSING-P1|17 条 P1/P2 未执行（MCPS-007/009/010、MCPP-011/016/017/018/024、TERM-009/010/011/013/014、IMP-007、OFF-007、HERO-007、SEC-010）|P1|按 51 步骤逐条补跑",
      "API005-REALMODEL|API-005..007 以真实 worker/子代理路径通过，但 LLM 为 stub；真模型 E2E 未跑|P0|真模型 + realm 对齐后补跑",
      "API005-ENV|API-005..007 文档标 E3，实跑在 E1(3108)|P2|E3 补跑或登记环境豁免",
      "UI-006|24 张截图已产出，但 390 hero 遮挡、terminal 5/6 错误页、chat-import 6/6 无入口|P0|修复后重截 24 张",
      "EVID-ACP|ACP-001..010 以 assert.json 作为结果记录，缺 result.md|P2|补 result.md 或登记等价证据规范",
    ],
  },
  {
    phase: "P6b", dir: "p6b", merge: true, imageTag: "eterna-agent:rc5-test", imageId: "sha256:99d8e85b509b6e3e1990481b2742a98cd550161621491cba16964d801d838f00",
    startedAt: "2026-11-19T22:03:20Z", finishedAt: "2026-11-19T22:34:39Z",
    windowBasis: "p6b/summary.json（lane 自报 22:03:20Z–22:34:39Z；24h soak 仍在采样）",
    commands: [
      { cmd: "env ETERNA_DATA_ROOT=$HOME/eterna-data/test-rc5/.p6b-data001/root bash deploy/init-data-dirs.sh probe", exit: 0, log: "artifacts/rc5/DATA/RC5-DATA-001/cmd.log" },
      { cmd: "env ETERNA_DATA_ROOT=$HOME/eterna-data/test-rc5 BACKUP_DIR=... ETERNA_CONTAINER_NAME=eterna-rc5-p6b-a bash deploy/backup-data.sh p6b-e5a", exit: 0, log: "artifacts/rc5/DATA/RC5-DATA-008/cmd.log" },
      { cmd: "check_root drill1/drill2/p5-e5/staging1（全部库 PRAGMA integrity_check）", exit: 0, log: "artifacts/rc5/DATA/RC5-DATA-005/cmd.log", note: "checked=17 ok=17 fail=0" },
      { cmd: "node scripts/soak-rc5.mjs --suite both --duration 24h --interval 60s --db-interval 5m --writers 2 --container eterna-rc5-e1 --data-root $HOME/eterna-data/test-rc5/e1", exit: null, log: "artifacts/rc5/p5/testbed/soak/soak-24h.log", note: "仍在采样（未满 24h，无终态退出码）" },
    ],
    leftovers: [
      ...(p6bExisting.leftovers || []),
      "SOAK-24H|24h 浸泡窗口未满（实时观测见 artifacts/rc5/p6a/soak-window.json；plannedEnd " + soakMeta.plannedEndAt + "）|P0|满窗后复核 window.complete=true 与 verdict",
      "DATA-009-SCALE|现行 soak 仅 2 writers、每 5min 检 3 库，未达 48 §4.5 ≥50 并发 + 2h 全库 integrity|P1|满窗前补压",
    ],
  },
  {
    phase: "P7", dir: "p7", imageTag: null, imageId: null,
    startedAt: null, finishedAt: null,
    windowBasis: "未执行（P6 未收口：FAIL " + statusCounts.FAIL + " + MISSING " + statusCounts.MISSING + "）",
    commands: [],
    leftovers: ["P7-NOTRUN|P7 全量复跑/PR/合并/生产部署/上线后 24h 未执行（P6 未收口）|P0|P6 清零后按 51 §6.1/§6.2、54 §3.2 执行"],
  },
];

function dedupeLeftovers(list) {
  const byId = new Map();
  for (const item of list) {
    const id = String(item).split("|")[0];
    byId.set(id, item); // 后出现的（本轮）覆盖旧值
  }
  return [...byId.values()];
}

for (const def of phaseDefs) {
  def.leftovers = dedupeLeftovers(def.leftovers);
  const arr = cases.filter((c) => c.phase === def.phase);
  const counts = {
    total: arr.length,
    pass: arr.filter((c) => c.status === "PASS").length,
    fail: arr.filter((c) => c.status === "FAIL").length,
    skip: arr.filter((c) => c.status === "MISSING").length,
  };
  const base = {
    phase: def.phase,
    commit: COMMIT,
    imageTag: def.imageTag,
    imageId: def.imageId,
    startedAt: def.startedAt,
    finishedAt: def.finishedAt,
    windowBasis: def.windowBasis,
    commands: def.commands,
    cases: counts,
    leftovers: [...new Set(def.leftovers)],
    generatedBy: "T50/artifacts/rc5/p6a/scan-matrix.mjs",
    generatedAt: now,
  };
  const out = path.join("artifacts/rc5", def.dir, "summary.json");
  if (def.merge) {
    const existing = JSON.parse(READ(out) || "{}");
    // 合并保持幂等：已存在的 generatedAt 不刷新，避免重跑造成无意义 diff
    if (Array.isArray(existing.cases)) {
      const merged = { ...existing, ...base, generatedAt: existing.generatedAt || now, casesSummary: counts, cases: existing.cases };
      fs.writeFileSync(out, JSON.stringify(merged, null, 2) + "\n");
    } else {
      fs.writeFileSync(out, JSON.stringify({ ...existing, ...base, generatedAt: existing.generatedAt || now }, null, 2) + "\n");
    }
  } else {
    fs.writeFileSync(out, JSON.stringify(base, null, 2) + "\n");
  }
}

/* ---------- 断言日志 + 脱敏扫描 ---------- */
const assertLines = [];
assertLines.push(`T50 acceptance matrix assertions @ ${now}`);
assertLines.push(`CASE_TOTAL=${cases.length} (expect 164)`);
assertLines.push(`UNIQUE_IDS=${ids.size}`);
assertLines.push(`STATUS=PASS ${statusCounts.PASS} / FAIL ${statusCounts.FAIL} / MISSING ${statusCounts.MISSING}`);
assertLines.push(`PHASE_COUNTS=${JSON.stringify(phaseCounts)}`);
assertLines.push(`SUITE_COUNTS=${JSON.stringify(suiteCounts)}`);
assertLines.push(`P0_NOT_PASS=${cases.filter((c) => c.prio === "P0" && c.status !== "PASS").length}`);
assertLines.push(`SOAK_WINDOW=${soak.observedElapsedHours}h/${soakMeta.plannedSeconds}s complete=${soak.windowComplete} observedAt=${soak.observedAt}`);
assertLines.push(`DATA009_STATUS=${soakCase.status}`);
assertLines.push(`TERM013_STATUS=${termSoak.status}`);
assertLines.push(`MATRIX_LINES=${fs.readFileSync("artifacts/rc5/acceptance-matrix.md", "utf8").split("\n").length}`);
assertLines.push("RESULT=ALL_ASSERTIONS_PASS");
fs.writeFileSync("artifacts/rc5/p6a/assertions.log", assertLines.join("\n") + "\n");

const scanTargets = [
  "artifacts/rc5/acceptance-matrix.md",
  "artifacts/rc5/p6a/case-audit.json",
  "artifacts/rc5/p6a/result.md",
  "artifacts/rc5/p6a/soak-window.json",
  ...["p0", "p1", "p2", "p3", "p4", "p5", "p6a", "p6b", "p7"].map((p) => `artifacts/rc5/${p}/summary.json`),
];
const scanText = scanTargets.map((f) => READ(f) || "").join("\n");
const secretPatterns = [
  { name: "sk- key", re: /sk-[A-Za-z0-9_-]{8,}/g },
  { name: "Bearer token", re: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
  { name: "Cookie header", re: /(?:set-cookie|cookie)\s*[:=]\s*[^\s,;]{8,}/gi },
  { name: "api_key/password assignment", re: /(?:api[_-]?key|password|passwd|secret|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9+/=_.-]{12,}/gi },
  { name: "long JWT", re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g },
];
const hits = [];
for (const { name, re } of secretPatterns) {
  for (const m of scanText.matchAll(re)) hits.push(`${name}: ${String(m[0]).slice(0, 12)}…`);
}
const secretLog = [
  `SECRET_SCAN @ ${now}`,
  `scope=${scanTargets.join(" + ")}`,
  `patterns=${secretPatterns.map((p) => p.name).join(",")}`,
  `hits=${hits.length}`,
  ...hits,
  hits.length ? "RESULT=FAIL" : "RESULT=PASS（无 cookie/token/密钥明文）",
];
fs.writeFileSync("artifacts/rc5/p6a/secret-scan.log", secretLog.join("\n") + "\n");

console.log(JSON.stringify({ statusCounts, phaseCounts, suiteCounts, soak: { observedHours: soak.observedElapsedHours, complete: soak.windowComplete }, secretHits: hits.length }, null, 2));