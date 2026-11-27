// Delivery-probability table for a Reed-Solomon (k, m) coding rate.
//
// Companion to the reed-solomon shard visualizer above it in the post: that
// applet lets you pick one loss rate and see whether a specific set of
// dropped shards happens to be decodable. This one fixes k and m and sweeps
// the loss rate, computing the exact probability of successful delivery
// (and its complement) at each point via the binomial distribution.
//
// Model: each of the n = k+m shards is lost independently with probability
// L (an i.i.d. Bernoulli model — see the post text for why real, bursty
// network loss doesn't actually behave this way). Delivery succeeds iff at
// least k of the n shards survive, so for survivors X ~ Binomial(n, 1-L):
//
//   P(success) = P(X >= k) = sum_{i=k}^{n} C(n,i) (1-L)^i L^(n-i)
//
// Computed in log-space (see logPmfArray) so it stays numerically stable
// even for large n, where C(n,i) itself would overflow a 64-bit float long
// before the final probability does.

const MAX_N = 5000; // matches the reed-solomon applet's cap; O(n) work per row, so cheap either way

const DEFAULTS = {
  k: 10,
  m: 4,
};

const state = {
  k: DEFAULTS.k,
  m: DEFAULTS.m,
};

// A curated spread rather than a fixed step size: dense near the low end,
// where real links usually sit, and thinning out toward the (mostly
// academic) high-loss extreme.
const LOSS_STEPS_PERCENT = [
  0, 1, 2, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 95, 99,
];

// ---------------------------------------------------------------------
// Pure math — no DOM access, safe to reason about in isolation.
// ---------------------------------------------------------------------

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
      message: `k + m = ${k + m} exceeds the maximum of ${MAX_N} shards this table supports. Reduce k or m.`,
    };
  }
  return { ok: true, message: "" };
}

// log(pmf(i)) for i = 0..n, where pmf is the Binomial(n, survivalProb) pmf.
// Built incrementally via the standard C(n,i) = C(n,i-1) * (n-i+1)/i
// recurrence, kept entirely in log-space so neither the binomial
// coefficient nor the probability terms ever overflow/underflow a double,
// no matter how large n gets.
function logPmfArray(n, logSurvival, logLoss) {
  const logPmf = new Array(n + 1);
  let logChoose = 0; // log C(n, 0)
  logPmf[0] = n * logLoss; // i=0: C(n,0) * survival^0 * loss^n
  for (let i = 1; i <= n; i++) {
    logChoose += Math.log(n - i + 1) - Math.log(i);
    logPmf[i] = logChoose + i * logSurvival + (n - i) * logLoss;
  }
  return logPmf;
}

// Sums exp(logPmf[i]) for i in [from, to] via log-sum-exp, so the summation
// itself doesn't reintroduce the overflow/underflow logPmfArray avoided.
function tailSum(logPmf, from, to) {
  let maxLog = -Infinity;
  for (let i = from; i <= to; i++) {
    if (logPmf[i] > maxLog) maxLog = logPmf[i];
  }
  if (maxLog === -Infinity) return 0;
  let sum = 0;
  for (let i = from; i <= to; i++) {
    sum += Math.exp(logPmf[i] - maxLog);
  }
  return Math.exp(maxLog) * sum;
}

// P(success) and P(failure) for one loss rate. survivalProb of exactly 0 or
// 1 is handled directly rather than through logPmfArray, since log(0) there
// would otherwise multiply out to a NaN (0 * -Infinity) for the i = n term.
function outcomeProbabilities(n, k, survivalProb) {
  if (survivalProb >= 1) return { success: 1, failure: 0 };
  if (survivalProb <= 0) return { success: 0, failure: 1 };
  const logSurvival = Math.log(survivalProb);
  const logLoss = Math.log(1 - survivalProb);
  const logPmf = logPmfArray(n, logSurvival, logLoss);
  return {
    success: tailSum(logPmf, k, n),
    failure: tailSum(logPmf, 0, k - 1),
  };
}

// Overhead depends only on k and m (it's the same for every row), so it's
// rendered once next to the inputs rather than repeated per row.
function overheadRatio(k, m) {
  return (k + m) / k;
}

function tierFor(success) {
  if (success >= 0.999) return "good";
  if (success >= 0.9) return "warn";
  return "bad";
}

// Success is rounded to a plain 2 decimals — once it's indistinguishable
// from 100% at that precision, the failure column (see below) is where the
// remaining detail actually lives.
function formatSuccessPercent(p) {
  return `${(p * 100).toFixed(2)}%`;
}

// Failure is usually the small, interesting number, so it gets adaptive
// precision: fixed-point while it's still legible, scientific notation once
// fixed-point would round it away to "0.0000%".
function formatFailurePercent(p) {
  if (p <= 0) return "0%";
  const pct = p * 100;
  if (pct >= 0.0001) return `${pct.toFixed(4)}%`;
  return `${pct.toExponential(2)}%`;
}

// Expresses failure probability as "1 in N" blocks, which is more visceral
// than a percentage once failure gets rare. N is rounded to 3 significant
// figures and comma-grouped once it's large enough that exact digits stop
// being meaningful.
function formatOneInX(p) {
  if (p <= 0) return ">1 million blocks";
  const n = 1 / p;
  if (n >= 1e6) return ">1 million blocks";
  const rounded = Number(n.toPrecision(3));
  return `${rounded.toLocaleString("en-US")} blocks`;
}

// ---------------------------------------------------------------------
// Rendering — DOM-only, takes the root element plus already-computed data.
// ---------------------------------------------------------------------

function renderTable(root, k, n) {
  const tbody = root.querySelector(".dp-table-body");
  tbody.innerHTML = "";
  for (const lossPercent of LOSS_STEPS_PERCENT) {
    const survivalProb = 1 - lossPercent / 100;
    const { success, failure } = outcomeProbabilities(n, k, survivalProb);

    const row = document.createElement("tr");
    row.dataset.tier = tierFor(success);

    const lossCell = document.createElement("td");
    lossCell.textContent = `${lossPercent}%`;

    const successCell = document.createElement("td");
    successCell.textContent = formatSuccessPercent(success);

    const failureCell = document.createElement("td");
    failureCell.textContent = formatFailurePercent(failure);

    const oneInXCell = document.createElement("td");
    oneInXCell.textContent = formatOneInX(failure);

    row.append(lossCell, successCell, failureCell, oneInXCell);
    tbody.appendChild(row);
  }
}

function renderOverhead(root, k, m) {
  root.querySelector(".dp-stat-overhead").textContent = `${overheadRatio(k, m).toFixed(2)}×`;
}

function renderError(root, message) {
  const errorEl = root.querySelector(".dp-error");
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    root.querySelector(".dp-table-body").innerHTML = "";
    root.querySelector(".dp-stat-overhead").textContent = "-";
  } else {
    errorEl.textContent = "";
    errorEl.hidden = true;
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
  renderOverhead(root, state.k, state.m);
  renderTable(root, state.k, state.k + state.m);
}

function wireEvents(root) {
  const kInput = root.querySelector(".dp-input-k");
  const mInput = root.querySelector(".dp-input-m");

  kInput.addEventListener("change", () => {
    const value = Math.round(Number(kInput.value));
    state.k = Number.isFinite(value) ? Math.max(value, 1) : DEFAULTS.k;
    kInput.value = state.k;
    recomputeAll(root);
  });

  mInput.addEventListener("change", () => {
    const value = Math.round(Number(mInput.value));
    state.m = Number.isFinite(value) ? Math.max(value, 0) : DEFAULTS.m;
    mInput.value = state.m;
    recomputeAll(root);
  });
}

function init() {
  const root = document.querySelector('[data-applet="delivery-probability"]');
  if (!root) return;

  root.querySelector(".dp-input-k").value = DEFAULTS.k;
  root.querySelector(".dp-input-m").value = DEFAULTS.m;

  recomputeAll(root);
  wireEvents(root);
}

init();
