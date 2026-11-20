// Reed-Solomon shard visualizer.
//
// Model-only: this does NOT perform real Reed-Solomon encoding/decoding
// (no Galois-field arithmetic, no matrix inversion). It models the SHAPE
// of the problem — shard sizes, padding, and the "any k of n shards
// suffice" decodability rule — so a reader can build intuition without
// needing to understand GF(2^8) math.
//
// Convention for future applets: this module is a plain ES module with
// no dependencies. It finds its own root element via a `data-applet`
// attribute (never assumes it's the only applet on the page) and no-ops
// if that root isn't present. Module scripts are deferred until after
// DOM parsing, so top-level `document.querySelector` calls here are safe
// with no DOMContentLoaded wrapper.

const MAX_N = 5000; // deliberately generous cap on k+m — the grid just wraps into more rows
const COMPACT_THRESHOLD = 128; // above this many shards, switch to smaller unlabeled cells

const DEFAULTS = {
  k: 10,
  m: 4,
  sizeValue: 10,
  sizeUnit: 1048576, // MiB, binary units throughout
  lossPercent: 0,
};

const state = {
  k: DEFAULTS.k,
  m: DEFAULTS.m,
  sizeValue: DEFAULTS.sizeValue,
  sizeUnit: DEFAULTS.sizeUnit,
  lossPercent: DEFAULTS.lossPercent,
  lostSet: new Set(),
};

// ---------------------------------------------------------------------
// Pure math — no DOM access, safe to reason about in isolation.
// ---------------------------------------------------------------------

function objectSizeBytes(sizeValue, sizeUnit) {
  return sizeValue * sizeUnit;
}

// Shards must all be equal size, so the last data shard (and by
// extension every parity shard) is padded up to shardSize.
function computeLayout(totalBytes, k) {
  const shardSize = Math.ceil(totalBytes / k);
  const padding = shardSize * k - totalBytes;
  return { shardSize, padding };
}

function computeTransmitted(shardSize, k, m, totalBytes) {
  const transmittedBytes = shardSize * (k + m);
  const overheadRatio = totalBytes > 0 ? transmittedBytes / totalBytes : null;
  return { transmittedBytes, overheadRatio };
}

// Uniformly picks `count` distinct indices out of [0, n) via a partial
// Fisher-Yates shuffle. `rng` is injectable (defaults to Math.random)
// so the selection logic stays testable/describable without a runner.
function pickRandomLost(n, percent, rng = Math.random) {
  const count = Math.round((percent / 100) * n);
  const pool = Array.from({ length: n }, (_, i) => i);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (n - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return new Set(pool.slice(0, count));
}

// Decodability only depends on HOW MANY shards survive, not which —
// that's the whole point of the demo. The recovery *path* is the one
// place identity matters: if all k data shards survived untouched,
// recovery is a cheap concatenation; otherwise it requires
// reconstruction from parity.
function classifyOutcome(k, m, lostSet) {
  const survivors = k + m - lostSet.size;
  const needed = k;
  const decodable = survivors >= needed;
  if (!decodable) {
    return { decodable, path: "not-decodable", survivors, needed, slack: null };
  }
  let anyDataLost = false;
  for (let i = 0; i < k; i++) {
    if (lostSet.has(i)) {
      anyDataLost = true;
      break;
    }
  }
  const path = anyDataLost ? "reconstruction" : "concatenation";
  return { decodable, path, survivors, needed, slack: survivors - needed };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const decimals = unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

// Validates k/m as entered. Non-integer values are corrected in place
// (a light UX clamp); k+m exceeding MAX_N is surfaced as an explicit
// message instead, since silently clamping the sum would hide the
// reader's actual input from them.
function validateDimensions(k, m) {
  if (!Number.isFinite(k) || k < 1) {
    return { ok: false, message: "k must be at least 1." };
  }
  if (!Number.isFinite(m) || m < 0) {
    return { ok: false, message: "m must be 0 or greater." };
  }
  if (k + m > MAX_N) {
    return {
      ok: false,
      message: `k + m = ${k + m} exceeds the maximum of ${MAX_N} shards this visualization supports. Reduce k or m.`,
    };
  }
  return { ok: true, message: "" };
}

// ---------------------------------------------------------------------
// Rendering — DOM-only, takes the root element plus already-computed data.
// ---------------------------------------------------------------------

function renderGrid(root, k, m, lostSet) {
  const grid = root.querySelector(".rs-grid");
  grid.innerHTML = "";
  const n = k + m;
  // Above COMPACT_THRESHOLD shards the full-size grid gets unwieldy, so
  // cells shrink and drop their per-cell text label (identity is still
  // available via the title tooltip on hover).
  const compact = n > COMPACT_THRESHOLD;
  grid.classList.toggle("applet__grid--compact", compact);
  for (let i = 0; i < n; i++) {
    const cell = document.createElement("div");
    const isData = i < k;
    const isLost = lostSet.has(i);
    cell.className = "applet__grid-cell" +
      (isData ? " applet__grid-cell--data" : " applet__grid-cell--parity") +
      (isLost ? " applet__grid-cell--lost" : "");
    const kind = isData ? "data" : "parity";
    const label = isData ? `d${i}` : `p${i - k}`;
    cell.title = `shard ${i} (${kind})${isLost ? ", lost" : ""}`;
    cell.textContent = isLost ? "×" : (compact ? "" : label);
    grid.appendChild(cell);
  }
}

function renderStats(root, layout, transmitted, totalBytes) {
  root.querySelector(".rs-stat-shard-size").textContent = formatBytes(layout.shardSize);
  root.querySelector(".rs-stat-padding").textContent = formatBytes(layout.padding);
  root.querySelector(".rs-stat-transmitted").textContent =
    `${formatBytes(transmitted.transmittedBytes)} (of ${formatBytes(totalBytes)} original)`;
  root.querySelector(".rs-stat-overhead").textContent =
    transmitted.overheadRatio === null ? "—" : `${transmitted.overheadRatio.toFixed(2)}×`;
}

const VERDICT_COPY = {
  concatenation: "Decodable by concatenation",
  reconstruction: "Decodable by reconstruction",
  "not-decodable": "Not decodable",
};

function renderVerdict(root, outcome) {
  const verdict = root.querySelector(".rs-verdict");
  const headline = root.querySelector(".rs-verdict-headline");
  const detail = root.querySelector(".rs-verdict-detail");
  const state = outcome.decodable ? `decodable-${outcome.path}` : "not-decodable";
  verdict.dataset.state = state;
  headline.textContent = VERDICT_COPY[outcome.path];
  if (outcome.decodable) {
    detail.textContent =
      `${outcome.survivors} of ${outcome.needed} needed shards survive — ` +
      `could lose ${outcome.slack} more and still decode.`;
  } else {
    detail.textContent = `${outcome.survivors} of ${outcome.needed} needed shards survive.`;
  }
}

function renderError(root, message) {
  const errorEl = root.querySelector(".rs-error");
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  } else {
    errorEl.textContent = "";
    errorEl.hidden = true;
  }
  const verdict = root.querySelector(".rs-verdict");
  if (message) {
    verdict.dataset.state = "invalid";
    root.querySelector(".rs-verdict-headline").textContent = "-";
    root.querySelector(".rs-verdict-detail").textContent = "";
    root.querySelector(".rs-grid").innerHTML = "";
    for (const id of ["shard-size", "padding", "transmitted", "overhead"]) {
      root.querySelector(`.rs-stat-${id}`).textContent = "-";
    }
  }
}

// ---------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------

function recomputeAll(root) {
  const validation = validateDimensions(state.k, state.m);
  if (!validation.ok) {
    renderError(root, validation.message);
    return;
  }
  renderError(root, "");

  const totalBytes = objectSizeBytes(state.sizeValue, state.sizeUnit);
  const layout = computeLayout(totalBytes, state.k);
  const transmitted = computeTransmitted(layout.shardSize, state.k, state.m, totalBytes);
  const outcome = classifyOutcome(state.k, state.m, state.lostSet);

  renderGrid(root, state.k, state.m, state.lostSet);
  renderStats(root, layout, transmitted, totalBytes);
  renderVerdict(root, outcome);
}

function rerollLost(root) {
  state.lostSet = pickRandomLost(state.k + state.m, state.lossPercent);
}

function wireEvents(root) {
  const kInput = root.querySelector(".rs-input-k");
  const mInput = root.querySelector(".rs-input-m");
  const sizeInput = root.querySelector(".rs-input-size");
  const unitSelect = root.querySelector(".rs-input-unit");
  const lossSlider = root.querySelector(".rs-input-loss");
  const lossValueLabel = root.querySelector(".rs-loss-value");
  const rerollBtn = root.querySelector(".rs-reroll-btn");

  function updateRerollDisabled() {
    rerollBtn.disabled = state.lossPercent === 0 || state.lossPercent === 100;
  }

  kInput.addEventListener("change", () => {
    const value = Math.round(Number(kInput.value));
    state.k = Number.isFinite(value) ? Math.max(value, 1) : DEFAULTS.k;
    kInput.value = state.k;
    rerollLost(root);
    recomputeAll(root);
  });

  mInput.addEventListener("change", () => {
    const value = Math.round(Number(mInput.value));
    state.m = Number.isFinite(value) ? Math.max(value, 0) : DEFAULTS.m;
    mInput.value = state.m;
    rerollLost(root);
    recomputeAll(root);
  });

  sizeInput.addEventListener("input", () => {
    const value = Number(sizeInput.value);
    state.sizeValue = Number.isFinite(value) && value >= 0 ? value : 0;
    recomputeAll(root);
  });

  unitSelect.addEventListener("change", () => {
    state.sizeUnit = Number(unitSelect.value);
    recomputeAll(root);
  });

  lossSlider.addEventListener("input", () => {
    state.lossPercent = Number(lossSlider.value);
    lossValueLabel.textContent = state.lossPercent;
    updateRerollDisabled();
    rerollLost(root);
    recomputeAll(root);
  });

  rerollBtn.addEventListener("click", () => {
    rerollLost(root);
    recomputeAll(root);
  });

  updateRerollDisabled();
}

function init() {
  const root = document.querySelector('[data-applet="reed-solomon"]');
  if (!root) return;

  root.querySelector(".rs-input-k").value = DEFAULTS.k;
  root.querySelector(".rs-input-m").value = DEFAULTS.m;
  root.querySelector(".rs-input-size").value = DEFAULTS.sizeValue;
  root.querySelector(".rs-input-unit").value = String(DEFAULTS.sizeUnit);
  root.querySelector(".rs-input-loss").value = DEFAULTS.lossPercent;
  root.querySelector(".rs-loss-value").textContent = DEFAULTS.lossPercent;

  rerollLost(root);
  recomputeAll(root);
  wireEvents(root);
}

init();
