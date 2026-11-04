function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object" && value !== null) {
    const record = {};
    for (const key of Object.keys(value).sort()) {
      record[key] = sortValue(value[key]);
    }
    return record;
  }
  return value;
}
export {
  stableStringify
};
