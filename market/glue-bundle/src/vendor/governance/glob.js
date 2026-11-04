function globToRegExp(glob) {
  let source = "";
  for (const ch of glob) {
    if (ch === "*") {
      source += ".*";
    } else if (ch === "?") {
      source += ".";
    } else {
      source += escapeRegExpChar(ch);
    }
  }
  return new RegExp(`^${source}$`, "u");
}
function escapeRegExpChar(ch) {
  return /[.*+?^${}()|[\]\\]/u.test(ch) ? `\\${ch}` : ch;
}
const cache = /* @__PURE__ */ new Map();
function matchGlob(name, glob) {
  let re = cache.get(glob);
  if (re === void 0) {
    re = globToRegExp(glob);
    cache.set(glob, re);
  }
  return re.test(name);
}
function matchAnyGlob(name, globs) {
  return globs.some((glob) => matchGlob(name, glob));
}
export {
  globToRegExp,
  matchAnyGlob,
  matchGlob
};
