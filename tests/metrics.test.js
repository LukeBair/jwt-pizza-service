const { EventEmitter } = require('events');
const metrics = require('../src/metrics.js');

function run(method, url, status, user) {
  const req = { method, originalUrl: url, user };
  const res = new EventEmitter();
  res.statusCode = status;
  res.json = (b) => b;
  metrics.requestTracker(req, res, () => {});
  res.emit('finish');
}

const val = (list, name, attr) => {
  const m = list.find((x) => x.name === name);
  const dps = (m.sum || m.gauge).dataPoints;
  const dp = attr ? dps.find((d) => d.attributes.some((a) => a.value.stringValue === attr)) : dps[0];
  return dp.asInt ?? dp.asDouble;
};

test('tracks requests, auth, users and pizzas', () => {
  run('GET', '/api/order/menu', 200);
  run('PUT', '/api/auth', 404);
  run('PUT', '/api/auth', 200, { id: 7 });
  metrics.pizzaPurchase(true, 10, 2, 0.1);
  metrics.pizzaPurchase(false, 20, 0, 0);
  const m = metrics.buildMetrics();
  expect(val(m, 'http_requests', 'ALL')).toBe(3);
  expect(val(m, 'http_requests', 'GET')).toBe(1);
  expect(val(m, 'auth_attempts', 'success')).toBe(1);
  expect(val(m, 'auth_attempts', 'failure')).toBe(1);
  expect(val(m, 'active_users')).toBe(1);
  expect(val(m, 'pizzas_sold')).toBe(2);
  expect(val(m, 'pizza_failures')).toBe(1);
  run('DELETE', '/api/auth', 200, { id: 7 });
  expect(val(metrics.buildMetrics(), 'active_users')).toBe(0);
});
