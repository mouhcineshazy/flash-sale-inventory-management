# Portfolio Entry — Flash Sale Inventory & Order Management System

## One-liner
Production-grade NestJS backend for a high-concurrency flash-sale platform, demonstrating DDD, atomic stock control, and resilience patterns under load.

---

## Project Summary

Designed and built a backend system capable of handling hundreds of simultaneous checkout requests for limited-stock product drops without overselling — a core challenge in e-commerce platforms (luxury retail, sneaker drops, concert tickets).

Validated under load: **150 concurrent users, 100 units of stock → exactly 100 orders confirmed, 50 rejected, 0 server errors, in 484ms wall time.**

---

## Technical Stack

- **Runtime:** Node.js 24 / TypeScript (strict mode)
- **Framework:** NestJS with hexagonal (port/adapter) architecture
- **Database:** PostgreSQL 16 via Prisma 7 (PrismaPg driver adapter)
- **Cache/Queue:** Redis 7 (provisioned, ready for rate limiting and outbox)
- **Testing:** Jest — 44 unit tests, 8 suites, 0 failures

---

## Architecture

**Domain-Driven Design with two bounded contexts:**

```
Inventory Context          Orders Context
─────────────────          ──────────────
Product aggregate          Order aggregate
Reservation entity         PlaceOrderUseCase
ReserveStockUseCase        ConfirmOrderUseCase
ConfirmReservationUseCase  CancelOrderUseCase
ReleaseReservationUseCase
```

Each context follows strict layering:
```
domain/           ← aggregates, entities, value objects, repository interfaces
application/      ← use cases (no NestJS imports)
infrastructure/   ← Prisma adapters
http/             ← controllers, DTOs
```

---

## Key Engineering Decisions

### Oversell Prevention — Atomic SQL UPDATE
```sql
UPDATE products SET stock = stock - quantity
WHERE id = :id AND stock >= quantity
```
Single statement, PostgreSQL re-evaluates the WHERE clause atomically. No SELECT FOR UPDATE, no application-level locking. Validated under 150 concurrent requests — zero oversell.

### Price Snapshot at Reservation Time
Price locked onto the Reservation at the moment stock is atomically decremented — same in-memory product object, zero extra DB reads. Eliminates race condition where a price change between reservation and order creation produces an incorrect charge.

### Idempotency Key Pattern
`POST /orders` accepts a client-supplied idempotency key. Duplicate requests return the existing order without side effects. DB unique constraint is the safety net for concurrent duplicates — catches the race window between the application-layer check and the insert.

### Graceful Shutdown
SIGTERM handler registered before `app.listen()`. NestJS lifecycle hooks drain in-flight requests, Prisma disconnects cleanly. Timeout guard (`process.exit(1)` after 10s) prevents hanging pods in Kubernetes. Pairs with a `preStop: sleep 5` pod spec hook to drain load balancer traffic before SIGTERM fires.

### Domain Exception Mapping
Aggregates throw `DomainException` (pure TypeScript, no framework imports). A NestJS `ExceptionFilter` catches at the HTTP boundary and maps to `409 Conflict`. Application-layer infrastructure failures (DB timeout, network error) propagate unchanged — never conflated with domain violations.

### Compensating Actions (Manual Saga)
`ConfirmOrderUseCase` confirms the reservation first; if it throws (expired, wrong status), the order is cancelled as a compensating write before the exception is re-thrown. Generic infrastructure errors do not trigger the cancel — the order stays PENDING and remains retryable.

---

## Concurrency & Load Test Results

| Scenario | Concurrency | Stock | 201 | 409 | 500 | Wall time |
|---|---|---|---|---|---|---|
| Flash sale drop | 150 users | 100 units | 100 | 50 | 0 | 484ms |

- **p50 latency (success path):** 461ms
- **p50 latency (out-of-stock path):** 409ms
- Connection pool: explicit `pg.Pool`, configurable via `DB_POOL_MAX` env var

---

## Production Patterns Implemented

| Pattern | Where |
|---|---|
| Atomic SQL for inventory | `PrismaProductRepository.decrementStockAtomic()` |
| Idempotency key + DB constraint | `PrismaOrderRepository.save()` — catches P2002 on `idempotencyKey` |
| Price snapshot | `ReserveStockUseCase` → `Reservation.priceAmount` |
| Domain exception filter | `DomainExceptionFilter` → 409 Conflict |
| Graceful shutdown | `PrismaService.onModuleDestroy()` + SIGTERM timeout guard |
| State machine invariants | `Order.confirm()`, `Order.cancel()`, `Reservation.confirm()`, `Reservation.release()` |
| Repository port/adapter | Domain interfaces in `domain/`, Prisma implementations in `infrastructure/` |

---

## What This Demonstrates

- Ability to design for correctness under concurrency, not just under happy-path conditions
- Deep understanding of where transaction boundaries belong (application layer, not repositories)
- DDD applied pragmatically — bounded contexts, aggregates, value objects used where they add value
- Production thinking alongside implementation: idempotency, compensating actions, graceful shutdown, exception mapping
- Node.js internals: event loop, connection pool sizing, why async ≠ non-blocking for CPU work
