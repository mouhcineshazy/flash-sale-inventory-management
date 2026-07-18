# Node.js Event Loop — In Depth

## The Mental Model Shift (from Java/Spring)

| | Java / Spring | Node.js |
|---|---|---|
| Concurrency model | Thread-per-request | Single-threaded event loop |
| DB query | Thread blocks and parks | Callback registered, thread returned |
| 500 concurrent requests | 500 threads (~500MB stack) | 500 callbacks, 1 thread |
| CPU-bound work | Runs on its own thread | Blocks the entire event loop |
| Failure mode | Thread pool exhaustion | Event loop starvation |

In Spring, a blocked thread costs memory but doesn't affect other threads. In Node, any synchronous work on the main thread stalls every concurrent request — there is only one thread.

---

## libuv — the async engine underneath Node.js

Node.js delegates all async I/O to **libuv**, a C library that wraps OS-level async primitives:

- **Network I/O** (TCP, HTTP — e.g., Prisma DB queries): uses `epoll` (Linux) / `kqueue` (macOS) / `IOCP` (Windows). The OS notifies Node when data is ready. **No thread pool consumed.**
- **File system, DNS, some crypto**: blocking-only OS APIs. libuv runs these on its own **thread pool** (default: 4 threads, tunable via `UV_THREADPOOL_SIZE`).

**Implication for this project:** `prisma.order.findUnique()` uses a TCP socket → pure event loop callback, zero thread pool. `dns.lookup()` or `fs.readFile()` consumes a libuv thread — relevant when diagnosing pool exhaustion under load.

---

## The Event Loop — 6 Phases

Each full iteration ("tick") runs these phases in order:

```
   ┌─────────────────────────────┐
   │           timers            │  setTimeout / setInterval callbacks whose delay has elapsed
   └──────────────┬──────────────┘
                  │  microtasks drain here
   ┌──────────────▼──────────────┐
   │       pending callbacks     │  I/O error callbacks deferred from the previous tick
   └──────────────┬──────────────┘
                  │  microtasks drain here
   ┌──────────────▼──────────────┐
   │        idle / prepare       │  internal use only — ignore
   └──────────────┬──────────────┘
   ┌──────────────▼──────────────┐
   │            poll             │  retrieve new I/O events, execute their callbacks
   └──────────────┬──────────────┘  if no timers/setImmediate pending: block here waiting for I/O
                  │  microtasks drain here
   ┌──────────────▼──────────────┐
   │            check            │  setImmediate callbacks
   └──────────────┬──────────────┘
                  │  microtasks drain here
   ┌──────────────▼──────────────┐
   │        close callbacks      │  socket.on('close'), etc.
   └─────────────────────────────┘
```

The **poll phase** is where most work happens. If no timers are pending and no `setImmediate` is queued, Node blocks here waiting for I/O — achieving near-zero CPU at idle without a busy loop.

---

## Microtask Queue — Runs Between Every Phase

Two queues drain between every phase transition and after every individual callback:

1. **`process.nextTick()`** — drains completely first, highest priority
2. **Promise microtasks** (`.then()`, `await`) — drains after nextTick queue is empty

```js
setTimeout(() => console.log('timer'), 0);
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');

// Output:
// sync
// nextTick
// promise
// timer
```

**Danger:** if `process.nextTick` recursively schedules itself, it starves the entire event loop — no I/O callbacks ever run. Same risk with a Promise chain that never resolves to an actual I/O operation.

---

## Scheduling Callbacks — Comparison

| API | When it runs | Common use case |
|---|---|---|
| `process.nextTick(fn)` | After current operation, before any I/O or phase transition | Emit events after constructor returns; propagate errors async-safely |
| `Promise.resolve().then(fn)` | After nextTick queue, before next I/O phase | Standard async code — just use `await` |
| `setImmediate(fn)` | Check phase, after I/O callbacks in current iteration | Run something after I/O callbacks complete |
| `setTimeout(fn, 0)` | Timers phase, next iteration | Loose "run later" — ordering vs setImmediate is non-deterministic at startup |

**`setImmediate` vs `setTimeout(fn, 0)`:** within an I/O callback, `setImmediate` always fires before `setTimeout(fn, 0)`. Outside an I/O callback (e.g., at the top of a script), the order is non-deterministic.

---

## Production Implications

### 1. Async does not mean non-blocking for CPU work

```typescript
// WRONG — this still blocks the event loop for the full duration of the filter/sort
const results = await Promise.resolve().then(() =>
  products.filter(p => scoringEngine.score(p, userId) > 0.8).sort(...)
);
```

Wrapping synchronous CPU work in a Promise defers *when* it starts, but not *where* it runs. Once the microtask fires, the synchronous loop runs on the main thread and blocks everything else.

**Rule:** "async" in Node.js means I/O-bound, waiting on a callback. It does not mean parallel.

### 2. CPU-bound work blocks all concurrent requests

```typescript
// scoringEngine.score() is sync, 0.1ms per product, 50,000 products = 5 seconds
// During those 5 seconds: zero I/O callbacks run, all HTTP requests stall
async getRecommendations(userId: string) {
  const products = await this.productRepo.findAll();
  return products
    .filter(p => this.scoringEngine.score(p, userId) > 0.8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}
```

Symptoms: p99 latency on *all* endpoints spikes, not just this one.

### 3. This project is I/O-bound — worker threads add no value here

Prisma queries are TCP round-trips. The event loop is idle while waiting for Postgres. Worker threads solve CPU contention, not I/O latency. Reaching for worker threads on an I/O-bound service adds complexity for zero gain.

---

## Worker Threads — When You Actually Need Them

For genuine CPU-bound work (image processing, ML inference, heavy computation):

### Anti-pattern: new Worker per request

```typescript
// BAD — worker startup costs ~30ms, at 200 req/s this overwhelms the process
async function score(products, userId) {
  const worker = new Worker('./scoring-worker.js');
  worker.postMessage({ products, userId });
  return new Promise(resolve => worker.on('message', resolve));
}
```

Worker creation is expensive. Requests process sequentially if you destroy before creating the next.

### Correct pattern: worker pool

```typescript
import Piscina from 'piscina';
import os from 'os';

// Created once at module init
const pool = new Piscina({
  filename: './scoring-worker.js',
  maxThreads: os.cpus().length - 1,  // leave 1 core for the event loop
});

// Per request — borrows a worker, returns it automatically when done
const top10 = await pool.run({ products, userId });
```

`piscina` maintains a fixed pool, queues work when all workers are busy, and reuses workers across requests. The `-1` prevents the worker pool from saturating the CPU and starving the event loop's own scheduling.

---

## Interview Quick-Fire

**Q: You add `async` to a CPU-intensive function. Does it stop blocking the event loop?**
No. `async` makes the function return a Promise. The synchronous work inside still runs on the main thread.

**Q: What's the difference between `process.nextTick` and `setImmediate`?**
`nextTick` runs before any I/O callbacks, before the next event loop phase. `setImmediate` runs in the check phase, after I/O callbacks in the current iteration.

**Q: A Node.js service handles 500 req/s with no CPU work. What's the thread count?**
1 JS thread (event loop) + up to 4 libuv threads for blocking I/O (DNS, fs). HTTP and DB queries consume zero libuv threads.

**Q: How do you fix event loop starvation from a `process.nextTick` recursive loop?**
Replace with `setImmediate` — it yields to I/O between iterations instead of draining the entire microtask queue.

**Q: When would you use `UV_THREADPOOL_SIZE`?**
When your app makes heavy use of `fs`, `dns`, or `crypto` concurrently and you observe libuv pool exhaustion. Default is 4; max is 1024. Only tune after profiling.
