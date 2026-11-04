function hitKey(hit) {
  return `${hit.ref.backend}:${hit.ref.doc_id}`;
}
function fuseByRRF(lists, options) {
  const k = options?.k ?? 60;
  const topK = options?.topK;
  const scores = /* @__PURE__ */ new Map();
  const representative = /* @__PURE__ */ new Map();
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) {
      const hit = list[i];
      if (hit === void 0) continue;
      const key = hitKey(hit);
      if (!representative.has(key)) representative.set(key, hit);
      const contribution = 1 / (k + i + 1);
      scores.set(key, (scores.get(key) ?? 0) + contribution);
    }
  }
  const fused = [...representative.entries()].map(([key, hit]) => ({
    ...hit,
    score: normalizeRrf(scores.get(key) ?? 0, k, lists.length)
  }));
  fused.sort((a, b) => b.score - a.score || hitKey(a).localeCompare(hitKey(b)));
  return topK === void 0 ? fused : fused.slice(0, topK);
}
function normalizeRrf(sum, k, listCount) {
  if (listCount <= 0) return 0;
  let full = 0;
  for (let i = 0; i < listCount; i++) full += 1 / (k + i + 1);
  return Math.min(1, sum / full);
}
export {
  fuseByRRF,
  hitKey
};
