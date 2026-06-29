import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IOrderRepository, ORDER_REPOSITORY } from '@modules/orders/domain/IOrderRepository';
import { Order, OrderStatus } from '@modules/orders/domain/order.aggregate';
import { ReserveStockUseCase } from '@modules/inventory/application/use-cases/reserve-stock.use-case';

export interface PlaceOrderCommand {
  productId: string;
  userId: string;
  quantity: number;
  idempotencyKey: string;
}

export interface PlaceOrderResult {
  orderId: string;
  reservationId: string;
  totalAmount: number;
  currency: string;
  status: OrderStatus;
}

@Injectable()
export class PlaceOrderUseCase {
  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: IOrderRepository,
    private readonly reserveStockUseCase: ReserveStockUseCase,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    const existing = await this.orderRepository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      return this.toResult(existing);
    }

    // Reserve stock — price is snapshotted onto the reservation at this moment,
    // eliminating any race between price lookup and order creation.
    const reservation = await this.reserveStockUseCase.execute({
      productId: command.productId,
      userId: command.userId,
      quantity: command.quantity,
    });

    const order = Order.place({
      reservationId: reservation.reservationId,
      userId: command.userId,
      quantity: command.quantity,
      totalAmount: reservation.priceAmount * command.quantity,
      currency: reservation.currency,
      idempotencyKey: command.idempotencyKey,
    });

    await this.orderRepository.save(order);
    return this.toResult(order);
  }

  private toResult(order: Order): PlaceOrderResult {
    return {
      orderId: order.id.value,
      reservationId: order.reservationId,
      totalAmount: order.totalAmount,
      currency: order.currency,
      status: order.status,
    };
  }
}
