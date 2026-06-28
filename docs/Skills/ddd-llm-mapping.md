# DDD ↔ LLM Component Mapping

Use this reference whenever placing a new LLM-related component in the codebase.

## The Rule
**LLM is an external dependency — it belongs in Infrastructure, accessed through a Port (interface) defined in Application.**

This is identical to how you would treat a payment gateway, an email provider, or a third-party API.

---

## Layer-by-Layer Placement

### Domain Layer — NO LLM here
The domain layer contains business logic, entities, aggregates, value objects, and domain events.
LLM calls are never made here.

**What CAN live here:**
- Domain events triggered as a result of AI recommendations (e.g. `FlashSaleRecommended`)
- Value objects representing AI output once it has been validated and accepted into the domain (e.g. `SaleEligibilityScore`)

**What cannot live here:**
- Any import from `@anthropic-ai/sdk`
- Any async call to an external service
- Prompt strings

---

### Application Layer — Ports and Use Cases
The application layer defines the **what**, not the **how**.

**What lives here:**
- `AiContentPort` — interface defining what AI capabilities the application needs
- `AiAnalysisPort` — interface for AI-powered analysis use cases
- `EmbeddingPort` — interface for vector embedding operations
- Application services that inject these ports and orchestrate AI calls as part of use cases

**Key principle:** The application service doesn't know if the AI provider is Anthropic, OpenAI, or a mock. It only knows the port interface.

```
src/application/
  ports/
    ai-content.port.ts       ← define here
    ai-analysis.port.ts      ← define here
    embedding.port.ts        ← define here
  services/
    flash-sale.service.ts    ← inject ports, orchestrate use cases
    product-qa.service.ts    ← RAG orchestration lives here
```

---

### Infrastructure Layer — Adapters (Implementations)
The infrastructure layer contains the **how** — actual API calls, SDK usage, database queries.

**What lives here:**
- `AnthropicService` — wraps and exposes the Anthropic SDK client
- `AnthropicContentAdapter` — implements `AiContentPort`
- `AnthropicAnalysisAdapter` — implements `AiAnalysisPort`
- `AnthropicEmbeddingAdapter` or `OpenAiEmbeddingAdapter` — implements `EmbeddingPort`
- `InventoryAgentAdapter` — the agentic tool-calling loop

```
src/infrastructure/
  ai/
    anthropic.module.ts
    anthropic.service.ts          ← SDK client wrapper
    adapters/
      anthropic-content.adapter.ts
      anthropic-analysis.adapter.ts
      anthropic-embedding.adapter.ts
      inventory-agent.adapter.ts
```

---

### Interface Layer — Controllers
HTTP controllers that expose AI features to clients.

**What lives here:**
- REST endpoints that call Application Services
- SSE streaming controllers
- DTO validation for AI-related request/response shapes

**What does NOT live here:**
- Direct calls to `AnthropicService` (exception: streaming controllers where the stream must be piped directly for latency reasons — document this exception explicitly)

---

## Quick Decision Table

| "Where do I put this?" | Layer |
|---|---|
| Anthropic SDK client setup | Infrastructure |
| Port/interface for an AI capability | Application |
| Actual API call implementation | Infrastructure |
| Orchestrating an AI call inside a use case | Application |
| Prompt strings | Infrastructure adapter (next to the call) |
| Zod schema for AI output validation | Infrastructure adapter (next to the call) |
| Domain event emitted after AI recommendation | Domain |
| Value object wrapping a validated AI score | Domain |
| HTTP endpoint for AI feature | Interface |
| SSE streaming controller | Interface |
| Redis caching of LLM responses | Infrastructure |

---

## The Analogy That Helps

Think of the LLM exactly like a PostgreSQL database:
- You don't call `pg.query()` directly from your domain entity
- You define a repository interface in the application layer
- You implement it with TypeORM/Prisma in the infrastructure layer
- Your domain entity never imports anything database-related

LLM providers work the same way. Replace "TypeORM" with "Anthropic SDK" and the pattern is identical.
