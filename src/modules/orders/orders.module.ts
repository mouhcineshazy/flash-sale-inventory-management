import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { PrismaService } from '../../shared/infrastructure/database/prisma.service';
import { ORDER_REPOSITORY } from './domain/IOrderRepository';
import { PrismaOrderRepository } from './infrastructure/persistence/prisma-order.repository';
import { PlaceOrderUseCase } from './application/use-cases/place-order.use-case';
import { OrdersController } from './http/orders.controller';

@Module({
  imports: [InventoryModule],
  controllers: [OrdersController],
  providers: [
    PrismaService,
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
    PlaceOrderUseCase,
  ],
})
export class OrdersModule {}
