# Session 01 — Domain Modeling and Architecture Decisions

## Project Overview

A flash-sale inventory and order processing platform for limited-stock product drops.

**Business context:**
- Admins create products with limited stock.
- Users browse products and place orders.
- During flash-sale periods, many users may attempt to reserve the same inventory simultaneously.
- The system must prevent overselling.
- Checkout includes a simulated payment step.
- If payment succeeds, the reservation becomes a confirmed order.
- If payment fails or times out, the reservation must expire or be compensated.

---

## 1. Bounded Context Options

### Option A — Product-Centric (3 contexts)

```
+------------------+   +------------------------+   +----------------------+
|    CATALOG       |   |       INVENTORY        |   |        ORDERS        |
|                  |   |                        |   |                      |
|  Product         |   |  StockLedger           |   |  Order               |
|  ProductDetails  |   |  Reservation           |   |  OrderItem           |
|  PricePolicy     |   |  StockAllocation       |   |  Payment             |
|                  |   |  ReservationExpiry     |   |  OrderStatus         |
|  Admin creates   |   |  Prevents oversell     |   |  Confirms/cancels    |
|  products here   |   |  TTL management        |   |  payment here        |
+------------------+   +------------------------+   +----------------------+
```

**Tradeoff:** Clean separation, but Catalog and Inventory are tightly coupled in practice.
When you create a product, you also initialize stock. You will fight the boundary constantly.

---

### Option B — Sale-Event-Centric (4 contexts)

```
+----------+   +----------------+   +------------------+   +--------------+
| CATALOG  |   |  SALE EVENTS   |   |  RESERVATIONS    |   |    ORDERS    |
|          |   |                |   |                  |   |              |
| Product  |   |  FlashSale     |   |  Reservation     |   |  Order       |
| Variant  |   |  SaleWindow    |   |  StockUnit       |   |  Payment     |
|          |   |  SaleProduct   |   |  ExpiryPolicy    |   |  Fulfillment |
+----------+   +----------------+   +------------------+   +--------------+
```

**Tradeoff:** Most realistic for a real product. The `SaleEvent` aggregate is the core business
concept. However, this is over-designed for MVP and will bloat week 1. Save this shape for v2.

---

### Option C — Pragmatic MVP (2 contexts) — RECOMMENDED

```
+----------------------------------+   +----------------------------------+
|         INVENTORY                |   |             ORDERS               |
|                                  |   |                                  |
|  Product (aggregate root)        |   |  Order (aggregate root)          |
|    +-- ProductId (VO)            |   |    +-- OrderId (VO)              |
|    +-- StockCount (VO)           |   |    +-- ReservationId (VO)        |
|    +-- Price (VO)                |   |    +-- OrderStatus (enum)        |
|                                  |   |    +-- PaymentResult (VO)        |
|  Reservation (entity)            |   |                                  |
|    +-- ReservationId (VO)        |   |  Payment (domain service)        |
|    +-- ProductId (VO)            |   |                                  |
|    +-- UserId (VO)               |   |  Invariant: an order can only    |
|    +-- ExpiresAt                 |   |  exist if a reservation exists   |
|    +-- ReservationStatus (enum)  |   |                                  |
+----------------------------------+   +----------------------------------+

Context boundary: Orders context depends on Inventory context
via an anti-corruption layer (reservation ID as shared identifier)
```

**Why this wins for MVP:**
- Two contexts means two modules in NestJS. Clean, understandable.
- The reservation is the seam between them. Inventory owns the reservation lifecycle. Orders consume it.
- You can explain this in 60 seconds in an interview.
- It still demonstrates bounded contexts, aggregates, value objects, and invariants without inventing complexity.

**Key design question:**

> Where does the `Reservation` entity live — in `Inventory` or `Orders`?

**Answer: Inventory owns it.** A reservation is a claim on physical stock. It has nothing to do
with billing, fulfillment, or order status. The Order context receives a `reservationId` as a
reference but never reaches across the boundary to mutate the reservation directly. It calls a
domain service/application service that tells Inventory "this reservation is now confirmed."

DDD rule: _an entity belongs to the context that owns its invariants._

---

## 2. MVP Architecture

### Folder Structure

```
src/
+-- modules/
|   +-- inventory/
|   |   +-- domain/
|   |   |   +-- product.aggregate.ts          <- aggregate root
|   |   |   +-- reservation.entity.ts
|   |   |   +-- value-objects/
|   |   |   |   +-- stock-count.vo.ts
|   |   |   |   +-- product-id.vo.ts
|   |   |   |   +-- money.vo.ts
|   |   |   +-- product.repository.ts         <- interface (port)
|   |   |   +-- reservation.repository.ts
|   |   +-- application/
|   |   |   +-- reserve-stock.use-case.ts
|   |   |   +-- release-reservation.use-case.ts
|   |   |   +-- confirm-reservation.use-case.ts
|   |   +-- infrastructure/
|   |   |   +-- prisma-product.repository.ts  <- adapter
|   |   |   +-- prisma-reservation.repository.ts
|   |   +-- inventory.module.ts
|   |
|   +-- orders/
|       +-- domain/
|       |   +-- order.aggregate.ts
|       |   +-- value-objects/
|       |   +-- order.repository.ts
|       +-- application/
|       |   +-- place-order.use-case.ts
|       |   +-- process-payment.use-case.ts
|       +-- infrastructure/
|       +-- orders.module.ts
|
+-- shared/
|   +-- domain/
|   |   +-- base-entity.ts
|   +-- infrastructure/
|       +-- correlation-id.middleware.ts
|       +-- logger.service.ts
|
+-- main.ts
```

### Framework Decision: NestJS

| Concept | Spring Boot | NestJS |
|---|---|---|
| Module system | `@SpringBootApplication` + component scan | `@Module` with explicit imports/exports |
| DI | `@Autowired`, `@Component` | `@Injectable`, constructor injection |
| HTTP layer | `@RestController`, `@GetMapping` | `@Controller`, `@Get` |
| Middleware | `Filter`, `Interceptor` | `Middleware`, `Interceptor`, `Guard`, `Pipe` |
| Config | `@ConfigurationProperties` | `ConfigService` + `@nestjs/config` |
| Lifecycle | `@PostConstruct`, `ApplicationRunner` | `onModuleInit`, `onApplicationBootstrap` |

The mental model transfer from Spring to NestJS is ~90% complete. The 10% to unlearn is the
threading model. In Spring, each request gets its own thread. In Node.js, there is one thread for
application code. If you block it, you block every user.

### ORM Decision: Prisma over TypeORM

TypeORM looks more like JPA/Hibernate, but its entity manager, lazy loading, and session lifecycle
have rough edges that cause real frustration. Prisma forces explicit queries, which is how a
senior engineer should think anyway. It also has better TypeScript inference and a cleaner
migration story.

**Key discipline required:** Prisma's generated client types must not bleed into the domain layer.
Repository adapters in the infrastructure layer handle the translation.

---

## 3. High-Transaction Strategy Comparison

### Strategy 1: Database Row Locking (SELECT FOR UPDATE)

```sql
BEGIN;
SELECT * FROM products WHERE id = $1 FOR UPDATE;
UPDATE products SET stock = stock - 1 WHERE id = $1;
INSERT INTO reservations (...);
COMMIT;
```

**Pros:** Simple, correct, familiar.
**Cons:** Serializes all writers on one row. Under 500 concurrent users, the connection pool
exhausts before the CPU does. You get timeouts, not errors — which is worse.

**Interview answer:** "I considered row-level locking but rejected it for the reservation hot path
because it serializes all writers on the same row, which does not scale and exhausts the connection
pool under flash-sale load."

---

### Strategy 2: Optimistic Locking (Version Column)

```sql
UPDATE products
SET stock = stock - 1, version = version + 1
WHERE id = $1 AND version = $2 AND stock > 0
```

If `rowsAffected === 0`, retry with a fresh read.

**Pros:** No lock held, good throughput for low contention.
**Cons:** Flash sales are the worst possible case for optimistic locking. Every user is trying the
same row at the same second. Retry storms thrash the database harder than pessimistic locking.

---

### Strategy 3: Atomic SQL Update — RECOMMENDED FOR V1

```sql
UPDATE products
SET stock = stock - 1
WHERE id = $1 AND stock > 0
RETURNING id, stock
```

If the `RETURNING` clause returns nothing, stock was already zero. No explicit transaction needed
for the decrement.

**Pros:**
- Single statement, PostgreSQL MVCC handles concurrent writers correctly
- No deadlocks possible with a single-row single-table write
- Fast, simple, defensible in any interview

**Cons:**
- Does not give you a reservation model on its own (add that separately)
- Not portable across databases (acceptable since we target PostgreSQL)

This is the strategy a senior engineer chooses for v1: correct, simple, and explainable.

---

### Strategy 4: Redis Atomic Decrement

```lua
local current = redis.call('GET', KEYS[1])
if tonumber(current) > 0 then
  return redis.call('DECR', KEYS[1])
else
  return -1
end
```

**Pros:** Sub-millisecond, handles 100k+ ops/sec on a single Redis node.
**Cons:** Redis is not your system of record. You must sync back to PostgreSQL. A Redis crash
before the sync loses inventory data. Two sources of truth, eventual consistency to manage.

**Interview answer:** "Redis is the right answer at Twitter scale. For a 100-unit flash sale, it
introduces operational complexity that the database can handle directly. I would use Redis as a
coordination layer in v2 after measuring that PostgreSQL is actually the bottleneck."

---

### Strategy 5: Queue-Based Serialization (BullMQ)

Funnel all reservation requests into a queue. A single worker processes them one at a time.

**Pros:** No concurrency problem at all. Trivially correct.
**Cons:** Every user waits in line. Latency increases linearly with queue depth. 1000 concurrent
users means user 1000 waits ~10 seconds. This is a ticket queue, not a reservation system.

**Use case:** Background jobs, not synchronous reservation responses.

---

### Version Roadmap

```
V1: Atomic SQL UPDATE + explicit Reservation table + PostgreSQL transaction
V2: Redis stock counter for speed + PostgreSQL reservation as source of truth
V3: Redis + BullMQ for fairness ordering + WebSocket progress notifications
```

---

## 4. Key Learning Areas (Java/Spring to Node.js)

### Critical — Asked in every Node.js interview

**1. The Event Loop**

Not just "Node is single-threaded." You need to explain:
- Call stack, event queue, microtask queue
- `process.nextTick` vs `Promise.then` vs `setImmediate` — execution order and why it matters
- Why a synchronous loop of 1 billion iterations will freeze every active request on your server

**2. async/await is not magic**

It is syntax sugar over Promises over the event loop. `await` suspends the current function and
returns control to the event loop, allowing other callbacks to run. This is why Node.js can handle
10,000 concurrent connections on one thread — it is never truly waiting, it is always switching.

**3. Connection Pooling**

In Spring, Tomcat manages thread pools and HikariCP manages DB connections. In Node.js, Prisma/pg
manages a connection pool. You need to understand pool sizing, what happens when the pool is
exhausted, and why `max: 20` connections with 10,000 concurrent requests does not mean 9,980
requests queue up silently — they time out or error.

### High Value — Separates mid from senior

**4. Backpressure**

When your downstream (DB, Redis) is slower than your upstream (HTTP requests), you are accumulating
work in memory. Visible in load tests as latency climbing and memory growing.

**5. Graceful Shutdown**

Spring has `@PreDestroy`. Node.js has `process.on('SIGTERM')`. You must close in-flight requests,
drain queues, and close DB connections. Kubernetes will kill your pod — handle it.

**6. Idempotency**

A user double-submits an order. Your payment webhook fires twice. What happens? In Spring you may
use `@Transactional`. In Node.js you solve it with idempotency keys and a deduplication table.

### Good to Know — Shows depth

- Worker threads vs clustering vs child processes
- Streams (useful for bulk CSV export, large data processing)
- Memory leak patterns: event listener accumulation, closure captures, timer leaks

---

## 5. Week 1 Implementation Plan

| Day | Goal | What You Learn |
|-----|------|----------------|
| 1 | Project scaffold: NestJS + TypeScript + Prisma + Docker | NestJS module system, Prisma schema, Docker networking |
| 2 | Domain model: Product aggregate, StockCount VO, Reservation entity | DDD value objects, invariants, making illegal states unrepresentable |
| 3 | Inventory use cases: `ReserveStock`, `ReleaseReservation` | Application layer pattern, use case vs service debate, where transactions live |
| 4 | HTTP layer: Controller + DTOs + validation + Swagger | Pipe validation, OpenAPI, request/response shaping without leaking domain types |
| 5 | First concurrency test: simulate 500 users hitting one product | Observe overselling, then fix it with atomic update, measure the difference |

---

## 6. Architecture Questions to Answer Before Coding

These questions shape the implementation. Answer them before proceeding.

**Q1.** Where does the `Reservation` aggregate belong — in `Inventory` or `Orders`? Give your reasoning using DDD invariant ownership.

**Q2.** A user places an order, stock is decremented, and then the payment simulation fails. What should happen to the inventory? Write the steps in plain English before coding.

**Q3.** What is the difference between a Value Object and an Entity in DDD? Give an example of each from this domain. This determines how we model `StockCount`, `ProductId`, `Reservation`, and `Order`.

**Q4.** In Spring you use `@Transactional` at the service layer. In NestJS, where should database transaction boundaries live — domain, application, or infrastructure layer? Why?