# Production Checklist — LLM in a High-Transaction NestJS System

This checklist is specifically designed for a flash sale platform where:
- Traffic spikes are sudden and extreme (flash sale starts → 50k+ req/min immediately)
- Every millisecond of added latency is a conversion risk
- LLM calls cost money per token — volume matters at scale
- The core transaction path (add to cart, checkout) must NEVER be blocked by AI

---

## 1. Cache LLM Responses in Redis

**Problem:** Generating an AI description per product per request is expensive and slow.
**Solution:** Cache by a deterministic key (productId + saleParams hash). TTL = duration of the flash sale.

```typescript
// src/infrastructure/ai/adapters/cached-anthropic-content.adapter.ts
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { createHash } from 'crypto';

@Injectable()
export class CachedAnthropicContentAdapter implements AiContentPort {
  constructor(
    private readonly anthropicContent: AnthropicContentAdapter,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async generateSaleDescription(
    productName: string,
    originalPrice: number,
    salePrice: number,
  ): Promise<string> {
    const cacheKey = `ai:desc:${createHash('sha256')
      .update(`${productName}:${originalPrice}:${salePrice}`)
      .digest('hex')}`;

    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const description = await this.anthropicContent.generateSaleDescription(
      productName,
      originalPrice,
      salePrice,
    );

    // Cache for 1 hour — flash sales don't need fresh descriptions every request
    await this.cache.set(cacheKey, description, 3600);
    return description;
  }
}
```

**Teaching note:** Redis is already likely in the flash sale system (for inventory locks, rate limiting purchases). Reuse the same instance.

---

## 2. Rate Limit Outbound LLM Calls

**Problem:** Anthropic has per-minute token and request limits. During a flash sale spike, unguarded code will get 429s.
**Solution:** Use a token bucket or sliding window rate limiter in front of every LLM call.

```typescript
// src/infrastructure/ai/rate-limiter/llm-rate-limiter.service.ts
import { Injectable } from '@nestjs/common';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

@Injectable()
export class LlmRateLimiterService {
  private readonly limiter: RateLimiterRedis;

  constructor(private readonly redis: Redis) {
    this.limiter = new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: 'llm:anthropic',
      points: 50,        // max 50 calls
      duration: 60,      // per 60 seconds
    });
  }

  async consume(): Promise<void> {
    await this.limiter.consume('global'); // throws RateLimiterRes if exhausted
  }
}
```

**In the adapter:**
```typescript
async generateSaleDescription(...): Promise<string> {
  try {
    await this.rateLimiter.consume();
  } catch {
    // Rate limited — return fallback, don't throw
    return `${productName} — limited time offer.`;
  }
  // ... rest of the call
}
```

---

## 3. Circuit Breaker

**Problem:** If Anthropic is degraded (returning 5xx), you'll keep trying and failing, adding latency to every request.
**Solution:** Circuit breaker — after N failures, stop trying for a cooldown period.

```typescript
// Use nestjs-opossum or implement manually
import CircuitBreaker from 'opossum';

const breaker = new CircuitBreaker(callAnthropicFn, {
  timeout: 5000,          // If the call takes > 5s, trip
  errorThresholdPercentage: 50,  // Trip if 50% of requests fail
  resetTimeout: 30000,    // After 30s, try again (half-open)
});

breaker.fallback(() => 'Flash sale — limited time only.');
```

---

## 4. Explicit Timeouts on Every LLM Call

**Problem:** A stalled Anthropic API call will hold your NestJS thread for Anthropic's default timeout (up to 10 minutes).
**Solution:** Always set `timeout` in the SDK or use `AbortSignal`.

```typescript
const message = await this.anthropicService.anthropic.messages.create(
  {
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    messages: [...],
  },
  {
    timeout: 5000, // 5 second hard timeout
  },
);
```

**Rule of thumb for flash sale context:**
- User-facing AI (descriptions, Q&A): 3–5 second timeout, fallback to static content
- Background AI (inventory agent, analytics): 30 second timeout, fail loudly in logs

---

## 5. Cost Monitoring

**Problem:** At scale, token costs are non-trivial. During a flash sale you may generate thousands of descriptions.
**Solution:** Log token usage from every response and push to your metrics system.

```typescript
// After every API call
const usage = message.usage;
this.logger.log({
  event: 'llm_call',
  model: message.model,
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  estimatedCostUsd: (usage.input_tokens * 0.000003) + (usage.output_tokens * 0.000015),
  feature: 'sale_description',
  productId,
});
```

Push to Datadog, CloudWatch, or your preferred observability tool. Set an alert if hourly cost exceeds a threshold.

---

## 6. Never Block the Transaction Path

**The cardinal rule for a flash sale system:**

AI calls must NEVER be in the critical path of:
- Adding a product to cart
- Processing a sale/checkout
- Decrementing inventory

These must complete in <100ms. LLM calls take 500ms–3s.

**Pattern: Async AI enrichment**
```typescript
// In your sale creation use case:
async createFlashSale(command: CreateFlashSaleCommand): Promise<FlashSale> {
  // 1. Create the sale synchronously — this is the transaction path
  const sale = await this.flashSaleRepository.save(new FlashSale(command));

  // 2. Enrich with AI asynchronously — fire and forget
  this.eventEmitter.emit('flash-sale.created', { saleId: sale.id });
  // A listener picks this up and generates the AI description in the background

  return sale; // Return immediately, don't wait for AI
}
```

---

## 7. Observability — Trace Every LLM Call

Every LLM call should carry:
- Correlation ID (trace the request through your system)
- Feature name (which feature triggered this call)
- Model used
- Token counts
- Latency
- Cache hit/miss

This is how you debug "why did the AI give a weird description for product X during the flash sale?"

```typescript
const start = Date.now();
try {
  const result = await this.callLlm(...);
  this.metrics.record({ feature, latency: Date.now() - start, cacheHit: false, success: true });
  return result;
} catch (error) {
  this.metrics.record({ feature, latency: Date.now() - start, success: false, error: error.message });
  return this.fallback();
}
```

---

## Summary Checklist

| Concern | Solution | Phase to Implement |
|---|---|---|
| Repeated identical calls | Redis cache with deterministic key | Phase 1 onwards |
| Anthropic rate limits | LLmRateLimiterService with Redis | Before load testing |
| API degradation | Circuit breaker with fallback | Before production |
| Runaway timeouts | Explicit timeout on every call | Phase 1 onwards |
| Token cost at scale | Log usage.input_tokens + output_tokens | Phase 2 onwards |
| AI blocking transactions | Fire-and-forget async enrichment | Phase 1 (critical) |
| Production debugging | Correlation IDs + structured logging | Phase 1 onwards |
