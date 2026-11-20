// T50 汇编产物自检：只读 artifacts/rc5/**，不改任何文件。
// 输出 MATRIX_*/SUMMARY_*/SOAK_*/SECRET_* 断言行，末尾 RESULT=…
import fs from "node:fs";

const ROOT = "artifacts/rc5";
const fails = [];
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${detail ? " " + detail : ""}`);
  if (!cond) fails.push(name);
};

// ---------- 矩阵 ----------
const matrixPath = `${ROOT}/acceptance-matrix.md`;
const text = fs.readFileSync(matrixPath, "utf8");
const section = text.split("## 164 行矩阵")[1] || "";
const lines = section.split("\n").filter((l) => l.startsWith("| "));
const rows = lines
  .map((l) => l.split(/(?<!\\)\|/).map((c) => c.trim()))
  .filter((c) => /^RC5-[A-Z0-9]+-\d{3}$/.test(c[2] || ""));

ok("MATRIX_ROWS_164", rows.length === 164, `rows=${rows.length}`);
const ids = rows.map((c) => c[2]);
ok("MATRIX_UNIQUE_IDS_164", new Set(ids).size === 164, `unique=${new Set(ids).size}`);

const byStatus = {};
for (const c of rows) byStatus[c[4]] = (byStatus[c[4]] || 0) + 1;
ok(
  "MATRIX_STATUS_130_8_26",
  byStatus.PASS === 130 && byStatus.FAIL === 8 && byStatus.MISSING === 26,
  JSON.stringify(byStatus),
);

const bySuite = {};
for (const id of ids) {
  const s = id.split("-")[1];
  bySuite[s] = (bySuite[s] || 0) + 1;
}
const expectSuites = { ENV: 8, BOOT: 13, API: 9, ACC: 10, MCPS: 11, MCPP: 24, TERM: 14, IMP: 10, ACP: 10, OFF: 7, HERO: 8, CMD: 4, V1: 8, DATA: 10, UI: 8, SEC: 10 };
ok("MATRIX_SUITE_COUNTS_16", JSON.stringify(bySuite) === JSON.stringify(expectSuites), JSON.stringify(bySuite));

const byPhase = {};
for (const c of rows) byPhase[c[3]] = (byPhase[c[3]] || 0) + 1;
const expectPhases = { P1: 10, P2: 12, P3: 7, P4: 17, P5: 16, P6a: 97, P6b: 5 };
ok(
  "MATRIX_PHASE_COUNTS",
  Object.keys(expectPhases).every((k) => byPhase[k] === expectPhases[k]) && Object.keys(byPhase).length === 7,
  JSON.stringify(byPhase),
);

// status 只能取三值
ok("MATRIX_STATUS_VOCAB", rows.every((c) => ["PASS", "FAIL", "MISSING"].includes(c[4])));
// PASS 行必须有 evidence 路径
ok("MATRIX_PASS_HAS_EVIDENCE", rows.filter((c) => c[4] === "PASS").every((c) => c[5] && c[5].includes("artifacts/rc5/")));

// P0 优先级行：从 case-audit.json 对照
const audit = JSON.parse(fs.readFileSync(`${ROOT}/p6a/case-audit.json`, "utf8"));
const list = Array.isArray(audit) ? audit : audit.cases || [];
const p0 = list.filter((c) => c.priority === "P0");
const p0np = p0.filter((c) => c.status !== "PASS");
ok("AUDIT_TOTAL_164", list.length === 164, `audit=${list.length}`);
ok(
  "P0_NOT_PASS_16_(FAIL8_MISSING8)",
  p0np.length === 16 && p0np.filter((c) => c.status === "FAIL").length === 8 && p0np.filter((c) => c.status === "MISSING").length === 8,
  `p0=${p0.length} notpass=${p0np.length}`,
);

// 不得判绿的两条
for (const id of ["RC5-DATA-009", "RC5-TERM-013"]) {
  const row = rows.find((c) => c[2] === id);
  const a = list.find((c) => c.id === id);
  ok(`NOT_GREEN_${id}`, row && row[4] !== "PASS" && a && a.status !== "PASS", `matrix=${row && row[4]} audit=${a && a.status}`);
}

// ---------- phase summaries ----------
const REQ = ["phase", "commit", "imageTag", "startedAt", "finishedAt", "commands", "leftovers"];
for (const phase of ["p0", "p1", "p2", "p3", "p4", "p5", "p6a", "p6b", "p7"]) {
  const p = `${ROOT}/${phase}/summary.json`;
  let j;
  try {
    j = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    ok(`SUMMARY_${phase.toUpperCase()}`, false, `unreadable: ${e.message}`);
    continue;
  }
  const missing = REQ.filter((k) => !(k in j));
  const hasCases = j.cases || j.casesSummary;
  ok(`SUMMARY_${phase.toUpperCase()}_KEYS`, missing.length === 0 && !!hasCases, `missing=${missing.join(",") || "-"} cases=${!!hasCases}`);
}
// p6b 原 lane 的 cases 数组必须保留
const p6b = JSON.parse(fs.readFileSync(`${ROOT}/p6b/summary.json`, "utf8"));
ok("P6B_LANE_CASES_PRESERVED", Array.isArray(p6b.cases) && p6b.cases.length >= 11, `cases=${p6b.cases && p6b.cases.length}`);

// ---------- soak ----------
const soak = JSON.parse(fs.readFileSync(`${ROOT}/p6a/soak-window.json`, "utf8"));
ok("SOAK_PLANNED_24H", soak.plannedSeconds === 86400 || soak.durationSeconds === 86400, JSON.stringify({ plannedSeconds: soak.plannedSeconds, durationSeconds: soak.durationSeconds }));
ok("SOAK_INCOMPLETE", soak.windowComplete === false, `windowComplete=${soak.windowComplete} observedHours=${soak.observedElapsedHours}`);
ok("SOAK_OBSERVED_LT_24H", Number(soak.observedElapsedHours) < 24, `observedHours=${soak.observedElapsedHours}`);

// ---------- secret scan ----------
const scan = fs.readFileSync(`${ROOT}/p6a/secret-scan.log`, "utf8");
ok("SECRET_SCAN_HITS_0", /^hits=0$/m.test(scan), scan.match(/^hits=.*$/m)?.[0] || "");

console.log(`RESULT=${fails.length === 0 ? "ALL_ASSERTIONS_PASS" : "ASSERTIONS_FAIL:" + fails.join(",")}`);
process.exitCode = fails.length === 0 ? 0 : 1;