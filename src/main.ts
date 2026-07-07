import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { DomainExceptionFilter } from '@shared/infrastructure/filters/domain-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Structured JSON logs — TODO : swap for a Pino logger in production
    logger: ['error', 'warn', 'log', 'debug'],
  });

  // ---------------------------------------------------------------------------
  // Global validation pipe
  // class-validator decorators on DTOs are enforced here.
  // whitelist: strips properties not declared in the DTO (defense in depth)
  // forbidNonWhitelisted: rejects requests with undeclared properties
  // transform: auto-converts plain JSON to DTO class instances
  // ---------------------------------------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new DomainExceptionFilter());

  // ---------------------------------------------------------------------------
  // Swagger / OpenAPI
  // Available at http://localhost:3000/api
  // ---------------------------------------------------------------------------
  const config = new DocumentBuilder()
    .setTitle('Flash Sale Inventory API')
    .setDescription(
      'Inventory reservation and order processing platform for limited-stock product drops',
    )
    .setVersion('1.0')
    .addTag('inventory', 'Product and stock management')
    .addTag('orders', 'Order lifecycle and payment processing')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // Kubernetes sends SIGTERM before killing the pod. We listen for it and
  // tell NestJS to stop accepting new connections and drain in-flight requests.
  // Without this, active DB connections are killed mid-query.
  // ---------------------------------------------------------------------------
  app.enableShutdownHooks();

  //the SIGTERM handler is registered after app.listen(). If a signal arrives during the await app.listen() call, the timeout guard isn't in place yet. Both signal handlers — NestJS's (enableShutdownHooks) and yours —
  // should be registered before the process starts serving traffic.
  const SHUTDOWN_TIMEOUT_MS = 10_000;
  process.on('SIGTERM', () => {
    setTimeout(() => {
      // TODO: use a logger for production
      console.log('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref(); // .unref() prevents this timer from keeping the process alive
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  console.log(`Application running on http://localhost:${port}`);
  console.log(`Swagger docs at http://localhost:${port}/api`);
}

bootstrap();
