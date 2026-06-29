import { Module } from '@nestjs/common';
import { PrismaService } from '../../shared/infrastructure/database/prisma.service';
import { PRODUCT_REPOSITORY } from './domain/product.repository';
import { RESERVATION_REPOSITORY } from './domain/reservation.repository';
import { PrismaProductRepository } from './infrastructure/persistence/prisma-product.repository';
import { PrismaReservationRepository } from './infrastructure/persistence/prisma-reservation.repository';
import { ReserveStockUseCase } from './application/use-cases/reserve-stock.use-case';
import { CreateProductUseCase } from './application/use-cases/create-product.use-case';
import { ReleaseReservationUseCase } from './application/use-cases/release-reservation.use-case';
import { ConfirmReservationUseCase } from './application/use-cases/confirm-reservation.use-case';
import { InventoryController } from './http/inventory.controller';

/**
 * InventoryModule
 *
 * This is where NestJS DI wiring happens for the Inventory bounded context.
 * The key pattern: we bind the PRODUCT_REPOSITORY symbol to the concrete
 * Prisma implementation. The use cases only depend on the symbol (interface),
 * so swapping the implementation (e.g. for tests) means changing one line here.
 *
 * Spring equivalent:
 *   @Bean public IProductRepository productRepository() {
 *     return new PrismaProductRepository(prisma);
 *   }
 */
@Module({
  controllers: [InventoryController],
  providers: [
    PrismaService,
    {
      provide: PRODUCT_REPOSITORY,
      useClass: PrismaProductRepository,
    },
    {
      provide: RESERVATION_REPOSITORY,
      useClass: PrismaReservationRepository,
    },
    ReserveStockUseCase,
    CreateProductUseCase,
    ReleaseReservationUseCase,
    ConfirmReservationUseCase,
  ],
  exports: [
    ReserveStockUseCase,
    ConfirmReservationUseCase,
    ReleaseReservationUseCase,
  ],
})
export class InventoryModule {}
