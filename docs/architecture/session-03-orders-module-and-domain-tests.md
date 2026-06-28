# Session 03 — Domain Tests, Orders Module, and Quantity Design

## What Was Built in This Session

### Files Created

```
src/modules/inventory/
  domain/
    product.aggregate.spec.ts              ← unit tests for Product aggregate (reserveStock, releaseStock, create)
    reservation.entity.spec.ts             ← unit tests for Reservation entity (confirm, release, isExpired)
  application/use-cases/
    reserve-stock.use-case.spec.ts         ← unit tests for ReserveStockUseCase (mocked repos + $transaction)

src/modules/orders/
  domain/
    order.aggregate.ts                     ← Order aggregate root (place, confirm, cancel, reconstitute)
    order.aggregate.spec.ts                ← unit tests for Order aggregate
    IOrderRepository.ts                    ← repository port (save, findById, findByIdempotencyKey, findByUserId)
    value-objects/
      order-id.vo.ts                       ← OrderId value object (generate, create)
  application/use-cases/
    place-order.use-case.ts                ← PlaceOrderUseCase (idempotency, cross-context price lookup, reserve)
    place-order.use-case.spec.ts           ← unit tests for PlaceOrderUseCase (6 scenarios)
  infrastructure/persistence/
    prisma-order.repository.ts             ← Prisma adapter implementing IOrderRepository
  http/
    orders.controller.ts                   ← POST /orders controller
    dtos/
      place-order.dto.ts                   ← PlaceOrderDto (productId, userId, quantity, idempotencyKey)
  orders.module.ts                         ← wired module (imports InventoryModule, registers providers)
```

### Files Modified

```
prisma/schema.prisma                       ← added quantity field to reservations and orders tables
prisma/migrations/
  20260628211910_add_quantity_.../         ← migration: ALTER TABLE ADD COLUMN quantity

src/modules/inventory/
  domain/
    reservation.entity.ts                  ← added quantity field, updated create() and reconstitute()
    product.repository.ts                  ← updated decrementStockAtomic signature to accept quantity
  application/use-cases/
    reserve-stock.use-case.ts              ← added quantity to ReserveStockCommand, passes to decrement + create
  infrastructure/persistence/
    prisma-product.repository.ts           ← WHERE stock >= quantity (was stock > 0), decrement by quantity
    prisma-reservation.repository.ts       ← quantity added to save() and toDomain()
  http/
    dtos/reserve-stock-request.dto.ts      ← added quantity field with @Min(1) @Max(10) validation
    inventory.controller.ts                ← passes dto.quantity to ReserveStockCommand

src/modules/inventory/inventory.module.ts  ← exports ReserveStockUseCase and PRODUCT_REPOSITORY for Orders
README.md                                  ← full rewrite for recruiter/interviewer audience
```

---

## Key Decisions Made

### 1. One order per product with quantity (vs. multi-product shopping cart)

**Decision:** An order contains one product with a variable quantity.

**Rejected alternative:** One order with multiple product lines (`OrderLine[]` entities), each with its own reservation.

**Reasoning:** Multi-product orders require a saga pattern — if product A reserves but product B is out of stock, A's reservation must be compensated (released). This is non-trivial coordination complexity that would dominate the codebase and obscure the concurrency story the project is built around. Flash sales are typically single-product events. One product + quantity is realistic for the domain and keeps the aggregate model clean.

**Key implication:** `totalAmount = product.priceAmount × quantity`. The atomic decrement changes to `WHERE stock >= quantity`.

### 2. Cross-context price lookup via IProductRepository injection

**Decision:** `PlaceOrderUseCase` (Orders context) injects `IProductRepository` (Inventory port) to read the product price at order placement time.

**Rejected alternative A:** Client sends `totalAmount` in the request — server trusts the caller.

**Rejected alternative B:** Price is snapshotted onto the Reservation when stock is reserved.

**Reasoning:** Option A is unsafe (client-side price manipulation). Option B is architecturally cleaner (no cross-context dependency, price locked at reservation time) but requires a schema change to Reservation that was deferred. Option B is the V2 approach.

**The accepted trade-off:** The dependency is one-directional (Orders reads from Inventory, never writes) and goes through the port interface. If the bounded contexts are split into separate services later, the port implementation swaps to an HTTP client — the application layer is unchanged.

**Residual race condition:** `findById(product)` → `reserveStock()` → `Order.place()`. If the product price changes between steps 1 and 3, the order records the old price. Narrow window, acceptable for V1.

### 3. Idempotency as check-then-save (not atomic)

**Decision:** `PlaceOrderUseCase` checks `findByIdempotencyKey` before creating an order. The DB unique constraint on `idempotencyKey` is the safety net for the race window between check and save.

**Behaviour on duplicate:** Return the existing order exactly as found — no mutation of status or any field. The idempotency key represents "this specific client attempt"; the response replays the original outcome regardless of what state the order has reached.

**On retry when the check races:** Two concurrent requests with the same key that both pass `findByIdempotencyKey === null` will both attempt `orderRepo.save()`. The second will get a unique constraint violation from the DB. This surfaces as an unhandled exception in V1 — a V2 improvement is to catch it in the repository and return the existing record.

### 4. `save()` in PrismaOrderRepository uses upsert with restricted update

**Decision:** `upsert` updates only `status`. All other fields (`totalAmount`, `reservationId`, `idempotencyKey`, `quantity`) are immutable after creation.

**Reasoning:** Prevents accidental overwrites of financial data if `save()` is ever called on an existing order. Only state transitions (`confirm()`, `cancel()`) should change the persisted record.

### 5. Code review scope for experienced engineers

**Decision:** Code reviews in this project focus on DDD layer violations, bounded context leaks, and architectural trade-offs only. Boilerplate (getters, access modifiers, enums, typos) is generated silently.

---

## Q&A / Interview Prep

### Question 1
> The Order aggregate holds `totalAmount`. Where does that value come from and why does the Order snapshot it rather than reading it from the Product at query time?

**Student answer:** Calculated in the use case at creation time using the product price.

**Correct answer:** Calculated as `product.priceAmount × quantity` in `PlaceOrderUseCase.execute()` at the moment of order placement. The Order snapshots it because prices change. If you read `product.priceAmount` when displaying the order, a subsequent price update changes the customer's order total retroactively — that's incorrect and legally questionable. The `totalAmount` is the price the customer agreed to pay at the moment of purchase; it must be immutable from that point forward.

**Interview insight:** This is the "price snapshot" pattern, common in any e-commerce system. The same logic applies to tax rates, discount amounts, and shipping costs — always snapshot at transaction time.

---

### Question 2
> `PlaceOrderUseCase` calls `ReserveStockUseCase` and then saves an Order. Those are two separate writes. Why can't you easily wrap them in a single Prisma `$transaction`?

**Student answer:** No answer given.

**Correct answer:** `ReserveStockUseCase` manages its own database calls internally. Prisma's `$transaction` requires all participating queries to share the same transaction client (`tx`). You cannot reach inside another use case and inject your transaction context — it would require either refactoring `ReserveStockUseCase` to accept an optional `tx` parameter (which leaks infrastructure concerns into the application layer) or bypassing the use case and calling the repositories directly. In V1 we accept two separate writes and rely on `expiresAt` TTL to clean up orphaned reservations if `orderRepo.save()` fails after a successful reservation.

**Interview insight:** This is the dual-write problem. The production-grade solution is the outbox pattern: write the reservation and a `FlashSaleOrderRequested` event to the same DB transaction, then have an async processor pick up the event and create the order. This decouples the two writes and guarantees at-least-once delivery.

---

### Question 3
> A client sends POST /orders. The response is lost in transit. They retry with the same `idempotencyKey`. What should happen on the second call?

**Student answer (initial, incorrect):** Search the order table for the idempotency key, update status to PENDING if not already pending, resend the response.

**Correct answer:** Find the existing order by `idempotencyKey` and return it as-is — no mutation of any field. If the order is `CONFIRMED` (payment processed in the background between the first request and the retry), return `CONFIRMED`. If it's `PENDING`, return `PENDING`. The idempotency key represents "this specific client attempt." The server replays the original outcome; it does not reset state.

**Why the student's answer is wrong:** The order may have already reached `CONFIRMED`. Resetting it to `PENDING` would corrupt the order state and potentially trigger duplicate payment processing. Idempotency is about replaying outcomes, not resetting state.

---

### Question 4
> One order per product, or one order with multiple products? What are the trade-offs?

**Decision made:** One order per product with variable quantity (Option A).

**Trade-off summary:**

| | Option A (single product + quantity) | Option B (multi-product + OrderLine) |
|---|---|---|
| Complexity | Low — one reservation, one decrement | High — saga for partial failure |
| Domain fit | Strong for flash sales (single-deal events) | Strong for general e-commerce |
| Failure handling | One atomic decrement + one order save | Compensating transactions per line |
| Aggregate model | Clean — Order has scalar fields | Richer — Order has OrderLine collection |

**Interview insight:** The saga pattern is how distributed systems handle multi-step transactions that span services or aggregates. Each step has a compensating action (reservation → release). The choreography vs orchestration choice (event-driven vs central coordinator) is a further design decision.

---

## Current Working State

- **34 unit tests passing** across 6 test suites — zero failures
- **TypeScript compiles clean** — zero errors (`tsc --noEmit`)
- **Migration applied** — `quantity` column added to `reservations` and `orders` tables
- **App boots** — both bounded contexts initialize cleanly
- **Swagger** at `http://localhost:3001/api` — 3 endpoints visible:
  - `POST /inventory/products`
  - `POST /inventory/products/:productId/reserve`
  - `POST /orders`
- **Prisma client regenerated** to include `quantity` on both models

---

## What Comes Next (Session 04)

1. **Confirm and release flows end-to-end** — `POST /orders/:id/confirm` and `POST /orders/:id/cancel`, wiring `ConfirmReservationUseCase` and `ReleaseReservationUseCase` through the Orders controller
2. **Idempotency race condition hardening** — catch unique constraint violation in `PrismaOrderRepository.save()` and return the existing order instead of throwing 500
3. **Node.js event loop deep dive** — libuv, phases (timers → poll → check), microtask queue, `setImmediate` vs `process.nextTick` vs `Promise.resolve()`
4. **Graceful shutdown** — SIGTERM handling, draining in-flight requests, `PrismaService.onModuleDestroy()`
5. **Load test setup** — `autocannon` or `k6`, simulate 500 concurrent users against one product, observe pool exhaustion vs out-of-stock failure modes
