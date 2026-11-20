// Flight log annotations: parsing the shortcode body and placing each
// annotation on the track.
//
// Body format, one per line (blank lines and lines starting with # are
// ignored):
//
//   09:40              | engine | Engine failure       a moment
//   09:44-09:51        | turns  | Turns around a point a range (maneuver)
//   15:02Z             | Takeoff                       key from the label
//   09:52-09:56 | steep | Steep turns | max-alt avg-alt gs-dev
//
// Times are local to the figure's `tz` (UTC without one); a trailing Z
// forces UTC. Seconds are optional. The key becomes the legend item's id, so
// a post can link to it with {{ mark(key="...", text="...") }}.
//
// An optional last field turns on stats for a range, any of (in any order):
//   start-alt altitude at the start of the range
//   max-alt   highest altitude in the range
//   avg-alt   time-weighted average altitude
//   alt-dev   largest altitude deviation from that average (±ft)
//   gs-dev    largest groundspeed deviation from the range's average (±kt)

export const MARK_COLORS = ["#b083f0", "#39c5bb", "#e275ad", "#57ab5a", "#e0823d", "#6cb6ff"];

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(z)?$/i;

export const MARK_STATS = ["start-alt", "max-alt", "avg-alt", "alt-dev", "gs-dev"];
const isStatsField = (f) => f.split(/[\s,]+/).filter(Boolean).every((w) => MARK_STATS.includes(w.toLowerCase()));

const slug = (s) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-");

export function parseMarks(text) {
  const marks = [], problems = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split("|").map((p) => p.trim());
    let stats = [];
    if (parts.length >= 3 && parts[parts.length - 1] && isStatsField(parts[parts.length - 1])) {
      stats = [...new Set(parts.pop().toLowerCase().split(/[\s,]+/).filter(Boolean))];
    }
    if (parts.length === 4) {
      const bad = parts[3].split(/[\s,]+/).filter((w) => w && !MARK_STATS.includes(w.toLowerCase()));
      problems.push(`unknown stat "${bad.join(" ")}" (use ${MARK_STATS.join(", ")}): ${line}`);
      continue;
    }
    if (parts.length < 2 || parts.length > 3) {
      problems.push(`expected "time | key | label | stats": ${line}`);
      continue;
    }
    const [when, ...rest] = parts;
    const label = rest[rest.length - 1];
    const key = rest.length === 2 ? slug(rest[0]) : slug(label);
    const [a, b] = when.split(/\s*-\s*/);
    if (!TIME_RE.test(a) || (b !== undefined && !TIME_RE.test(b))) {
      problems.push(`couldn't read the time "${when}"`);
      continue;
    }
    if (!key) { problems.push(`no usable key: ${line}`); continue; }
    if (stats.length && b === undefined) {
      problems.push(`"${label}" asks for stats but is a single time; give it a range`);
      stats = [];
    }
    marks.push({ key, label, start: a, end: b ?? null, stats });
  }
  return { marks, problems };
}

// Offset of `tz` from UTC at instant t, in ms.
function tzOffset(t, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(t);
  const g = (k) => +parts.find((p) => p.type === k).value;
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}

// A wall-clock time near the flight to an epoch ms, trying the flight's own
// day and the days either side (a flight can cross midnight), and keeping
// the candidate closest to the track.
function resolveTime(str, tz, start, end) {
  const [, h, mi, s, z] = str.match(TIME_RE);
  const zone = z || !tz ? "UTC" : tz;
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(start).split("-").map(Number);
  let best = null;
  for (const k of [-1, 0, 1]) {
    const wall = Date.UTC(d[0], d[1] - 1, d[2] + k, +h, +mi, +(s || 0));
    let t = wall - tzOffset(wall, zone);
    t = wall - tzOffset(t, zone); // settle across a DST change
    const miss = t < start ? start - t : t > end ? t - end : 0;
    if (!best || miss < best.miss) best = { t, miss };
  }
  return best.miss <= 10 * 60 * 1000 ? best.t : null;
}

// Index of the point closest in time to t (points sorted by time).
export function nearestIndex(points, t) {
  let lo = 0, hi = points.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; (points[mid].t < t ? (lo = mid) : (hi = mid)); }
  return t - points[lo].t < points[hi].t - t ? lo : hi;
}

// Altitude and groundspeed figures over [t0, t1] for the requested stats.
// The average altitude is weighted by time so uneven logging intervals
// don't skew it. Groundspeed is what the GPS sees, wind included.
function rangeStats(points, t0, t1, wanted) {
  const inside = points.filter((p) => p.t !== null && p.t >= t0 && p.t <= t1);
  const out = {};
  const alt = inside.filter((p) => p.altFt !== null);
  if (wanted.includes("start-alt") && alt.length) out.startAltFt = alt[0].altFt;
  if (wanted.includes("max-alt") && alt.length) out.maxAltFt = Math.max(...alt.map((p) => p.altFt));
  if ((wanted.includes("avg-alt") || wanted.includes("alt-dev")) && alt.length) {
    let area = 0, span = 0;
    for (let i = 1; i < alt.length; i++) {
      const dt = alt[i].t - alt[i - 1].t;
      area += dt * (alt[i].altFt + alt[i - 1].altFt) / 2;
      span += dt;
    }
    const avg = span ? area / span : alt[0].altFt;
    if (wanted.includes("avg-alt")) out.avgAltFt = avg;
    if (wanted.includes("alt-dev")) {
      out.altAvgFt = avg;
      out.altDevFt = Math.max(...alt.map((p) => Math.abs(p.altFt - avg)));
    }
  }
  const gs = inside.map((p) => p.gsKt).filter((g) => g !== null);
  if (wanted.includes("gs-dev") && gs.length) {
    const avg = gs.reduce((a, b) => a + b, 0) / gs.length;
    out.gsAvgKt = avg;
    out.gsDevKt = Math.max(...gs.map((g) => Math.abs(g - avg)));
  }
  return out;
}

// Places parsed marks on a timed track: adds t0/t1 (ms), a number, and a
// color. Marks outside the track (or on an untimed one) become problems.
export function resolveMarks(parsed, track, tz) {
  const problems = [...parsed.problems];
  if (!parsed.marks.length) return { marks: [], problems };
  if (!track.stats.timed) {
    return { marks: [], problems: [...problems, "annotations need a track with timestamps"] };
  }
  const { start, end } = track.stats;
  const seen = new Set();
  const marks = [];
  for (const m of parsed.marks) {
    const t0 = resolveTime(m.start, tz, start, end);
    const t1 = m.end ? resolveTime(m.end, tz, start, end) : null;
    if (t0 === null || (m.end && t1 === null)) {
      problems.push(`"${m.label}" (${m.start}${m.end ? "-" + m.end : ""}) is outside this flight's track`);
      continue;
    }
    if (seen.has(m.key)) { problems.push(`duplicate key "${m.key}"`); continue; }
    seen.add(m.key);
    const mk = { ...m, t0: Math.min(t0, t1 ?? t0), t1: t1 === null ? null : Math.max(t0, t1) };
    if (m.stats.length) mk.figures = rangeStats(track.points, mk.t0, mk.t1, m.stats);
    marks.push(mk);
  }
  marks.sort((a, b) => a.t0 - b.t0);
  marks.forEach((m, i) => { m.n = i + 1; m.color = MARK_COLORS[i % MARK_COLORS.length]; });
  return { marks, problems };
}
