# Session 02 — Scaffold Summary, Concurrency Q&A, and Context

## What Was Built in This Session

### Stack Decisions
- **Framework:** NestJS with TypeScript (strict mode)
- **ORM:** Prisma 7.x with PrismaPg driver adapter (new query compiler approach)
- **Database:** PostgreSQL 16 (Docker, port 5433 to avoid conflicts)
- **Cache:** Redis 7 (Docker, port 6379) — wired, not yet used
- **Validation:** class-validator + class-transformer via NestJS GlobalValidationPipe
- **Docs:** Swagger/OpenAPI at http://localhost:3000/api

### Key Architecture Decisions Made
- 2 bounded contexts: **Inventory** and **Orders**
- `Reservation` entity lives in **Inventory** — it owns the stock invariants
- `Orders` context holds only a `reservationId` reference, never mutates the reservation directly
- **Atomic SQL UPDATE** chosen as V1 concurrency strategy (not SELECT FOR UPDATE, not Redis)
- Transaction boundaries live in the **application layer** (use cases), not the domain or infrastructure
- Repository interfaces (ports) live in the domain; Prisma implementations (adapters) live in infrastructure

### Folder Structure Created
```
src/
├── main.ts                                      ← Swagger, ValidationPipe, graceful shutdown
├── app.module.ts                                ← ConfigModule, CorrelationIdMiddleware
├── shared/
│   ├── domain/
│   │   └── base-entity.ts                       ← identity-based equality for all entities
│   ├── infrastructure/database/
│   │   └── prisma.service.ts                    ← Prisma 7.x with PrismaPg adapter
│   └── middleware/
│       └── correlation-id.middleware.ts          ← X-Correlation-ID on every request/response
└── modules/
    ├── inventory/
    │   ├── domain/
    │   │   ├── product.aggregate.ts             ← reserveStock(), releaseStock()
    │   │   ├── reservation.entity.ts            ← confirm(), release(), isExpired()
    │   │   ├── product.repository.ts            ← interface / port
    │   │   ├── reservation.repository.ts        ← interface / port
    │   │   └── value-objects/
    │   │       ├── product-id.vo.ts
    │   │       ├── stock-count.vo.ts
    │   │       └── money.vo.ts
    │   ├── application/use-cases/
    │   │   ├── reserve-stock.use-case.ts        ← atomic decrement + reservation insert
    │   │   ├── release-reservation.use-case.ts  ← releases stock + marks reservation RELEASED
    │   │   └── confirm-reservation.use-case.ts  ← marks reservation CONFIRMED after payment
    │   ├── infrastructure/persistence/
    │   │   ├── prisma-product.repository.ts     ← Prisma adapter, decrementStockAtomic()
    │   │   └── prisma-reservation.repository.ts ← Prisma adapter
    │   └── http/
    │       ├── inventory.controller.ts
    │       └── dtos/
    │           ├── create-product.dto.ts
    │           └── reserve-stock-request.dto.ts
    └── orders/
        └── orders.module.ts                     ← stub, to be implemented in Session 03
```

### Prisma Schema (4 tables)
- `products` — id, name, description, priceAmount (cents), currency, stock, timestamps
- `reservations` — id, productId, userId, status (PENDING/CONFIRMED/RELEASED), expiresAt, timestamps
- `orders` — id, reservationId (unique), userId, status (PENDING/CONFIRMED/CANCELLED), totalAmount, idempotencyKey (unique), timestamps
- `payments` — id, orderId (unique), status (PENDING/SUCCEEDED/FAILED), amount, timestamps

### Domain State Machines

```
Reservation:  PENDING --> CONFIRMED  (payment succeeded)
                     \--> RELEASED   (payment failed / expired / user cancelled)

Order:        PENDING --> CONFIRMED  (payment succeeded)
                     \--> CANCELLED  (payment failed)
```

### Invariants Enforced in the Domain
- `StockCount` cannot be negative or fractional
- `Money` is always stored in cents (integer), always carries currency
- `Product.reserveStock()` throws if stock is zero
- `Reservation.confirm()` throws if status is not PENDING or if expired
- `Reservation.release()` throws if status is CONFIRMED

### Verified Working
- `tsc --noEmit` — zero TypeScript errors
- `prisma migrate dev` — migration applied, all 4 tables created
- `npm run start:dev` — app boots, Swagger at http://localhost:3000/api
- Routes visible: POST /inventory/products, POST /inventory/products/:id/reserve

---

## Concurrency Interview Q&A

### Question 1
> 500 concurrent requests arrive for a product with 100 units. How many succeed? Walk through what happens at the database level when two requests hit decrementStockAtomic at exactly the same moment. What does PostgreSQL guarantee and why?

**Student answer:** 100 succeed, 400 get out of stock. PostgreSQL guarantees MVCC so data is consistent, ACID.

**Correct answer:**

100 succeed, 400 get "out of stock." The mechanism is row-level exclusive locking, not MVCC.

MVCC is about read consistency — it ensures readers never block writers and vice versa. For concurrent UPDATEs on the same row, PostgreSQL uses tuple-level write locks.

Exact sequence when two requests arrive simultaneously with stock = 1:

1. Request A acquires an exclusive tuple lock on the row
2. Request A executes `UPDATE products SET stock = 0 WHERE id=X AND stock > 0` — 1 row updated
3. Request A commits — lock released
4. Request B was waiting. Now re-evaluates the WHERE clause against the committed data: `stock = 0`, condition `stock > 0` is FALSE
5. Request B gets 0 rows updated — returns null — application throws 409 Conflict

The key phrase: PostgreSQL re-evaluates the WHERE clause against post-commit data. That is the guarantee. The ACID property in play is Isolation (lost update prevention), not MVCC.

MVCC does apply to the follow-up SELECT (findById) — it ensures that read sees the committed state after the UPDATE, not a stale snapshot.

---

### Question 2
> If 500 requests are all waiting on that row-level lock, what happens to your database connection pool?

**Student answer:** The pool is drained because it creates 500 connections one per request, which signals a DB bottleneck. That is why SELECT FOR UPDATE does not work for concurrent use cases.

**Correct answer:**

The pool is bounded — Prisma defaults to around 10 connections. It cannot create 500 connections.

What actually happens:

- Requests 1–10: get connections immediately, execute their UPDATE
- Requests 11–500: queue at the APPLICATION layer waiting for a free connection
- If a request waits longer than the pool timeout (~10s default): it fails with a connection timeout error — not "out of stock" — a 500 Internal Server Error that bypasses all domain logic

Two distinct failure modes:

| Failure | Cause | HTTP response |
|---|---|---|
| Out of stock | UPDATE returned 0 rows | 409 Conflict |
| Pool exhaustion | Request waited too long for a connection | 500 Internal Server Error |

Why SELECT FOR UPDATE is worse — the precise mechanism:

SELECT FOR UPDATE holds a connection for the entire transaction: SELECT + application logic + UPDATE + INSERT + COMMIT. Multiple round trips. Atomic UPDATE holds a connection for one statement — microseconds. The shorter the connection hold time, the faster connections return to the pool, the less requests queue up.

Node.js-specific layer: queued requests in Node.js are pending Promises in the heap, not blocked OS threads. Memory grows as the queue grows. Under extreme load this can cause OOM. Production Node.js backends add a request concurrency limit (`@nestjs/throttler` or similar) to reject early with 503 rather than absorbing unlimited traffic and dying.

**Interview-ready answer:**

> The pool is bounded (say 10 connections). 490 requests queue in the application layer. If they wait past the pool timeout they fail with a 500, silently bypassing domain logic. Atomic UPDATE mitigates this by holding each connection for a single statement instead of an entire transaction, keeping the pool free. In Node.js, queued requests are pending Promises in the heap — unlike Spring's thread pool which gets rejected at the OS level, Node.js accepts all connections and risks OOM if the queue is unbounded. This is why you add a concurrency limit at the HTTP layer.

---

## What Comes Next (Session 03)

1. Write unit tests for the `Product` aggregate and `Reservation` entity
2. Implement `CreateProductUseCase` so the POST /inventory/products endpoint actually persists
3. Stub the `Orders` module — `Order` aggregate, `PlaceOrderUseCase`

## Concepts Still to Cover

- Event loop deep dive (libuv, microtask queue, setImmediate vs nextTick)
- Graceful shutdown in practice (SIGTERM, draining in-flight requests)
- Idempotency keys for order/payment operations
- Outbox pattern consideration for async event publishing
- Concurrency load test — simulate 500 users hitting one product, observe the failure modes
- Redis as V2 coordination layer
- Rate limiting with @nestjs/throttler
- Worker threads vs clustering
