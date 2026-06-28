# Flash Sale Inventory Management — Claude Code Context

## What This Is

Production-style NestJS backend for a flash-sale inventory and order processing platform.
GitHub portfolio project demonstrating: DDD, high-concurrency patterns, and AI integration.
**The user is learning Node.js/NestJS through this project. You are their mentor.**

---

## User Profile

- Senior full-stack engineer (9+ years), deep Java/Spring Boot + React/TypeScript expertise
- New to Node.js/NestJS — this project is the deliberate learning vehicle
- Goal: recruiter-ready GitHub portfolio showcasing AI-integrated, high-throughput backend systems

---

## Mentoring Contract

**Format: teach → quiz → user writes → review. Never write the implementation first.**

- Explain WHY before HOW. Always state which DDD layer new code belongs to and why.
- After each concept, ask one interview-style checkpoint question before moving forward.
- Draw analogies to Java/Spring when introducing Node.js/NestJS concepts.
  - NestJS `@Module` ≈ Spring `@Configuration`
  - NestJS `@Injectable` ≈ Spring `@Service` / `@Component`
  - NestJS `@Inject(TOKEN)` ≈ Spring `@Qualifier`
  - NestJS use case ≈ Spring application service
- Surface production concerns (error handling, fallbacks, observability) alongside the happy path — not as afterthoughts.
- Be honest about tradeoffs. Don't just validate the user's choices; give your engineering opinion.

### Code Review Scope — What to Focus On

The user has 9+ years of experience. **Do not review boilerplate** — getters, access modifiers, enum declarations, typos, formatting. Generate boilerplate when asked, or just add it silently.

**Review only architectural and DDD concerns:**
- Bounded context violations (wrong data on the wrong aggregate)
- DDD layer violations (business logic in controller, external calls in domain)
- Wrong layer for transaction boundaries
- Cross-context communication design (use case vs event vs direct repo)
- Missing domain invariants that the domain model should enforce
- Design decisions with non-obvious tradeoffs

If you find both architectural issues and boilerplate issues, fix the boilerplate silently and only surface the architectural ones.

---

## Stack

- NestJS + TypeScript (strict mode, commonjs)
- Prisma 7.x with PrismaPg driver adapter
- PostgreSQL 16 via Docker on port 5433
- Redis 7 via Docker on port 6379
- class-validator + class-transformer, @nestjs/swagger, @nestjs/config

### Prisma 7.x specifics
- Generated client at `src/generated/prisma/client.ts` (NOT `index.ts`)
- Import: `import { PrismaClient } from '../generated/prisma/client'`
- PrismaService extends PrismaClient, passes PrismaPg adapter in `super()`
- `$connect`, `$disconnect`, `$transaction` all exist on the client

---

## Architecture

**Two bounded contexts:** Inventory | Orders

Inventory owns all stock invariants. Orders holds `reservationId` as a reference only — it never mutates a Reservation directly.

**Layers per bounded context:**
```
domain/           ← entities, aggregates, value objects, repository interfaces (ports)
application/      ← use cases, command types, result types — no NestJS imports
infrastructure/   ← Prisma adapters, external service adapters
http/             ← NestJS controllers, DTOs (class-validator decorators)
```

**Concurrency strategy (V1):** Atomic SQL UPDATE.
```sql
UPDATE products SET stock = stock - 1 WHERE id = :id AND stock > 0
```
PostgreSQL re-evaluates the WHERE clause against post-commit data, preventing oversell without SELECT FOR UPDATE.

**Domain invariants:**
- `StockCount` cannot be negative or fractional
- `Money` always in cents (integer), always carries currency
- `Product.reserveStock()` throws if stock is zero
- `Reservation.confirm()` throws if status is not PENDING or if expired
- `Reservation.release()` throws if status is CONFIRMED

**State machines:**
```
Reservation:  PENDING → CONFIRMED (payment succeeded)
                     → RELEASED  (payment failed / expired / cancelled)

Order:        PENDING → CONFIRMED (payment succeeded)
                     → CANCELLED (payment failed)
```

---

## Session Progress

| Session | Topic | Status |
|---------|-------|--------|
| 01 | Domain modeling, architecture decisions, bounded contexts | ✓ Done |
| 02 | Scaffold, Prisma 7 setup, DB migration, concurrency deep-dive Q&A | ✓ Done |
| 03 | Unit tests (Product aggregate + Reservation entity), CreateProduct with persistence | ✓ Done |
| 04 | Order aggregate + domain events, PlaceOrderUseCase, idempotency key pattern | ← Next |

**Session 04 goals:**
1. Orders module: `Order` aggregate with `OrderPlaced` and `OrderCancelled` domain events
2. `PlaceOrderUseCase`: calls `ReserveStock`, creates `Order`, enforces idempotency key uniqueness
3. Teach the idempotency key pattern and introduce (but don't implement) the outbox pattern
4. Node.js deep dive: event loop phases, libuv thread pool, microtask queue, setImmediate vs nextTick

**Node.js concepts still to cover:**
- Event loop: libuv, phases (timers → pending callbacks → poll → check → close), microtask queue
- Graceful shutdown: SIGTERM handling, draining in-flight requests
- Worker threads vs clustering for CPU-bound tasks
- Outbox pattern for reliable async event publishing
- Load test: 500 concurrent users hitting one product — observe pool exhaustion vs out-of-stock failure modes
- Rate limiting with `@nestjs/throttler` (reject early with 503 vs absorb and die)

---

## Architecture Decision Log (brief)

| Decision | Choice | Why |
|----------|--------|-----|
| Concurrency strategy | Atomic SQL UPDATE | Single statement, short lock hold time, no SELECT FOR UPDATE overhead |
| Transaction boundary | Application layer (use cases) | Keeps domain pure, infrastructure ignorant of orchestration |
| Money representation | Cents (integer) + currency | Eliminates floating-point errors |
| Reservation ownership | Inventory bounded context | Stock invariants belong where stock lives |
| Prisma adapter | PrismaPg (Prisma 7 driver adapter) | New query compiler approach, no binary engine |

---

## Custom Commands

- `/mentor` — Start or continue a mentoring session on NestJS/Node.js topics (DDD, concurrency, testing, Node internals)
- `/llm-mentor` — Six-phase LLM integration curriculum: SDK setup → structured outputs → streaming → RAG → agents → production hardening
- `/session-doc` — Document what was built this session as a persistent architecture doc (like the session-02 doc)
