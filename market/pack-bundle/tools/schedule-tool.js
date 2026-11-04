const SCHEDULE_TOOL_SERVICE_ID = "@event/schedule-tool";
function createScheduleTool() {
  const overlapsOf = (sorted) => {
    const out = [];
    let runningEnd = -1;
    let runningName = "";
    for (const seg of sorted) {
      if (runningEnd > seg.startMinute) {
        out.push({
          a: runningName,
          b: seg.name,
          overlapMinutes: runningEnd - seg.startMinute
        });
      }
      if (seg.endMinute > runningEnd) {
        runningEnd = seg.endMinute;
        runningName = seg.name;
      }
    }
    return out;
  };
  return {
    id: SCHEDULE_TOOL_SERVICE_ID,
    findOverlaps(segments) {
      return overlapsOf(byStart(segments));
    },
    check(segments, window) {
      const sorted = byStart(segments);
      const invalid = [];
      for (const seg of sorted) {
        if (!(seg.startMinute < seg.endMinute) || seg.startMinute < 0 || seg.endMinute > 1440) {
          invalid.push(seg.name);
        }
      }
      const overlaps = overlapsOf(sorted);
      const outOfWindow = [];
      for (const seg of sorted) {
        if (window?.startMinute !== void 0 && seg.startMinute < window.startMinute) outOfWindow.push(seg.name);
        if (window?.endMinute !== void 0 && seg.endMinute > window.endMinute) outOfWindow.push(seg.name);
      }
      return {
        ok: invalid.length === 0 && overlaps.length === 0 && outOfWindow.length === 0,
        sortedSegments: sorted,
        invalid,
        overlaps,
        outOfWindow
      };
    }
  };
}
function byStart(segments) {
  return [...segments].sort(
    (a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute || a.name.localeCompare(b.name)
  );
}
export {
  SCHEDULE_TOOL_SERVICE_ID,
  createScheduleTool
};
