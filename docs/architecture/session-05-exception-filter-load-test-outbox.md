# Session 05 — Exception Filter, Load Test, Outbox Pattern Intro

## What Was Built in This Session

### Files Created

```
src/shared/domain/
  domain.exception.ts                        ← base DomainException extends Error (no NestJS imports)

src/shared/infrastructure/filters/
  domain-exception.filter.ts                 ← @Catch(DomainException) → 409 Conflict response

scripts/
  load-test.mjs                              ← concurrent load test with per-request timing, status breakdown
```

### Files Modified

```
src/modules/inventory/domain/
  product.aggregate.ts                       ← throw DomainException (was: throw new Error)
  reservation.entity.ts                      ← throw DomainException

src/modules/orders/domain/
  order.aggregate.ts                         ← throw DomainException

src/main.ts                                  ← app.useGlobalFilters(new DomainExceptionFilter())

src/shared/infrastructure/database/
  prisma.service.ts                          ← explicit pg.Pool with DB_POOL_MAX env var (was: connectionString only)

src/modules/inventory/application/use-cases/
  reserve-stock.use-case.ts                  ← removed broken $transaction wrapper + PrismaService dependency
  reserve-stock.use-case.spec.ts             ← removed PrismaService mock (no longer injected)
```

---

## Key Decisions Made

### 1. Domain exceptions live in the domain layer with no framework imports

**Decision:** `DomainException extends Error` lives in `src/shared/domain/`. No NestJS, no Prisma imports.

**Why:** The domain layer must stay framework-agnostic. If `DomainException` imported from `@nestjs/common`, every domain unit test would require the NestJS runtime, and the domain would be coupled to the delivery mechanism.

**Mapping to HTTP** happens at the infrastructure boundary via `DomainExceptionFilter` — the domain throws, the filter translates. This is the port/adapter pattern applied to error handling.

---

### 2. Domain invariant violations map to 409 Conflict, not 400 or 422

**Decision:** All `DomainException` instances → `409 Conflict`.

**Reasoning:**
- `400 Bad Request` — the request was malformed or had invalid input (handled by class-validator before reaching the domain)
- `409 Conflict` — the request was well-formed but conflicts with the **current state** of the resource
- `422 Unprocessable Entity` — well-formed, semantically invalid

State machine violations (`cancel CONFIRMED order`, `confirm expired reservation`) are conflicts with resource state, not malformed input. 409 is semantically precise.

---

### 3. ExceptionFilter must write the response directly — not re-throw

**Decision:** `DomainExceptionFilter.catch()` calls `response.status(409).json({...})` on the Express response object.

**Why:** A filter is the last error handler in the NestJS pipeline. Throwing an `HttpException` inside a filter is non-standard — it relies on NestJS's built-in handler catching it downstream, which is implicit and fragile. The contract is: the filter owns the response.

**Common mistake caught in review:** missing `@Catch(DomainException)` decorator. Without it, NestJS never routes exceptions to the filter — it silently falls through to the default 500 handler.

---

### 4. `$transaction` wrapper in `ReserveStockUseCase` was broken — removed

**Decision:** Removed the `$transaction` wrapper. `decrementStockAtomic` runs as a bare `UPDATE`.

**Root cause discovered during load test:** The repositories injected `this.prisma` (the main pool client) directly, not the transaction client `tx`. The `$transaction(async (tx) => { ... })` callback never forwarded `tx` to the repositories. The transaction was wrapping zero operations — it acquired a dedicated connection, held it, and timed out under load while providing no atomicity.

**Evidence:** Under 150 concurrent requests, all responses came back as 500 at exactly 10s and 30s — the `maxWait` and `timeout` values. The DB was correctly processing reservations on the main pool but the transaction slot exhaustion was surfacing as errors on the client side.

**V1 tradeoff accepted:** Two separate writes — `decrementStockAtomic` (atomic single UPDATE) then `reservationRepository.save()`. If the INSERT fails after the UPDATE, stock is orphaned until TTL expiry. This is documented and acceptable for V1.

**Production fix path:** Unit of Work pattern — pass the `tx` client through repository methods so operations share a real transaction boundary.

---

### 5. Explicit `pg.Pool` with configurable `DB_POOL_MAX`

**Decision:** `PrismaService` now creates an explicit `pg.Pool` and passes it to `PrismaPg`, rather than using the default connection string approach.

```typescript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX ?? '20', 10),
});
const adapter = new PrismaPg(pool);
```

**Why:** The default pool size of 10 was too small for meaningful concurrency testing. Externalising as `DB_POOL_MAX` allows tuning per environment without code changes.

**Pool sizing rule:** `DB_POOL_MAX` = `Postgres max_connections / number of app instances`. With Postgres default of 100 and a single instance, 20 is a reasonable starting point with headroom for migrations and admin connections.

---

### 6. Load test targets `POST /orders`, not `POST /inventory/.../reserve`

**Decision:** The load test fires against the full order placement flow, not the internal reserve endpoint.

**Why:** `POST /inventory/products/:id/reserve` is an internal endpoint called by `PlaceOrderUseCase`. The externally-facing operation a client actually uses is `POST /orders`. Testing the internal endpoint skips idempotency key logic, order creation, and the cross-context boundary — all of which are production concerns.

---

## Q&A / Interview Prep

### Question 1
> Domain exception classes — which layer do they belong to, and can they import from NestJS?

**Student answer:** Domain layer, no NestJS imports.

**Correct answer:** Correct. Domain exceptions live in the domain layer (or `shared/domain/` for cross-context use). NestJS is a delivery mechanism. If domain exceptions imported from `@nestjs/common`, the domain would be coupled to the web framework — impossible to reuse in a CLI, worker, or test context without NestJS running.

---

### Question 2
> A domain invariant violation — should it return 400, 409, or 422?

**Student answer:** 409.

**Correct answer:** 409 Conflict. State machine violations (cancelling a CONFIRMED order, confirming an expired reservation) are valid requests that conflict with the current resource state. 400 is for malformed input; 422 is for structurally valid but semantically impossible requests. 409 maps cleanly to "your request is valid, but the resource is not in the state you assumed."

---

### Question 3
> 150 concurrent users, 100 units of stock. What should the load test results look like if the system is correct?

**Correct answer:** Exactly 100 × 201 (reservation + order created), exactly 50 × 409 (stock exhausted), 0 × 500. The atomic UPDATE prevents any result other than success or out-of-stock. Any 500 indicates a bug in the application layer (transaction exhaustion, unhandled exception), not a correctness failure in the domain invariant.

**Actual result after fixing the broken transaction:**
```
201 (reserved ✓)  ×100   p50=461ms
409 (out of stock) ×50   p50=409ms
500                ×0
Total wall time: 484ms
```

---

### Question 4
> The outbox processor marks an event `processed_at = NOW()` after publishing to RabbitMQ, then crashes. On restart it re-processes the same event. What prevents two Orders being created?

**Student answer:** The idempotencyKey in PrismaOrderRepository.save() prevents duplicates.

**Correct answer:** Correct — at two levels. The application layer checks `findByIdempotencyKey()` before creating. The DB unique constraint on `idempotencyKey` is the safety net if two processors race. The idempotency key for an outbox-driven consumer would be derived deterministically from the event (e.g., `reservation-{reservationId}`) so it's stable across retries regardless of how many times the same event is processed.

**Key insight:** The idempotency infrastructure built in session 03 was always load-bearing for the outbox pattern, even before the outbox was introduced. At-least-once delivery requires idempotent consumers.

---

## Outbox Pattern — Concept Summary

**The problem:** `PlaceOrderUseCase` makes two writes: `reserveStockUseCase.execute()` (reservations table) then `orderRepository.save()` (orders table). If the process crashes between them, the reservation exists but the order does not.

**The solution:** Write the reservation AND a `FlashSaleOrderRequested` event to the DB in the **same transaction**. An outbox processor picks up the event and creates the order asynchronously.

```
Transaction {
  INSERT INTO reservations (...)
  INSERT INTO outbox_events (type='FlashSaleOrderRequested', payload='{"reservationId":...}', processed_at=NULL)
}
COMMIT  ← either both land or neither does
```

**Guarantees:** at-least-once delivery (processor may retry). Does not guarantee exactly-once — consumer must be idempotent.

**API contract change:** `POST /orders` can only confirm the reservation was created. Order creation becomes eventual. This is a deliberate tradeoff between consistency and availability.

**Implementation deferred to a future session** — requires: outbox table schema, Prisma migration, processor (scheduled job or DB change listener), decision on sync vs async consumer.

---

## Current Working State

- **44 unit tests passing** across 8 test suites — zero failures
- **TypeScript compiles clean** — zero errors (`tsc --noEmit`)
- **Load test result:** 150 concurrent → 100 × 201, 50 × 409, 0 × 500 in 484ms wall time
- **Zero oversell** confirmed under real concurrent pressure
- **Domain exceptions** map cleanly to 409 — no more 500s for state machine violations
- **`scripts/load-test.mjs`** available for future benchmarking

---

## What Comes Next (Session 06)

1. **Unit of Work pattern** — proper transaction boundary: pass `tx` client through repository methods so `decrementStockAtomic` and `reservationRepository.save()` share a real atomic transaction
2. **LLM integration — Phase 1** — Anthropic SDK setup, first structured output, connecting to the inventory domain
3. **Rate limiting** — `@nestjs/throttler`, early rejection with 429 vs absorbing load and degrading
4. **Outbox pattern implementation** — schema migration, processor, reliable order creation
