# Flash Sale Inventory Management

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

A production-style inventory and order management backend for a flash sale platform. The central engineering challenge: thousands of users attempt to buy the same limited-stock product at the exact same second — the system must prevent overselling, stay consistent under load, and keep response times low without sacrificing correctness.

---

## The Problem

A standard e-commerce approach — read stock, check if available, decrement — breaks under flash sale traffic. With 5,000 concurrent requests and 100 units, a naive read-then-write creates a race condition: every request reads `stock = 100`, every request passes the availability check, and the stock goes negative.

The challenge has two layers:
1. **Correctness** — guarantee that stock never goes below zero, regardless of concurrency
2. **Performance** — solve it without long-held locks that serialize all traffic and stall the connection pool

This project works through both layers from first principles.

---

## Key Design Decisions

### Atomic UPDATE instead of SELECT FOR UPDATE

Stock reservation uses a single atomic statement:

```sql
UPDATE products SET stock = stock - 1 WHERE id = :id AND stock > 0
```

PostgreSQL serializes concurrent writes to the same row at the tuple level. When two requests arrive with `stock = 1`, the second re-evaluates `WHERE stock > 0` against the committed state and gets 0 rows updated — the application treats this as out-of-stock and returns 409.

**Why not SELECT FOR UPDATE?** A pessimistic lock holds an open connection across multiple round trips: SELECT → application logic → UPDATE → INSERT → COMMIT. Under flash sale traffic, this drains the connection pool and queues requests at the application layer. The atomic UPDATE holds a connection for one statement — milliseconds — keeping the pool free.

### Domain-Driven Design with two bounded contexts

The system is split into **Inventory** and **Orders** as separate bounded contexts with explicit boundaries:

- **Inventory** owns all stock invariants. It knows about Products and Reservations.
- **Orders** holds a `reservationId` reference. It never reads or mutates inventory directly.

This is a deliberate trade-off against a simpler single-service design. The separation means Inventory can enforce its invariants in one place, and the stock reservation logic can evolve independently from order and payment flows.

### Transaction boundaries in the application layer, not the repository

Use cases own transaction scope. Repositories are thin adapters — they do not open transactions. This keeps the domain model free of infrastructure concerns and makes it easy to unit test business logic without a database.

### Money as integers in cents

All monetary values are stored as integers representing cents (`9999` = $99.99). No floating-point arithmetic anywhere in the money path. Currency is always stored alongside the amount — `Money` is a value object that enforces both invariants.

### Idempotency keys on orders

Network failures cause clients to retry. Without idempotency, a retry creates a duplicate order. Every order carries a client-supplied `idempotencyKey` enforced by a unique database constraint. A retry with the same key returns the existing order rather than creating a second one.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                         HTTP Layer                             │
│          NestJS Controllers · class-validator DTOs             │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│                      Application Layer                         │
│        Use Cases · Command / Result types · Port interfaces    │
└──────────┬──────────────────────────────────────┬──────────────┘
           │                                      │
┌──────────▼───────────┐              ┌───────────▼──────────────┐
│    Domain Layer       │              │   Infrastructure Layer    │
│                       │              │                          │
│  Product (Aggregate)  │              │  Prisma repositories     │
│  Reservation (Entity) │◄─ ports ────►│  PrismaPg adapter        │
│  Order (Aggregate)    │              │  Redis cache             │
│  Value Objects        │              │  External service        │
│  Domain Events        │              │  adapters                │
└───────────────────────┘              └──────────────────────────┘
```

The domain layer has zero framework imports. NestJS and Prisma are infrastructure — swappable without touching business logic.

### Bounded Contexts

```
INVENTORY                          ORDERS
─────────────────────              ──────────────────────
Product (Aggregate Root)           Order (Aggregate Root)
  reserveStock()                     place()
  releaseStock()                     confirm()
                                     cancel()
Reservation (Entity)
  confirm()                        holds reservationId
  release()                        never touches Reservation
  isExpired()
```

### State Machines

```
Reservation:  PENDING ──► CONFIRMED   payment succeeded
                     └──► RELEASED    expired · cancelled · payment failed

Order:        PENDING ──► CONFIRMED   payment succeeded
                     └──► CANCELLED   payment failed
```

### Enforced Invariants

| Invariant | Where it lives |
|-----------|---------------|
| Stock cannot go negative | `StockCount` value object constructor |
| Price cannot be negative | `Money` value object constructor |
| Money always carries a currency | `Money` value object constructor |
| Cannot confirm an expired reservation | `Reservation.confirm()` |
| Cannot release a confirmed reservation | `Reservation.release()` |
| Cannot confirm a non-PENDING reservation | `Reservation.confirm()` |

---

## Data Model

Four tables across two bounded contexts. Monetary values are stored in cents throughout.

**Inventory context**
- `products` — id, name, description, priceAmount (cents), currency, stock
- `reservations` — id, productId, userId, status, expiresAt

**Orders context**
- `orders` — id, reservationId (unique reference to inventory), userId, status, totalAmount, idempotencyKey (unique)
- `payments` — id, orderId, status, amount

---

## Tech Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Framework | NestJS 11 + TypeScript strict | Dependency injection, module system |
| ORM | Prisma 7 + PrismaPg driver adapter | New query compiler — no binary engine |
| Database | PostgreSQL 16 | Row-level locking for atomic updates |
| Cache | Redis 7 | Rate limiting, reservation TTL (planned) |
| Validation | class-validator + class-transformer | Applied at the HTTP boundary only |
| API docs | @nestjs/swagger | OpenAPI spec auto-generated |
| Testing | Jest | Unit tests on domain layer only |

---

## Getting Started

**Prerequisites:** Node.js 20+, Docker

```bash
# 1. Start PostgreSQL (port 5433) and Redis (port 6379)
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Copy environment config (defaults work for local Docker)
cp .env.example .env

# 4. Run database migrations
npx prisma migrate dev

# 5. Start in watch mode
npm run start:dev
```

App: **http://localhost:3001** · Swagger: **http://localhost:3001/api**

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/inventory/products` | Create a product with initial stock |
| `POST` | `/inventory/products/:id/reserve` | Atomically reserve one unit of stock |

Every response includes an `X-Correlation-ID` header for request tracing.

---

## Tests

```bash
npm run test        # unit tests
npm run test:watch  # watch mode
npm run test:cov    # coverage report
```

Domain layer is unit-tested in isolation — no database, no NestJS bootstrap. Aggregates, entities, and value objects are tested directly against their invariants.

---

## Roadmap

- [x] Product aggregate and Reservation entity with full invariant enforcement
- [x] Atomic stock reservation (oversell prevention)
- [x] Prisma 7 infrastructure with PrismaPg driver adapter
- [x] Unit tests for domain layer
- [x] CreateProduct and ReserveStock use cases end-to-end
- [x] Orders module — Order aggregate, PlaceOrderUseCase, idempotency enforcement
- [ ] Payment processing flow
- [ ] LLM integration — AI-generated sale descriptions and inventory analysis agent (Anthropic SDK)
- [ ] Redis rate limiting and reservation TTL expiry worker
- [ ] Concurrency load test (k6) — 500 concurrent users against a single product
