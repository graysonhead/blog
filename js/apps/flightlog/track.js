// Flight track loading: KMZ unzip, KML parse, and derived values.
//
// No dependencies. KMZ is a zip, read here with the browser's own
// DecompressionStream ("deflate-raw"), which every current browser ships.
// KML is parsed with DOMParser, matching elements by local name so it
// doesn't matter which KML/gx namespace version a file declares.

const M_TO_FT = 3.28084;
const NM_PER_RAD = 3440.065; // mean earth radius in nautical miles
const GS_WINDOW_MS = 10000; // groundspeed is averaged over ~10 s of track
const AIRBORNE_KT = 40; // above this, assume flying rather than taxiing

// ---------- KMZ ----------

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Returns the text of the first .kml in the archive (doc.kml by convention).
async function kmlFromKmz(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a valid KMZ (zip) file");

  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const entries = [];
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error("corrupt KMZ central directory");
    const nameLen = u16(b, p + 28);
    entries.push({
      method: u16(b, p + 10),
      size: u32(b, p + 20),
      local: u32(b, p + 42),
      name: new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen)),
    });
    p += 46 + nameLen + u16(b, p + 30) + u16(b, p + 32);
  }

  const kmls = entries.filter((e) => e.name.toLowerCase().endsWith(".kml"));
  const e = kmls.find((x) => x.name.toLowerCase() === "doc.kml") || kmls[0];
  if (!e) throw new Error("KMZ has no .kml inside");

  const start = e.local + 30 + u16(b, e.local + 26) + u16(b, e.local + 28);
  const data = b.subarray(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method === 8) return new TextDecoder().decode(await inflateRaw(data));
  throw new Error(`unsupported KMZ compression method ${e.method}`);
}

// ---------- KML ----------

const byName = (root, name) => Array.from(root.getElementsByTagNameNS("*", name));
const kids = (el, name) => Array.from(el.children).filter((c) => c.localName === name);

// One track = an array of { t, lat, lon, altFt, gsKt } in file order.
// t is epoch ms (or null for a LineString), altFt is feet MSL (KML stores
// meters), gsKt is only set when the file carries reported speed.
function parseKml(doc) {
  const name = byName(doc, "Placemark").map((p) => kids(p, "name")[0]?.textContent.trim()).find(Boolean)
    || byName(doc, "Document").map((d) => kids(d, "name")[0]?.textContent.trim()).find(Boolean)
    || "";

  const points = [];
  for (const trk of byName(doc, "Track")) {
    const whens = kids(trk, "when").map((w) => Date.parse(w.textContent.trim()));
    const coords = kids(trk, "coord");
    let speeds = null;
    for (const arr of byName(trk, "SimpleArrayData")) {
      if (/^speed_?kts$/i.test(arr.getAttribute("name") || "")) {
        speeds = byName(arr, "value").map((v) => parseFloat(v.textContent));
      }
    }
    coords.forEach((c, i) => {
      const [lon, lat, alt] = c.textContent.trim().split(/[\s,]+/).map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      points.push({
        t: Number.isFinite(whens[i]) ? whens[i] : null,
        lat, lon,
        altFt: Number.isFinite(alt) ? alt * M_TO_FT : null,
        gsKt: speeds && Number.isFinite(speeds[i]) ? speeds[i] : null,
      });
    });
  }

  // No gx:Track: fall back to plain LineString coordinates (no timestamps).
  if (!points.length) {
    for (const ls of byName(doc, "LineString")) {
      const text = byName(ls, "coordinates")[0]?.textContent || "";
      for (const tuple of text.trim().split(/\s+/)) {
        const [lon, lat, alt] = tuple.split(",").map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          points.push({ t: null, lat, lon, altFt: Number.isFinite(alt) ? alt * M_TO_FT : null, gsKt: null });
        }
      }
    }
  }

  if (points.length < 2) throw new Error("no track points found in the KML");
  return { name, points };
}

// ---------- GPX ----------

// MyFlightbook's GPX export: <trk><trkseg><trkpt lat lon><ele>m</ele><time>.
// Garmin-style files may carry speed (m/s) in a TrackPointExtension.
const MS_TO_KT = 1.943844;

function parseGpx(doc) {
  const name = byName(doc, "trk").map((t) => kids(t, "name")[0]?.textContent.trim()).find(Boolean)
    || byName(doc, "metadata").map((m) => kids(m, "name")[0]?.textContent.trim()).find(Boolean)
    || "";

  const points = [];
  for (const pt of [...byName(doc, "trkpt"), ...byName(doc, "rtept")]) {
    const lat = parseFloat(pt.getAttribute("lat"));
    const lon = parseFloat(pt.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = parseFloat(kids(pt, "ele")[0]?.textContent);
    const t = Date.parse(kids(pt, "time")[0]?.textContent || "");
    const spd = parseFloat(byName(pt, "speed")[0]?.textContent);
    points.push({
      t: Number.isFinite(t) ? t : null,
      lat, lon,
      altFt: Number.isFinite(ele) ? ele * M_TO_FT : null,
      gsKt: Number.isFinite(spd) ? spd * MS_TO_KT : null,
    });
  }
  if (points.length < 2) throw new Error("no track points found in the GPX");
  return { name, points };
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("couldn't parse the track file");
  return doc.documentElement.localName === "gpx" ? parseGpx(doc) : parseKml(doc);
}

// ---------- derived ----------

function distNm(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * NM_PER_RAD * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Adds cumulative distance (`d`, nm) to every point, fills in groundspeed
// from position/time where the file didn't report it, and returns the
// summary stats the figure shows.
function derive(points) {
  points[0].d = 0;
  for (let i = 1; i < points.length; i++) points[i].d = points[i - 1].d + distNm(points[i - 1], points[i]);

  const timed = points.every((p) => p.t !== null);
  if (timed) {
    // Centered window spanning about GS_WINDOW_MS, so GPS jitter between
    // adjacent fixes doesn't turn into speed spikes.
    let lo = 0, hi = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      while (lo < i && p.t - points[lo].t > GS_WINDOW_MS / 2) lo++;
      while (hi < points.length - 1 && points[hi + 1].t - p.t <= GS_WINDOW_MS / 2) hi++;
      if (p.gsKt === null) {
        const dt = (points[hi].t - points[lo].t) / 3.6e6;
        p.gsKt = dt > 0 ? (points[hi].d - points[lo].d) / dt : 0;
      }
    }
  }

  const first = points[0], last = points[points.length - 1];
  const alts = points.map((p) => p.altFt).filter((a) => a !== null);
  const gss = points.map((p) => p.gsKt).filter((g) => g !== null);
  const hours = timed ? (last.t - first.t) / 3.6e6 : null;

  // Airborne span: first to last point at or above AIRBORNE_KT. Telemetry
  // usually includes taxi and ramp time, which would drag the average
  // groundspeed down to nothing.
  let air = null;
  if (timed && gss.length) {
    const up = points.findIndex((p) => p.gsKt >= AIRBORNE_KT);
    const down = points.findLastIndex((p) => p.gsKt >= AIRBORNE_KT);
    if (up >= 0 && down > up) {
      const h = (points[down].t - points[up].t) / 3.6e6;
      air = { start: points[up].t, end: points[down].t, hours: h, avgGsKt: (points[down].d - points[up].d) / h };
    }
  }

  return {
    timed,
    start: timed ? first.t : null,
    end: timed ? last.t : null,
    hours,
    air,
    distanceNm: last.d,
    maxAltFt: alts.length ? Math.max(...alts) : null,
    minAltFt: alts.length ? Math.min(...alts) : null,
    maxGsKt: gss.length ? Math.max(...gss) : null,
    avgGsKt: air ? air.avgGsKt : hours ? last.d / hours : null,
  };
}

export async function loadTrack(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`couldn't load ${url} (${res.status})`);
  const buf = await res.arrayBuffer();
  const isZip = new Uint8Array(buf, 0, 2).every((v, i) => v === [0x50, 0x4b][i]);
  const text = isZip ? await kmlFromKmz(buf) : new TextDecoder().decode(buf);
  const track = parseXml(text);
  track.stats = derive(track.points);
  return track;
}
