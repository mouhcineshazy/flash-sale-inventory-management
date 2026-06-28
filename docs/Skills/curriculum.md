# NestJS LLM Integration Curriculum — Flash Sale App

## Table of Contents
1. Phase 0 — Foundation: SDK Setup & DDD Placement
2. Phase 1 — First Integration: AI Sale Description Generator
3. Phase 2 — Structured Outputs: Typed LLM Responses
4. Phase 3 — Streaming: Real-Time LLM Output via SSE
5. Phase 4 — RAG: Product Knowledge Base with Vector Search
6. Phase 5 — AI Agent: Tool-Calling Inventory Assistant
7. Phase 6 — Production Hardening: Rate Limits, Caching, Fallbacks, Observability

---

## Phase 0 — Foundation: SDK Setup & DDD Placement

### Goal
Understand where LLM calls belong in DDD and get the Anthropic SDK wired into NestJS before writing a single AI feature.

### Teaching Notes
This is the most important phase. Engineers who skip it end up with LLM calls scattered across layers. The key insight:
- **Domain layer**: NEVER. LLM is an external dependency. Domain is pure business logic.
- **Application layer**: YES — orchestrates the call as part of a use case
- **Infrastructure layer**: YES — the actual SDK client lives here as an adapter
- **Interface layer**: YES — exposes streaming endpoints or REST responses

Draw this analogy: "An LLM provider is like a payment gateway. You wouldn't call Stripe directly from your domain entity. You'd define a port (interface) in the domain/application layer and implement it in the infrastructure layer."

### Code

**1. Install the SDK**
```bash
npm install @anthropic-ai/sdk
```

**2. Infrastructure Layer — Anthropic Client Module**

```typescript
// src/infrastructure/ai/anthropic.module.ts
import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service';

@Module({
  providers: [AnthropicService],
  exports: [AnthropicService],
})
export class AnthropicModule {}
```

```typescript
// src/infrastructure/ai/anthropic.service.ts
import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AnthropicService {
  private readonly client: Anthropic;
  private readonly logger = new Logger(AnthropicService.name);

  constructor(private readonly config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
    });
  }

  get anthropic(): Anthropic {
    return this.client;
  }
}
```

**3. Application Layer — Define a Port (interface)**
```typescript
// src/application/ports/ai-content.port.ts
export interface AiContentPort {
  generateSaleDescription(productName: string, originalPrice: number, salePrice: number): Promise<string>;
}

export const AI_CONTENT_PORT = Symbol('AiContentPort');
```

**3. Environment**
```env
ANTHROPIC_API_KEY=sk-ant-...
```

### Checkpoint Question
"Looking at your current folder structure, where exactly would you create the AnthropicService file, and why does it go there and not in the application layer?"

---

## Phase 1 — First Integration: AI Sale Description Generator

### Goal
Build the first real LLM feature: generating compelling flash sale descriptions automatically. Simple, useful, and maps directly onto the flash sale domain.

### Teaching Notes
- This gives him a full end-to-end taste: prompt → API call → response → returned to caller
- Keep the prompt simple at first; prompt engineering is a skill to layer in
- Show him that the Application Service is what calls the port, not the controller
- Introduce basic error handling here — what happens when the API is down?

### Code

**Application Service (the use case)**
```typescript
// src/application/services/flash-sale.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { AI_CONTENT_PORT, AiContentPort } from '../ports/ai-content.port';

@Injectable()
export class FlashSaleApplicationService {
  constructor(
    @Inject(AI_CONTENT_PORT)
    private readonly aiContent: AiContentPort,
  ) {}

  async enrichWithAiDescription(
    productName: string,
    originalPrice: number,
    salePrice: number,
  ): Promise<string> {
    return this.aiContent.generateSaleDescription(productName, originalPrice, salePrice);
  }
}
```

**Infrastructure Adapter (implements the port)**
```typescript
// src/infrastructure/ai/adapters/anthropic-content.adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { AnthropicService } from '../anthropic.service';
import { AiContentPort } from '../../../application/ports/ai-content.port';

@Injectable()
export class AnthropicContentAdapter implements AiContentPort {
  private readonly logger = new Logger(AnthropicContentAdapter.name);

  constructor(private readonly anthropicService: AnthropicService) {}

  async generateSaleDescription(
    productName: string,
    originalPrice: number,
    salePrice: number,
  ): Promise<string> {
    const discountPercent = Math.round(((originalPrice - salePrice) / originalPrice) * 100);

    try {
      const message = await this.anthropicService.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content: `Write a short, urgent flash sale description (2-3 sentences, max 60 words) for:
Product: ${productName}
Original price: $${originalPrice}
Sale price: $${salePrice} (${discountPercent}% off)
Tone: urgent, exciting, time-limited. No hashtags. No emojis.`,
          },
        ],
      });

      const content = message.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic');
      }

      return content.text;
    } catch (error) {
      this.logger.error('Failed to generate AI description', error);
      // Graceful fallback — never block a sale because AI is down
      return `${productName} — ${discountPercent}% off for a limited time only.`;
    }
  }
}
```

**Wire it up in the module**
```typescript
// Register AnthropicContentAdapter as the implementation of AI_CONTENT_PORT
providers: [
  AnthropicModule,
  FlashSaleApplicationService,
  {
    provide: AI_CONTENT_PORT,
    useClass: AnthropicContentAdapter,
  },
],
```

### Production Note to Surface Here
"Notice the fallback in the catch block. In a flash sale system, the AI description is a nice-to-have. The sale must still work even if Anthropic returns a 500. Always degrade gracefully."

### Checkpoint Question
"Why did we define AiContentPort as an interface in the application layer instead of just injecting AnthropicContentAdapter directly into the FlashSaleApplicationService?"

---

## Phase 2 — Structured Outputs: Typed LLM Responses

### Goal
Move beyond free-text responses. Get Claude to return structured JSON and validate it with Zod — making LLM output safe to use in application logic.

### Teaching Notes
- Free text is fine for descriptions. But for anything that drives logic (e.g. risk scores, recommendations, classifications) you need typed output.
- Introduce Zod here — he likely knows it from NestJS validation but this use case is different: validating *AI output*, not user input.
- Show that the prompt must explicitly ask for JSON and describe the schema.
- Show what happens when Claude returns malformed JSON (it happens) and how to handle it.

### Use Case
Flash sale eligibility analyzer: given a product and inventory level, Claude returns a structured recommendation.

### Code

```typescript
// src/application/ports/ai-analysis.port.ts
export interface SaleEligibilityRecommendation {
  eligible: boolean;
  suggestedDiscountPercent: number;
  urgencyScore: number; // 1-10
  reasoning: string;
}

export interface AiAnalysisPort {
  analyzeSaleEligibility(
    productName: string,
    inventoryCount: number,
    averageDailySales: number,
  ): Promise<SaleEligibilityRecommendation>;
}

export const AI_ANALYSIS_PORT = Symbol('AiAnalysisPort');
```

```typescript
// src/infrastructure/ai/adapters/anthropic-analysis.adapter.ts
import { z } from 'zod';

const SaleEligibilitySchema = z.object({
  eligible: z.boolean(),
  suggestedDiscountPercent: z.number().min(1).max(90),
  urgencyScore: z.number().min(1).max(10),
  reasoning: z.string().max(200),
});

@Injectable()
export class AnthropicAnalysisAdapter implements AiAnalysisPort {
  constructor(private readonly anthropicService: AnthropicService) {}

  async analyzeSaleEligibility(
    productName: string,
    inventoryCount: number,
    averageDailySales: number,
  ): Promise<SaleEligibilityRecommendation> {
    const daysOfStock = Math.round(inventoryCount / averageDailySales);

    const message = await this.anthropicService.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      messages: [
        {
          role: 'user',
          content: `Analyze this product for flash sale eligibility.
Product: ${productName}
Current inventory: ${inventoryCount} units
Average daily sales: ${averageDailySales} units/day
Days of stock remaining: ${daysOfStock}

Return ONLY a valid JSON object matching this exact schema — no markdown, no explanation:
{
  "eligible": boolean,
  "suggestedDiscountPercent": number (1-90),
  "urgencyScore": number (1-10, where 10 = extremely urgent to sell),
  "reasoning": string (max 200 chars)
}`,
        },
      ],
    });

    const raw = message.content[0];
    if (raw.type !== 'text') throw new Error('Unexpected response type');

    // Strip any accidental markdown code fences
    const cleaned = raw.text.replace(/```json|```/g, '').trim();

    const parsed = SaleEligibilitySchema.safeParse(JSON.parse(cleaned));
    if (!parsed.success) {
      throw new Error(`Invalid AI response structure: ${parsed.error.message}`);
    }

    return parsed.data;
  }
}
```

### Checkpoint Question
"What would happen if you removed the Zod validation and just returned `JSON.parse(cleaned)` directly? Give me two specific things that could go wrong downstream."

---

## Phase 3 — Streaming: Real-Time LLM Output via SSE

### Goal
Implement streaming so the client sees AI-generated content progressively, not after a multi-second wait. Essential for anything user-facing in a flash sale (fast perceived performance matters).

### Teaching Notes
- SSE (Server-Sent Events) is the right transport for NestJS streaming — simpler than WebSockets for one-directional LLM output
- Streaming means the first token arrives in ~300ms instead of the full response arriving after 3-5 seconds
- This is important for flash sales: users are impatient, every second of perceived latency loses conversions
- Show the NestJS SSE pattern with Observable

### Code

```typescript
// src/interface/controllers/flash-sale-stream.controller.ts
import { Controller, Get, Query, Sse } from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { AnthropicService } from '../../infrastructure/ai/anthropic.service';

@Controller('flash-sales')
export class FlashSaleStreamController {
  constructor(private readonly anthropicService: AnthropicService) {}

  @Sse('describe/stream')
  streamDescription(
    @Query('product') product: string,
    @Query('discount') discount: string,
  ): Observable<MessageEvent> {
    const stream = this.anthropicService.anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Write a flash sale description for ${product} at ${discount}% off. Be urgent and concise.`,
        },
      ],
    });

    return new Observable((subscriber) => {
      stream
        .on('text', (text) => {
          subscriber.next({ data: { chunk: text } } as MessageEvent);
        })
        .on('error', (err) => {
          subscriber.error(err);
        })
        .finalMessage().then(() => {
          subscriber.next({ data: { done: true } } as MessageEvent);
          subscriber.complete();
        });
    });
  }
}
```

### Checkpoint Question
"Why is streaming better than waiting for the full response in a flash sale UI context? And what is one case where you would NOT want to stream — where you'd need the full response before doing anything?"

---

## Phase 4 — RAG: Product Knowledge Base with Vector Search

### Goal
Build a Retrieval-Augmented Generation (RAG) pipeline so the AI can answer questions about products using your actual product data, not hallucinated knowledge.

### Teaching Notes
- RAG = store your data as vector embeddings → when a question comes in, find the most relevant chunks → send them to the LLM as context
- This is the most architecturally complex phase — take it slow
- pgvector is the right choice here because he already uses PostgreSQL (and likely has TypeORM/Prisma set up)
- Connect to DDD: the embedding storage is an Infrastructure concern; the retrieval logic is an Application Service

### Steps
1. Install pgvector extension in PostgreSQL
2. Create embeddings for product descriptions using Anthropic embedding model
3. Store vectors in a products table with a vector column
4. On query: embed the question → search for nearest neighbours → inject results into LLM prompt

### Code

**Setup pgvector**
```sql
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE products ADD COLUMN embedding vector(1536);
```

**Infrastructure — Embedding Service**
```typescript
// src/infrastructure/ai/adapters/anthropic-embedding.adapter.ts
@Injectable()
export class AnthropicEmbeddingAdapter {
  constructor(private readonly anthropicService: AnthropicService) {}

  async embedText(text: string): Promise<number[]> {
    // Note: Use OpenAI's text-embedding-3-small for embeddings
    // Anthropic does not yet expose an embeddings endpoint
    // This is a deliberate architectural note: you may mix providers
    // LLM for generation (Anthropic) + embeddings (OpenAI or Cohere)
    throw new Error('See teaching note: use OpenAI or Cohere for embeddings');
  }
}
```

**Teaching Note to Surface:**
"This is a real-world pattern: you don't have to use one provider for everything. Use Anthropic for generation quality, OpenAI's text-embedding-3-small or Cohere's embed-v3 for embeddings. Infrastructure layer abstracts the provider — your Application Service doesn't care."

**Application Service — RAG Query**
```typescript
// src/application/services/product-qa.service.ts
@Injectable()
export class ProductQaService {
  constructor(
    private readonly embeddingAdapter: EmbeddingPort,
    private readonly productRepository: ProductRepository,
    private readonly anthropicService: AnthropicService,
  ) {}

  async answerProductQuestion(question: string): Promise<string> {
    // 1. Embed the question
    const questionEmbedding = await this.embeddingAdapter.embed(question);

    // 2. Find the 3 most similar products
    const relevantProducts = await this.productRepository.findByVectorSimilarity(
      questionEmbedding,
      3,
    );

    // 3. Build context from retrieved products
    const context = relevantProducts
      .map((p) => `Product: ${p.name}\nDescription: ${p.description}\nPrice: $${p.price}`)
      .join('\n\n');

    // 4. Ask Claude with context
    const message = await this.anthropicService.anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: 'You are a helpful flash sale assistant. Answer only based on the product context provided. If the answer is not in the context, say so.',
      messages: [
        {
          role: 'user',
          content: `Context:\n${context}\n\nQuestion: ${question}`,
        },
      ],
    });

    return (message.content[0] as { text: string }).text;
  }
}
```

### Checkpoint Question
"Why do we embed the user's question and search by vector similarity instead of doing a simple SQL text search like `WHERE description ILIKE '%question%'`? Give me two reasons."

---

## Phase 5 — AI Agent: Tool-Calling Inventory Assistant

### Goal
Build an AI agent that can take actions: check inventory, apply discounts, flag products for sale — by giving Claude tools it can call.

### Teaching Notes
- Tool calling = you describe functions Claude can invoke; Claude decides when to call them and with what arguments; you execute the function; Claude uses the result to respond
- This is the most powerful pattern — the AI can now interact with your system, not just generate text
- In a flash sale context: an agent that monitors slow-moving inventory and proactively recommends sales is genuinely useful
- Watch for infinite loops in the agentic loop — always set a max_iterations guard

### Code

```typescript
// src/infrastructure/ai/adapters/anthropic-agent.adapter.ts
import Anthropic from '@anthropic-ai/sdk';

const inventoryTools: Anthropic.Tool[] = [
  {
    name: 'check_inventory',
    description: 'Get current inventory level for a product',
    input_schema: {
      type: 'object' as const,
      properties: {
        productId: { type: 'string', description: 'The product ID' },
      },
      required: ['productId'],
    },
  },
  {
    name: 'get_sales_velocity',
    description: 'Get average daily sales for a product over the last 30 days',
    input_schema: {
      type: 'object' as const,
      properties: {
        productId: { type: 'string' },
      },
      required: ['productId'],
    },
  },
  {
    name: 'recommend_flash_sale',
    description: 'Flag a product for a flash sale with a suggested discount',
    input_schema: {
      type: 'object' as const,
      properties: {
        productId: { type: 'string' },
        discountPercent: { type: 'number' },
        reason: { type: 'string' },
      },
      required: ['productId', 'discountPercent', 'reason'],
    },
  },
];

@Injectable()
export class InventoryAgentAdapter {
  private readonly MAX_ITERATIONS = 5; // Guard against infinite loops

  constructor(
    private readonly anthropicService: AnthropicService,
    private readonly inventoryRepository: InventoryRepository,
  ) {}

  async runInventoryReview(productIds: string[]): Promise<string> {
    const messages: Anthropic.MessageParam[] = [
      {
        role: 'user',
        content: `Review these products and recommend which ones should go on flash sale: ${productIds.join(', ')}. 
Check inventory and sales velocity for each. Recommend a flash sale if stock > 30 days of supply.`,
      },
    ];

    let iterations = 0;

    while (iterations < this.MAX_ITERATIONS) {
      iterations++;

      const response = await this.anthropicService.anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        tools: inventoryTools,
        messages,
      });

      // Agent is done
      if (response.stop_reason === 'end_turn') {
        const text = response.content.find((b) => b.type === 'text');
        return text ? text.text : 'Review complete.';
      }

      // Process tool calls
      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of response.content) {
          if (block.type !== 'tool_use') continue;

          let result: string;

          switch (block.name) {
            case 'check_inventory': {
              const input = block.input as { productId: string };
              const inv = await this.inventoryRepository.getCount(input.productId);
              result = JSON.stringify({ productId: input.productId, count: inv });
              break;
            }
            case 'get_sales_velocity': {
              const input = block.input as { productId: string };
              const velocity = await this.inventoryRepository.getDailySalesAverage(input.productId);
              result = JSON.stringify({ productId: input.productId, dailyAverage: velocity });
              break;
            }
            case 'recommend_flash_sale': {
              const input = block.input as { productId: string; discountPercent: number; reason: string };
              // Emit a domain event here — this is where DDD reconnects
              result = JSON.stringify({ queued: true, ...input });
              break;
            }
            default:
              result = JSON.stringify({ error: 'Unknown tool' });
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }

        messages.push({ role: 'user', content: toolResults });
      }
    }

    return 'Agent reached max iterations without completing.';
  }
}
```

### DDD Note to Surface Here
"Notice that inside `recommend_flash_sale`, the right next step is to emit a domain event (e.g. `FlashSaleRecommended`) through your existing event bus — not to call a service directly. The agent is Infrastructure; the domain event is how it communicates back into your domain. This keeps the agent decoupled from your core domain logic."

### Checkpoint Question
"What would happen if you removed the MAX_ITERATIONS guard? Describe the failure mode and why it matters especially in a high-transaction system."

---

## Phase 6 — Production Hardening

### Goal
Make everything built in Phases 0–5 safe for a real high-traffic flash sale event.

**Read `references/production-checklist.md` for the full implementation of each item.**

Summary of what to cover:
1. **Rate limiting LLM calls** — Anthropic has per-minute token limits; during a flash sale spike, protect yourself
2. **Redis caching for LLM responses** — sale descriptions for the same product don't need to be regenerated per request
3. **Circuit breaker** — if Anthropic returns 3 consecutive 5xx errors, stop calling and use fallback for N minutes
4. **Cost monitoring** — log `usage.input_tokens` and `usage.output_tokens` from every response; at scale these add up fast
5. **Timeout configuration** — set explicit timeouts on every LLM call; never let a slow API call block your transaction path
6. **Observability** — trace every LLM call with correlation IDs so you can debug production issues

### Checkpoint Question
"In your flash sale system, a product page triggers an AI description generation on every page load. During a flash sale event you get 50,000 requests per minute. What is the first thing you would implement to prevent this from either being extremely expensive or getting rate-limited?"
