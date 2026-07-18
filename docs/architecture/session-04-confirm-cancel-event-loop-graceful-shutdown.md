# Session 04 — Confirm/Cancel Flows, Idempotency Hardening, Event Loop, Graceful Shutdown

## What Was Built in This Session

### Files Created

```
src/modules/orders/application/use-cases/
  confirm-order.use-case.ts         ← ConfirmOrderUseCase: confirm reservation then order, compensating cancel on failure
  confirm-order.use-case.spec.ts    ← 5 tests: happy path, order not found, ConflictException, NotFoundException, infra error
  cancel-order.use-case.ts          ← CancelOrderUseCase: domain guard → release reservation → save
  cancel-order.use-case.spec.ts     ← 3 tests: happy path, order not found, CONFIRMED order domain violation

docs/nodejs-in-depth/
  event-loop.md                     ← Full event loop reference: libuv, phases, microtask queue, worker threads, interview Q&A
```

### Files Modified

```
src/modules/orders/
  http/orders.controller.ts                           ← added POST /orders/:id/confirm and POST /orders/:id/cancel (204 No Content)
  orders.module.ts                                    ← registered ConfirmOrderUseCase and CancelOrderUseCase as providers
  infrastructure/persistence/prisma-order.repository.ts ← idempotency race hardening: catch P2002 on idempotencyKey only

src/main.ts                                           ← SIGTERM timeout guard (10s), registered before app.listen()
```

---

## Key Decisions Made

### 1. Try-catch scope in ConfirmOrderUseCase must be narrow

**Decision:** The try-catch wraps only `confirmReservationUseCase.execute()`, not `order.confirm()` or `orderRepository.save()`.

**Why it matters:** A broad try-catch covering the order save would trigger the compensating cancel logic on a DB timeout — a case where the reservation was already confirmed but saving the order failed. That produces a CONFIRMED reservation + CANCELLED order, which is worse than the original failure (at least PENDING is retryable).

```typescript
try {
  await this.confirmReservationUseCase.execute({ reservationId: order.reservationId });
} catch (error) {
  if (error instanceof NotFoundException || error instanceof ConflictException) {
    order.cancel();
    await this.orderRepository.save(order);
  }
  throw error; // re-throw — including infra errors
}
order.confirm();
await this.orderRepository.save(order);
```

### 2. Only domain-meaningful exceptions trigger the compensating cancel

**Decision:** Only `NotFoundException` (reservation missing) and `ConflictException` (expired, wrong status) trigger `order.cancel()`. Generic `Error` and infrastructure exceptions propagate without touching the order.

**Why:** A DB timeout or network error leaves the reservation state unknown. Cancelling the order in that case is an irreversible guess. The order stays PENDING and the client can retry.

**Interview insight:** This is manual saga error handling. Each compensating action should only fire when you know the step is permanently failed — not on transient failures.

### 3. Domain guard runs before reservation release in CancelOrderUseCase

**Decision:** `order.cancel()` is called before `releaseReservationUseCase.execute()`.

**Why:** `order.cancel()` throws if the order is CONFIRMED. If you released the reservation first and the cancel guard then threw, stock would be returned to the pool while the order sits in CONFIRMED state — a sold item with released stock. Domain invariant enforcement must precede any side effects.

### 4. Save after release in CancelOrderUseCase

**Decision:** `orderRepository.save(order)` is called after `releaseReservationUseCase.execute()`, not before.

**Why:** Save-before-release means a failed release leaves the order CANCELLED in DB with stock unreturned — no retry path. Save-after-release means a failed release leaves the order PENDING in DB — the cancel can be retried. PENDING is always the recoverable state.

**The dual-write tradeoff:** both orderings have an inconsistency window. The chosen ordering minimises irrecoverability.

### 5. Idempotency race: catch P2002 scoped to idempotencyKey only

**Decision:** In `PrismaOrderRepository.save()`, catch `PrismaClientKnownRequestError` with code `P2002` only when `error.meta.target` contains `idempotencyKey`.

**Why:** The `orders` table has two unique constraints — `id` (primary key) and `idempotencyKey`. A P2002 on `id` is a UUID collision — a genuine bug that must surface, not be swallowed. Only a P2002 on `idempotencyKey` indicates a safe concurrent duplicate.

```typescript
const isIdempotencyKeyConflict =
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002' &&
  (error.meta?.target as string[])?.includes('idempotencyKey');

if (isIdempotencyKeyConflict) return;
throw error;
```

### 6. SIGTERM timeout guard registered before app.listen()

**Decision:** `process.on('SIGTERM', ...)` is registered before `await app.listen()`.

**Why:** If a signal arrives during the async `app.listen()` call, the timeout guard is already in place. Registering handlers after the process starts serving traffic creates a race window — narrow but real in fast-cycling deploys.

---

## Q&A / Interview Prep

### Question 1
> In ConfirmOrderUseCase, should you catch all exceptions from ConfirmReservationUseCase and trigger a compensating cancel?

**Student answer:** Only ConflictException should trigger cancel.

**Correct answer:** Both NotFoundException and ConflictException should trigger cancel — both mean the reservation is permanently unconfirmable. Generic errors (DB timeout, network failure) should not trigger cancel because the reservation's state is unknown. The guard is exception type, not "anything that threw".

**Key insight:** Compensating actions in manual sagas should only fire on permanent failures. Transient infrastructure errors must propagate unchanged so the caller can retry.

---

### Question 2
> A teammate adds synchronous scoring logic after a DB query. Under load, p99 latency on all other endpoints spikes. Why?

**Student answer:** CPU work after async I/O blocks all concurrent threads, causing HTTP timeouts.

**Correct answer:** The single JS thread is occupied running the synchronous filter/sort loop. Node.js has no other thread to handle incoming requests. All concurrent requests stall for the duration of the CPU work — even requests with no relation to the scoring endpoint.

**Key correction:** Node.js has no "concurrent threads" in the JS layer. There is one thread. Calling something `async` does not move CPU work off that thread — it only defers when the synchronous block starts, not where it runs.

**Fix options (in order of preference):**
1. Move the work into the DB query — filter/rank in Postgres, return only top 10.
2. Worker threads with a pool (`piscina`) — moves CPU to a separate OS thread.
3. Chunked `setImmediate` yielding — prevents total starvation without parallelising.

---

### Question 3
> New Worker is created per request for CPU-intensive scoring. Memory climbs continuously under load. What's wrong?

**Student answer:** Worker should be reused with a pool pattern or destroyed before creating a new one.

**Correct answer:** Pool pattern. Worker creation costs ~30ms + script load. Destroy-then-create per request is sequential — requests queue behind each other and startup overhead dominates. A fixed pool (created at startup, size = `os.cpus().length - 1`) reuses workers across requests. `-1` leaves one core for the event loop itself.

---

### Question 4
> SIGTERM fires, but there's a 2-3 second window where traffic can still arrive before the load balancer propagates the endpoint removal. How do you handle it?

**Student answer:** It's a Kubernetes concern, not application code.

**Correct answer:** Correct. The solution is a `preStop` lifecycle hook in the pod spec:
```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "5"]
```
K8s executes `preStop` before sending SIGTERM. The sleep gives the load balancer time to drain traffic. By the time the app receives SIGTERM, no new connections are being routed to it. `terminationGracePeriodSeconds` must exceed `preStop` duration + max shutdown time.

---

## Current Working State

- **44 unit tests passing** across 8 test suites — zero failures
- **TypeScript compiles clean** — zero errors (`tsc --noEmit`)
- **App boots cleanly** with all modules initialised
- **Swagger** at `http://localhost:3000/api` — 5 endpoints:
  - `POST /inventory/products`
  - `POST /inventory/products/:productId/reserve`
  - `POST /orders`
  - `POST /orders/:id/confirm`
  - `POST /orders/:id/cancel`
- **Graceful shutdown** wired: `enableShutdownHooks()` + SIGTERM timeout guard + `PrismaService.onModuleDestroy()`
- **Event loop reference doc** at `docs/nodejs-in-depth/event-loop.md`

---

## What Comes Next (Session 05)

1. **Exception filter** — map domain errors (`Error` thrown by aggregates) to correct HTTP status codes. Currently `order.cancel()` on a CONFIRMED order surfaces as 500. Needs a `DomainExceptionFilter` that maps to 409.
2. **Load test** — `autocannon` or `k6`, 500 concurrent users against one product. Observe: out-of-stock failure mode, connection pool behaviour, p99 latency under contention.
3. **Outbox pattern** — introduce the concept: why `PlaceOrderUseCase` dual-write (reserve + create order) is a reliability gap, and how writing a `FlashSaleOrderRequested` event to the same DB transaction solves it.
4. **LLM integration** — start the six-phase curriculum: SDK setup, structured outputs, streaming.
