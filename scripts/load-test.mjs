// Load test script — fires N concurrent POST /orders requests and reports per-request timing.
// Each request uses a unique idempotency key simulating a distinct user checkout.
// Usage: node scripts/load-test.mjs <productId> <concurrency>
// Example: node scripts/load-test.mjs f286e44a-6bb9-4d2f-aa5b-0acba282d320 150

import http from 'http';
import { randomUUID } from 'crypto';

const [, , productId, concurrencyArg] = process.argv;
const CONCURRENCY = parseInt(concurrencyArg ?? '150', 10);

if (!productId) {
  console.error('Usage: node scripts/load-test.mjs <productId> [concurrency]');
  process.exit(1);
}

// Uses http.request directly to bypass undici's per-origin connection limit.
// Each request gets a unique userId and idempotencyKey — simulating distinct users.
function placeOrder(index) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      productId,
      userId: randomUUID(),
      quantity: 1,
      idempotencyKey: randomUUID(),
    });
    const start = performance.now();

    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/orders',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const elapsed = Math.round(performance.now() - start);
        try {
          resolve({ index, status: res.statusCode, elapsed, body: JSON.parse(data) });
        } catch {
          resolve({ index, status: res.statusCode, elapsed, raw: data });
        }
      });
    });

    req.on('error', (err) => {
      const elapsed = Math.round(performance.now() - start);
      resolve({ index, status: 0, elapsed, error: err.message });
    });

    req.write(body);
    req.end();
  });
}

console.log(`\nFiring ${CONCURRENCY} concurrent POST /orders for product ${productId}\n`);

const start = performance.now();
const results = await Promise.all(
  Array.from({ length: CONCURRENCY }, (_, i) => placeOrder(i)),
);
const totalMs = Math.round(performance.now() - start);

// Group by status
const byStatus = results.reduce((acc, r) => {
  acc[r.status] = acc[r.status] ?? [];
  acc[r.status].push(r);
  return acc;
}, {});

// Per-status summary
for (const [status, group] of Object.entries(byStatus).sort()) {
  const times = group.map((r) => r.elapsed).sort((a, b) => a - b);
  const min = times[0];
  const max = times[times.length - 1];
  const p50 = times[Math.floor(times.length * 0.5)];
  const p99 = times[Math.floor(times.length * 0.99)];
  const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
  const label =
    status === '201' ? '201 (reserved ✓)' :
    status === '409' ? '409 (out of stock)' :
    status === '500' ? '500 (server error)' :
    status === '0'   ? '  0 (network error)' : status;

  console.log(`${label}  ×${group.length}`);
  console.log(`  min=${min}ms  p50=${p50}ms  p99=${p99}ms  max=${max}ms  avg=${avg}ms`);
}

// Per-request table for the first 20 of each status
for (const [status, group] of Object.entries(byStatus).sort()) {
  if (group.length === 0) continue;
  const label = status === '201' ? 'RESERVED' : status === '409' ? 'OUT-OF-STOCK' : 'ERROR';
  console.log(`\n--- ${label} (first 20 of ${group.length}) ---`);
  console.log('  req#   status   wait(ms)');
  group.slice(0, 20).forEach((r) => {
    console.log(`  #${String(r.index).padStart(3)}   ${r.status}      ${String(r.elapsed).padStart(6)}`);
  });
}

console.log(`\nTotal wall time: ${totalMs}ms`);
