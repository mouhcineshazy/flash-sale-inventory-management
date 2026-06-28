import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from './modules/inventory/inventory.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CorrelationIdMiddleware } from './shared/middleware/correlation-id.middleware';

@Module({
  imports: [
    // ConfigModule makes process.env values available via ConfigService
    // isGlobal: true means you don't need to import it in every module
    ConfigModule.forRoot({ isGlobal: true }),
    InventoryModule,
    OrdersModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply correlation ID middleware to every route
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
