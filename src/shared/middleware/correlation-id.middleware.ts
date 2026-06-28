import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * CorrelationIdMiddleware
 *
 * Attaches a unique X-Correlation-ID header to every request/response.
 * This ID flows through all log entries for that request, making it
 * possible to trace a single request across logs in Kibana, Datadog, etc.
 *
 * If the caller already sends an X-Correlation-ID (e.g. from an API gateway
 * or upstream service), we respect it. Otherwise we generate a new UUID.
 *
 * Interview concept: this is how distributed tracing works at the HTTP layer
 * before you add something like OpenTelemetry. Simple, zero-dependency.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? randomUUID();

    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('X-Correlation-ID', correlationId);

    next();
  }
}
