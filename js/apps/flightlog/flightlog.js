// Flight log applet: entry point.
//
// Every `{{ flightlog(src="...") }}` shortcode emits a
// <figure data-applet="flightlog" data-src="...">. This module finds each
// one, loads its KML/KMZ (track.js), and fills in the stats row, a Leaflet
// ground track map, and an SVG altitude/groundspeed profile. Hovering the
// profile or the track highlights the same moment in both.
//
// Optional annotations come from the shortcode body (see marks.js): ranges
// are drawn as colored segments/bands, moments as pins/lines, all numbered
// and listed in a legend. Each legend item's id is the annotation's key, so
// a post can link to it with [text](#key); following such a link (or loading
// the page with #key) scrolls to the map and zooms to that annotation.
//
// Leaflet is loaded once from cdnjs (pinned with SRI) the first time a
// figure needs it, so pages without a flightlog never fetch it.

import { loadTrack } from "./track.js";
import { parseMarks, resolveMarks, nearestIndex } from "./marks.js";

const LEAFLET = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/";
const LEAFLET_JS_SRI = "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH";
const LEAFLET_CSS_SRI = "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H";
// Standard OSM tiles; applets.css darkens them with a filter to suit the site.
const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MAX_DRAWN = 1500; // points drawn in the profile; hover uses the same set

const SVG_NS = "http://www.w3.org/2000/svg";

// ---------- Leaflet loader ----------

let leafletPromise = null;
function ensureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    Object.assign(css, { rel: "stylesheet", href: LEAFLET + "leaflet.css", integrity: LEAFLET_CSS_SRI, crossOrigin: "anonymous" });
    document.head.appendChild(css);
    const js = document.createElement("script");
    Object.assign(js, { src: LEAFLET + "leaflet.js", integrity: LEAFLET_JS_SRI, crossOrigin: "anonymous" });
    js.onload = () => resolve(window.L);
    js.onerror = () => reject(new Error("couldn't load the map library"));
    document.head.appendChild(js);
  });
  return leafletPromise;
}

// ---------- formatting ----------

const num = (v, d = 0) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

function timeFormatters(tz) {
  const zone = tz || "UTC";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const hms = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const zoneName = (t) => tz
    ? new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(t).find((p) => p.type === "timeZoneName").value
    : "Z";
  return {
    date: (t) => date.format(t),
    time: (t) => hm.format(t) + (tz ? "" : "Z"),
    timeZ: (t) => hm.format(t) + (tz ? " " + zoneName(t) : "Z"),
    // With seconds, for hover readouts and annotations given to the second.
    timeS: (t) => hms.format(t) + (tz ? "" : "Z"),
    timeSZ: (t) => hms.format(t) + (tz ? " " + zoneName(t) : "Z"),
  };
}

function duration(hours) {
  const m = Math.round(hours * 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ---------- stats ----------

function renderStats(dl, s, fmt) {
  const rows = [];
  if (s.timed) {
    rows.push(["Date", fmt.date(s.start)]);
    rows.push(["Track", `${fmt.time(s.start)} to ${fmt.timeZ(s.end)} (${duration(s.hours)})`]);
    if (s.air) rows.push(["Airborne", `${fmt.time(s.air.start)} to ${fmt.timeZ(s.air.end)} (${duration(s.air.hours)})`]);
  }
  rows.push(["Distance", `${num(s.distanceNm, 1)} nm`]);
  if (s.maxAltFt !== null) rows.push(["Max altitude", `${num(s.maxAltFt)} ft MSL`]);
  if (s.maxGsKt !== null) rows.push(["Max groundspeed", `${num(s.maxGsKt)} kt`]);
  if (s.avgGsKt !== null) rows.push(["Avg groundspeed", `${num(s.avgGsKt)} kt`]);
  dl.replaceChildren(...rows.flatMap(([k, v]) => {
    const wrap = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = k;
    dd.textContent = v;
    wrap.append(dt, dd);
    return [wrap];
  }));
}

// ---------- map ----------

// Track line width by zoom: hairline when zoomed out, so a tight pattern
// doesn't smear into a blob; heavier as you zoom in.
const trackWeight = (z) => (z <= 11 ? 1.5 : z <= 13 ? 2 : z <= 15 ? 2.5 : 3);

// `full` is every recorded point: the line is drawn from it and hovering
// reads from it, so the readout is to the second. Hover callbacks get a
// point object; `readout(p)` gives the tooltip's HTML for one.
async function renderMap(el, full, marks, readout) {
  const L = await ensureLeaflet();
  const map = L.map(el, { scrollWheelZoom: false, attributionControl: true });
  L.tileLayer(TILES, { attribution: TILE_ATTR, maxZoom: 18 }).addTo(map);

  const latlngs = full.map((p) => [p.lat, p.lon]);
  const css = getComputedStyle(el);
  const color = css.getPropertyValue("--fl-track").trim() || "#e5534b";
  // smoothFactor 0: Leaflet otherwise simplifies the line at every zoom,
  // which turns curves into visible corners.
  const line = L.polyline(latlngs, {
    color, weight: 2, opacity: 0.9, smoothFactor: 0, lineJoin: "round", lineCap: "round",
  }).addTo(map);
  const fitAll = () => map.fitBounds(line.getBounds(), { padding: [20, 20] });
  fitAll();

  // Annotations: a colored segment over the track for ranges, and a
  // numbered pin at the start of every annotation.
  let markListener = () => {};
  const markLayers = new Map();
  for (const mk of marks) {
    const j0 = nearestIndex(full, mk.t0);
    const anchor = [full[j0].lat, full[j0].lon];
    let seg = null;
    if (mk.t1 !== null) {
      const j1 = nearestIndex(full, mk.t1);
      seg = L.polyline(full.slice(j0, j1 + 1).map((p) => [p.lat, p.lon]), {
        color: mk.color, opacity: 0.95, smoothFactor: 0, lineJoin: "round", lineCap: "round", interactive: false,
      }).addTo(map);
    }
    const pin = L.marker(anchor, {
      icon: L.divIcon({ className: "flightlog__pin", html: `<span style="--c:${mk.color}">${mk.n}</span>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
      title: mk.label, keyboard: false, riseOnHover: true,
    }).addTo(map);
    pin.on("click", () => markListener(mk.key));
    markLayers.set(mk.key, { seg, pin, anchor });
  }

  const restyle = () => {
    const w = trackWeight(map.getZoom());
    line.setStyle({ weight: w });
    for (const { seg } of markLayers.values()) seg?.setStyle({ weight: w + 2 });
  };
  map.on("zoomend", restyle);
  restyle();

  const dot = (ll, fill) => L.circleMarker(ll, { radius: 5, color: "#fff", weight: 1.5, fillColor: fill, fillOpacity: 1 }).addTo(map);
  dot(latlngs[0], css.getPropertyValue("--fl-start").trim() || "#3fb950").bindTooltip("Start");
  dot(latlngs[latlngs.length - 1], css.getPropertyValue("--fl-end").trim() || "#e5534b").bindTooltip("End");

  const cursor = L.circleMarker(latlngs[0], { radius: 6, color: "#fff", weight: 2, fillColor: color, fillOpacity: 1, interactive: false })
    .bindTooltip("", { permanent: true, direction: "top", offset: [0, -8], className: "flightlog__maptip" });

  // Clicking into the map enables wheel zoom; leaving disables it again,
  // so scrolling the post never gets trapped by the map.
  map.on("click", () => map.scrollWheelZoom.enable());
  map.on("mouseout", () => map.scrollWheelZoom.disable());

  // Nearest recorded point to the pointer, in screen space.
  let listener = () => {};
  // Invisible, wider copy of the track that catches the pointer, so the thin
  // visible line is still easy to hover.
  const hit = L.polyline(latlngs, { opacity: 0, weight: 14 }).addTo(map);
  hit.on("mousemove", (e) => {
    const target = map.latLngToLayerPoint(e.latlng);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < latlngs.length; i++) {
      const d = map.latLngToLayerPoint(latlngs[i]).distanceTo(target);
      if (d < bestD) { bestD = d; best = i; }
    }
    listener(full[best]);
  });
  hit.on("mouseout", () => listener(null));

  return {
    map,
    show(p) {
      if (p === null) { cursor.remove(); return; }
      cursor.setLatLng([p.lat, p.lon]);
      if (!map.hasLayer(cursor)) cursor.addTo(map);
      cursor.setTooltipContent(readout(p));
    },
    onHover(cb) { listener = cb; },
    onMark(cb) { markListener = cb; },
    // Zoom to one annotation (dimming the others), or back to the whole
    // flight with null.
    focus(key) {
      for (const [k, { seg, pin }] of markLayers) {
        pin.getElement()?.classList.toggle("is-focus", k === key);
        seg?.setStyle({ opacity: key === null || k === key ? 0.95 : 0.35 });
      }
      const target = markLayers.get(key);
      if (!target) fitAll();
      else if (target.seg) map.fitBounds(target.seg.getBounds(), { padding: [30, 30], maxZoom: 15 });
      else map.setView(target.anchor, Math.max(map.getZoom(), 14));
    },
  };
}

// ---------- profile ----------

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
}

function ticks(lo, hi, target) {
  const step = niceStep(hi - lo || 1, target);
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return { out, step };
}

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function renderProfile(host, pts, stats, fmt, marks = [], focusKey = null) {
  const hasAlt = stats.maxAltFt !== null;
  const hasGs = stats.maxGsKt !== null;
  const xOf = stats.timed ? (p) => p.t : (p) => p.d;

  const W = Math.max(280, host.clientWidth);
  const H = 220;
  const m = { l: 52, r: hasGs ? 44 : 12, t: 24, b: 28 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;

  const x0 = xOf(pts[0]), x1 = xOf(pts[pts.length - 1]);
  const sx = (v) => m.l + ((v - x0) / (x1 - x0 || 1)) * iw;

  // Floor at 0 ft unless the track actually goes below sea level.
  const aLo = hasAlt && stats.minAltFt < 0 ? -niceStep(stats.maxAltFt - stats.minAltFt, 4) * Math.ceil(-stats.minAltFt / niceStep(stats.maxAltFt - stats.minAltFt, 4)) : 0;
  const aT = hasAlt ? ticks(aLo, stats.maxAltFt * 1.05, 4) : null;
  const aHi = hasAlt ? aT.out[aT.out.length - 1] + (aT.out[aT.out.length - 1] < stats.maxAltFt ? aT.step : 0) : 1;
  const sa = (v) => m.t + ih - ((v - aLo) / (aHi - aLo)) * ih;

  const gT = hasGs ? ticks(0, stats.maxGsKt * 1.05, 4) : null;
  const gHi = hasGs ? gT.out[gT.out.length - 1] + (gT.out[gT.out.length - 1] < stats.maxGsKt ? gT.step : 0) : 1;
  const sg = (v) => m.t + ih - (v / gHi) * ih;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "flightlog__svg", role: "img",
    "aria-label": "Altitude and groundspeed over the flight" });

  // Grid + left axis (altitude)
  const axes = el("g", { class: "flightlog__axes" }, svg);
  if (hasAlt) {
    for (const v of aT.out) {
      el("line", { x1: m.l, x2: W - m.r, y1: sa(v), y2: sa(v), class: "flightlog__grid" }, axes);
      el("text", { x: m.l - 6, y: sa(v), "text-anchor": "end", "dominant-baseline": "middle", class: "flightlog__tick flightlog__tick--alt" }, axes).textContent = num(v);
    }
    el("text", { x: 4, y: 2, class: "flightlog__axis-label flightlog__tick--alt", "dominant-baseline": "hanging" }, axes).textContent = "ft";
  }
  if (hasGs) {
    for (const v of gT.out) {
      el("text", { x: W - m.r + 6, y: sg(v), "dominant-baseline": "middle", class: "flightlog__tick flightlog__tick--gs" }, axes).textContent = num(v);
    }
    el("text", { x: W - 4, y: 2, "text-anchor": "end", "dominant-baseline": "hanging", class: "flightlog__axis-label flightlog__tick--gs" }, axes).textContent = "kt";
  }

  // X axis: clock time when timestamps exist, otherwise distance.
  const xTickCount = Math.max(2, Math.floor(iw / 90));
  if (stats.timed) {
    const spanMin = (x1 - x0) / 60000;
    const stepMin = [1, 2, 5, 10, 15, 20, 30, 60, 120].find((s) => spanMin / s <= xTickCount) || 240;
    const stepMs = stepMin * 60000;
    for (let t = Math.ceil(x0 / stepMs) * stepMs; t <= x1; t += stepMs) {
      el("text", { x: sx(t), y: H - 8, "text-anchor": "middle", class: "flightlog__tick" }, axes).textContent = fmt.time(t);
    }
  } else {
    for (const v of ticks(0, x1, xTickCount).out) {
      el("text", { x: sx(v), y: H - 8, "text-anchor": "middle", class: "flightlog__tick" }, axes).textContent = `${num(v)} nm`;
    }
  }

  // Annotations: shaded band for ranges, dashed line for moments, numbered
  // badge in the top margin. Drawn before the series so the lines stay on top.
  let markListener = () => {};
  const markEls = new Map();
  if (stats.timed) {
    for (const mk of marks) {
      const g = el("g", { class: "flightlog__mark" + (mk.key === focusKey ? " is-focus" : ""), style: `--c:${mk.color}` }, svg);
      const xa = sx(mk.t0);
      if (mk.t1 !== null) {
        el("rect", { x: xa, y: m.t, width: Math.max(2, sx(mk.t1) - xa), height: ih, class: "flightlog__mark-band" }, g);
      } else {
        el("line", { x1: xa, x2: xa, y1: m.t, y2: m.t + ih, class: "flightlog__mark-line" }, g);
      }
      const bx = Math.min(Math.max(xa, m.l + 9), W - m.r - 9);
      const badge = el("g", { class: "flightlog__mark-badge", transform: `translate(${bx},${m.t - 11})` }, g);
      el("circle", { r: 8 }, badge);
      el("text", { "text-anchor": "middle", "dominant-baseline": "central" }, badge).textContent = mk.n;
      el("title", {}, badge).textContent = mk.label;
      badge.addEventListener("click", () => markListener(mk.key));
      markEls.set(mk.key, g);
    }
  }

  // Series
  const path = (fy, key) => pts.filter((p) => p[key] !== null)
    .map((p, i) => `${i ? "L" : "M"}${sx(xOf(p)).toFixed(1)},${fy(p[key]).toFixed(1)}`).join("");
  if (hasAlt) {
    const line = path(sa, "altFt");
    const altPts = pts.filter((p) => p.altFt !== null);
    el("path", { d: `${line}L${sx(xOf(altPts[altPts.length - 1])).toFixed(1)},${sa(aLo)}L${sx(xOf(altPts[0])).toFixed(1)},${sa(aLo)}Z`, class: "flightlog__alt-area" }, svg);
    el("path", { d: line, class: "flightlog__alt-line" }, svg);
  }
  if (hasGs) el("path", { d: path(sg, "gsKt"), class: "flightlog__gs-line" }, svg);

  // Hover layer
  const cursor = el("g", { class: "flightlog__cursor", visibility: "hidden" }, svg);
  const vline = el("line", { y1: m.t, y2: m.t + ih }, cursor);
  const aDot = hasAlt ? el("circle", { r: 3.5, class: "flightlog__dot--alt" }, cursor) : null;
  const gDot = hasGs ? el("circle", { r: 3.5, class: "flightlog__dot--gs" }, cursor) : null;
  const hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent" }, svg);

  const tip = document.createElement("div");
  tip.className = "flightlog__tip";
  tip.hidden = true;

  host.replaceChildren(svg, tip);

  const xs = pts.map(xOf);
  const nearest = (v) => {
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; (xs[mid] < v ? (lo = mid) : (hi = mid)); }
    return v - xs[lo] < xs[hi] - v ? lo : hi;
  };

  let listener = () => {};
  const show = (i) => {
    if (i === null) { cursor.setAttribute("visibility", "hidden"); tip.hidden = true; return; }
    const p = pts[i];
    const x = sx(xOf(p));
    vline.setAttribute("x1", x); vline.setAttribute("x2", x);
    if (aDot && p.altFt !== null) { aDot.setAttribute("cx", x); aDot.setAttribute("cy", sa(p.altFt)); }
    if (gDot && p.gsKt !== null) { gDot.setAttribute("cx", x); gDot.setAttribute("cy", sg(p.gsKt)); }
    cursor.setAttribute("visibility", "visible");

    const lines = [];
    lines.push(stats.timed ? fmt.timeSZ(p.t) : `${num(p.d, 1)} nm`);
    if (p.altFt !== null) lines.push(`<span class="flightlog__tick--alt">${num(p.altFt)} ft</span>`);
    if (p.gsKt !== null) lines.push(`<span class="flightlog__tick--gs">${num(p.gsKt)} kt</span>`);
    if (stats.timed) lines.push(`${num(p.d, 1)} nm`);
    tip.innerHTML = lines.join("<br>");
    tip.hidden = false;
    const scale = host.clientWidth / W;
    const left = x * scale;
    tip.style.left = `${left}px`;
    tip.style.transform = left > host.clientWidth / 2 ? "translateX(calc(-100% - 10px))" : "translateX(10px)";
  };

  const fromEvent = (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    return nearest(x0 + ((vx - m.l) / iw) * (x1 - x0));
  };
  hit.addEventListener("pointermove", (e) => { const i = fromEvent(e); show(i); listener(i); });
  hit.addEventListener("pointerleave", () => { show(null); listener(null); });

  return {
    show,
    onHover(cb) { listener = cb; },
    onMark(cb) { markListener = cb; },
    setFocus(key) { for (const [k, g] of markEls) g.classList.toggle("is-focus", k === key); },
  };
}

// ---------- annotation legend + links ----------

// key -> function that focuses that annotation and scrolls to its map.
const MARK_REGISTRY = new Map();

// "Start 2,500 ft · Max 2,650 ft · Avg 2,480 ft · Alt ±60 ft · GS ±7 kt" for whichever stats were asked for.
function markFigures(f) {
  if (!f) return "";
  const out = [];
  if (f.startAltFt !== undefined) out.push(`Start ${num(f.startAltFt)} ft`);
  if (f.maxAltFt !== undefined) out.push(`Max ${num(f.maxAltFt)} ft`);
  if (f.avgAltFt !== undefined) out.push(`Avg ${num(f.avgAltFt)} ft`);
  if (f.altDevFt !== undefined) out.push(f.avgAltFt !== undefined ? `Alt ±${num(f.altDevFt)} ft` : `Alt ±${num(f.altDevFt)} ft (avg ${num(f.altAvgFt)})`);
  if (f.gsDevKt !== undefined) out.push(`GS ±${num(f.gsDevKt)} kt (avg ${num(f.gsAvgKt)})`);
  return out.join(" · ");
}

function renderLegend(fig, marks, fmt) {
  const ol = document.createElement("ol");
  ol.className = "flightlog__marks";
  for (const mk of marks) {
    const li = document.createElement("li");
    li.id = mk.key;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.key = mk.key;
    const badge = document.createElement("span");
    badge.className = "flightlog__badge";
    badge.style.setProperty("--c", mk.color);
    badge.textContent = mk.n;
    const time = document.createElement("span");
    time.className = "flightlog__mark-time";
    // Seconds only where the post gave them, so whole-minute marks stay short.
    const tf = /:\d\d:\d\d/.test(`${mk.start} ${mk.end ?? ""}`) ? fmt.timeS : fmt.time;
    const secs = (mk.t1 - mk.t0) / 1000;
    const len = secs < 120 && secs % 60 ? `${Math.round(secs)}s` : duration(secs / 3600);
    time.textContent = mk.t1 === null ? tf(mk.t0) : `${tf(mk.t0)}-${tf(mk.t1)} (${len})`;
    const label = document.createElement("span");
    label.className = "flightlog__mark-label";
    label.textContent = mk.label;
    const figs = markFigures(mk.figures);
    if (figs) {
      const s = document.createElement("span");
      s.className = "flightlog__mark-figures";
      s.textContent = figs;
      label.append(s);
    }
    btn.append(badge, time, label);
    li.append(btn);
    ol.append(li);
  }
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "flightlog__reset";
  reset.textContent = "Show whole flight";
  reset.hidden = true;
  fig.querySelector(".flightlog__profile").after(ol, reset);
  return { ol, reset };
}

// In-page links to an annotation key: focus it instead of jumping to the
// legend. Installed once for all figures.
let linksInstalled = false;
function installMarkLinks() {
  if (linksInstalled) return;
  linksInstalled = true;
  const keyOf = (href) => { try { return decodeURIComponent(href.slice(1)); } catch { return null; } };
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    const focus = a && MARK_REGISTRY.get(keyOf(a.getAttribute("href")));
    if (!focus) return;
    e.preventDefault();
    history.pushState(null, "", a.getAttribute("href"));
    focus(true);
  });
  window.addEventListener("hashchange", () => MARK_REGISTRY.get(keyOf(location.hash))?.(true));
}

// ---------- wiring ----------

function decimate(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(points[Math.floor(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

async function build(fig) {
  const err = fig.querySelector(".flightlog__error");
  try {
    const track = await loadTrack(fig.dataset.src);
    const fmt = timeFormatters(fig.dataset.tz);
    const pts = decimate(track.points, MAX_DRAWN);

    const title = fig.querySelector(".flightlog__title");
    if (!title.textContent.trim()) title.textContent = track.name;

    renderStats(fig.querySelector(".flightlog__stats"), track.stats, fmt);

    const marksSrc = fig.querySelector(".flightlog__marks-src");
    const { marks, problems } = marksSrc
      ? resolveMarks(parseMarks(marksSrc.textContent), track, fig.dataset.tz)
      : { marks: [], problems: [] };

    const profileHost = fig.querySelector(".flightlog__profile");
    let focused = null;
    let profile = renderProfile(profileHost, pts, track.stats, fmt, marks, focused);
    const mapEl = fig.querySelector(".flightlog__map");
    const readout = (p) => [
      track.stats.timed ? fmt.timeSZ(p.t) : null,
      p.altFt !== null ? `<span class="flightlog__tick--alt">${num(p.altFt)} ft</span>` : null,
      p.gsKt !== null ? `<span class="flightlog__tick--gs">${num(p.gsKt)} kt</span>` : null,
    ].filter(Boolean).join(" · ");
    const mapView = await renderMap(mapEl, track.points, marks, readout);
    // A recorded point to the nearest point the profile draws.
    const fullIndex = new Map(track.points.map((p, i) => [p, i]));
    const toDrawn = (p) => track.stats.timed
      ? nearestIndex(pts, p.t)
      : Math.min(pts.length - 1, Math.round(fullIndex.get(p) * (pts.length - 1) / (track.points.length - 1)));

    const legend = marks.length ? renderLegend(fig, marks, fmt) : null;
    const focus = (key, scroll = false) => {
      focused = key;
      mapView.focus(key);
      profile.setFocus(key);
      if (legend) {
        for (const b of legend.ol.querySelectorAll("button")) b.setAttribute("aria-current", String(b.dataset.key === key));
        legend.reset.hidden = key === null;
      }
      if (scroll) mapEl.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    // Clicking a legend item, pin or badge toggles it and keeps the URL's
    // #key in step so the current view can be shared.
    const toggle = (key) => {
      const next = focused === key ? null : key;
      history.replaceState(null, "", next ? `#${encodeURIComponent(next)}` : location.pathname + location.search);
      focus(next);
    };
    if (legend) {
      legend.ol.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) toggle(b.dataset.key); });
      legend.reset.addEventListener("click", () => toggle(focused));
    }
    for (const mk of marks) {
      MARK_REGISTRY.set(mk.key, (scroll) => focus(mk.key, scroll));
      // Links in the post to this annotation pick up its color.
      for (const a of document.querySelectorAll(`a[href="#${CSS.escape(mk.key)}"]`)) a.style.setProperty("--c", mk.color);
    }
    installMarkLinks();

    const link = () => {
      profile.onHover((i) => mapView.show(i === null ? null : pts[i]));
      profile.onMark(toggle);
      mapView.onHover((p) => { profile.show(p === null ? null : toDrawn(p)); mapView.show(p); });
      mapView.onMark(toggle);
    };
    link();

    if (problems.length) {
      err.textContent = `Annotation problems: ${problems.join("; ")}`;
      err.hidden = false;
      console.warn("[flightlog]", problems);
    }
    const initial = marks.find((mk) => `#${encodeURIComponent(mk.key)}` === location.hash);
    if (initial) focus(initial.key, true);

    // Redraw the profile at the new width; the SVG is sized in pixels so
    // text stays crisp rather than scaling with the container.
    let lastW = profileHost.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(profileHost.clientWidth - lastW) < 2) return;
      lastW = profileHost.clientWidth;
      profile = renderProfile(profileHost, pts, track.stats, fmt, marks, focused);
      link();
      mapView.map.invalidateSize();
    }).observe(profileHost);
  } catch (e) {
    err.textContent = `Couldn't show this flight: ${e.message}`;
    err.hidden = false;
    console.error("[flightlog]", e);
  }
}

document.querySelectorAll('figure[data-applet="flightlog"][data-src]').forEach((fig) => {
  if (fig.dataset.built) return;
  fig.dataset.built = "1";
  build(fig);
});
