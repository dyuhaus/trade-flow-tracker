const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');
const NEW_WINDOW_MS     = 24 * 60 * 60 * 1000; // 24 hours
const DELTA_WINDOW_MS   = 72 * 60 * 60 * 1000; // 72 hours
const RISING_WINDOW_MS  = 72 * 60 * 60 * 1000; // 72 hours
const PRUNE_AFTER_MS    = 14 * 24 * 60 * 60 * 1000; // 14 days

let state = { tickers: {} };

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (!state.tickers) state.tickers = {};
    }
  } catch (e) {
    console.error('State load failed:', e.message);
    state = { tickers: {} };
  }
}

function save() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch (e) {
    console.error('State save failed:', e.message);
  }
}

function pruneOld(now) {
  for (const [key, entry] of Object.entries(state.tickers)) {
    if (now - (entry.lastUpdate || 0) > PRUNE_AFTER_MS) {
      delete state.tickers[key];
    }
  }
}

function initMetric(value, now) {
  return { max: value, baselineValue: value, baselineTime: now };
}

function updateMetric(metric, current, now) {
  // If window expired (72h since baseline), close it
  const windowActive = metric && (now - metric.baselineTime) <= DELTA_WINDOW_MS;

  if (!metric) {
    return { metric: initMetric(current, now), delta: 0, active: false };
  }

  // Reached new max → reset window
  if (current > metric.max) {
    const newMetric = { max: current, baselineValue: metric.max, baselineTime: now };
    return { metric: newMetric, delta: current - metric.max, active: true };
  }

  if (!windowActive) {
    // Window expired — close and use current as new baseline
    return { metric: { max: metric.max, baselineValue: current, baselineTime: now }, delta: 0, active: false };
  }

  // Window active — compute delta from baseline
  const delta = current - metric.baselineValue;
  return { metric, delta, active: true };
}

function recordObservation(namespace, ticker, current, now = Date.now()) {
  const key = `${namespace}:${ticker}`;
  const prev = state.tickers[key];

  // Numeric fields to track
  const fields = ['count', 'shares', 'price', 'value'];

  if (!prev) {
    // First time seeing this ticker
    const metrics = {};
    for (const f of fields) metrics[f] = initMetric(current[f] || 0, now);
    state.tickers[key] = {
      firstSeen: now,
      lastUpdate: now,
      countIncreases: current.count > 0 ? [now] : [],
      metrics,
      prev: { ...current }
    };
    return {
      isNew: true,
      isRising: false,
      deltas: Object.fromEntries(fields.map(f => [f, { value: 0, active: false }]))
    };
  }

  // Track count increases for rising flag
  let countIncreases = prev.countIncreases || [];
  if ((current.count || 0) > (prev.prev?.count || 0)) {
    countIncreases = [...countIncreases, now];
  }
  // Keep only increases within 72h window
  countIncreases = countIncreases.filter(t => (now - t) <= RISING_WINDOW_MS);

  // Update each metric window
  const deltas = {};
  const newMetrics = {};
  for (const f of fields) {
    const result = updateMetric(prev.metrics[f], current[f] || 0, now);
    newMetrics[f] = result.metric;
    deltas[f] = { value: result.delta, active: result.active };
  }

  state.tickers[key] = {
    firstSeen: prev.firstSeen,
    lastUpdate: now,
    countIncreases,
    metrics: newMetrics,
    prev: { ...current }
  };

  const isNew     = (now - prev.firstSeen) <= NEW_WINDOW_MS;
  const isRising  = countIncreases.length >= 2;

  return { isNew, isRising, deltas };
}

function enrichRows(namespace, rows) {
  const now = Date.now();
  pruneOld(now);
  const enriched = rows.map(row => {
    const obs = recordObservation(namespace, row.ticker, {
      count: row.count || 0,
      shares: row.shares || 0,
      price: row.pricePerShare || row.price || 0,
      value: row.value || 0
    }, now);
    return { ...row, ...obs };
  });
  save();
  return enriched;
}

load();

module.exports = { enrichRows };
