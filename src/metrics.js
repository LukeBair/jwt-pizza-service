const os = require('os');
const config = require('./config.js');

const METHODS = ['ALL', 'GET', 'PUT', 'POST', 'DELETE'];
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;

const state = {
  http: { ALL: 0, GET: 0, PUT: 0, POST: 0, DELETE: 0 },
  auth: { success: 0, failure: 0 },
  pizzasSold: 0,
  pizzaFailures: 0,
  pizzaRevenue: 0,
  latencySum: 0,
  latencyCount: 0,
  pizzaLatencySum: 0,
  pizzaLatencyCount: 0,
  activeUsers: new Map(), // userId -> last seen ms
};

function isAuthRequest(req) {
  const path = (req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return path === '/api/auth' ? req.method : null;
}

function requestTracker(req, res, next) {
  const start = Date.now();
  let loginUserId = null;
  const origJson = res.json.bind(res);
  res.json = (body) => {
    if (body && body.user && body.user.id !== undefined) loginUserId = body.user.id;
    return origJson(body);
  };

  res.on('finish', () => {
    try {
      state.http.ALL++;
      if (state.http[req.method] !== undefined) state.http[req.method]++;
      state.latencySum += Date.now() - start;
      state.latencyCount++;

      const authMethod = isAuthRequest(req);
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      if (authMethod === 'PUT' || authMethod === 'POST') {
        state.auth[ok ? 'success' : 'failure']++;
      }

      const now = Date.now();
      if (authMethod === 'DELETE' && ok && req.user && req.user.id !== undefined) {
        state.activeUsers.delete(req.user.id);
      } else if (req.user && req.user.id !== undefined) {
        state.activeUsers.set(req.user.id, now);
      } else if (loginUserId !== null && ok) {
        state.activeUsers.set(loginUserId, now);
      }
    } catch (e) {
      console.log('metrics tracker error', e.message);
    }
  });
  next();
}

function pizzaPurchase(success, latencyMs, pizzaCount, revenue) {
  state.pizzaLatencySum += latencyMs || 0;
  state.pizzaLatencyCount++;
  if (success) {
    state.pizzasSold += pizzaCount;
    state.pizzaRevenue += revenue;
  } else {
    state.pizzaFailures++;
  }
}

function countActiveUsers() {
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  for (const [id, seen] of state.activeUsers) {
    if (seen < cutoff) state.activeUsers.delete(id);
  }
  return state.activeUsers.size;
}

function attrs(extra = {}) {
  const list = [{ key: 'source', value: { stringValue: config.metrics.source } }];
  for (const [key, value] of Object.entries(extra)) list.push({ key, value: { stringValue: String(value) } });
  return list;
}

function point(value, asDouble, extra) {
  return { [asDouble ? 'asDouble' : 'asInt']: value, timeUnixNano: String(BigInt(Date.now()) * 1000000n), attributes: attrs(extra) };
}

function counter(name, points) {
  return { name, unit: '1', sum: { dataPoints: points, aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE', isMonotonic: true } };
}

function gauge(name, points) {
  return { name, unit: '1', gauge: { dataPoints: points } };
}

function buildMetrics() {
  const cpu = (os.loadavg()[0] / os.cpus().length) * 100;
  const mem = ((os.totalmem() - os.freemem()) / os.totalmem()) * 100;
  const avg = (sum, count) => (count ? sum / count : 0);
  const epLatency = avg(state.latencySum, state.latencyCount);
  const pzLatency = avg(state.pizzaLatencySum, state.pizzaLatencyCount);
  state.latencySum = state.latencyCount = state.pizzaLatencySum = state.pizzaLatencyCount = 0;

  return [
    counter('http_requests', METHODS.map((m) => point(state.http[m], false, { method: m }))),
    counter('auth_attempts', ['success', 'failure'].map((s) => point(state.auth[s], false, { status: s }))),
    gauge('active_users', [point(countActiveUsers(), false)]),
    gauge('cpu_usage', [point(cpu, true)]),
    gauge('memory_usage', [point(mem, true)]),
    counter('pizzas_sold', [point(state.pizzasSold, false)]),
    counter('pizza_failures', [point(state.pizzaFailures, false)]),
    counter('pizza_revenue', [point(state.pizzaRevenue, true)]),
    gauge('endpoint_latency_ms', [point(epLatency, true)]),
    gauge('pizza_latency_ms', [point(pzLatency, true)]),
  ];
}

async function sendMetrics() {
  const { endpointUrl, accountId, apiKey } = config.metrics;
  const body = { resourceMetrics: [{ scopeMetrics: [{ metrics: buildMetrics() }] }] };
  const res = await fetch(endpointUrl, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${accountId}:${apiKey}`).toString('base64'),
    },
  });
  if (!res.ok) console.error('Failed to push metrics:', res.status, await res.text());
}

function start() {
  if (process.env.JEST_WORKER_ID || !config.metrics || !config.metrics.endpointUrl) return null;
  const timer = setInterval(() => {
    sendMetrics().catch((e) => console.error('Error sending metrics:', e.message));
  }, 10000);
  timer.unref();
  return timer;
}

start();

module.exports = { requestTracker, pizzaPurchase, buildMetrics, sendMetrics };
