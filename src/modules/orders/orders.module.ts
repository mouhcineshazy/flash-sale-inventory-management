import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';

/**
 * OrdersModule — stub
 *
 * Will contain:
 *  - Order aggregate
 *  - PlaceOrderUseCase (creates Order in PENDING state, calls ReserveStock)
 *  - ProcessPaymentUseCase (simulates payment, confirms or releases reservation)
 *  - OrdersController
 *
 * Imports InventoryModule to access ConfirmReservationUseCase and
 * ReleaseReservationUseCase after payment result is known.
 *
 * TODO: implement in Session 03
 */
@Module({
  imports: [InventoryModule],
  controllers: [],
  providers: [],
})
export class OrdersModule {}
