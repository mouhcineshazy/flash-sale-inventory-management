import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { IOrderRepository, ORDER_REPOSITORY } from '@modules/orders/domain/IOrderRepository';
import { Order, OrderStatus } from '@modules/orders/domain/order.aggregate';
import { IProductRepository, PRODUCT_REPOSITORY } from '@modules/inventory/domain/product.repository';
import { ProductId } from '@modules/inventory/domain/value-objects/product-id.vo';
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
    @Inject(PRODUCT_REPOSITORY) private readonly productRepository: IProductRepository,
    private readonly reserveStockUseCase: ReserveStockUseCase,
  ) {}

  async execute(command: PlaceOrderCommand): Promise<PlaceOrderResult> {
    // Idempotency check — replay the original result if this key was already processed
    const existing = await this.orderRepository.findByIdempotencyKey(command.idempotencyKey);
    if (existing) {
      return this.toResult(existing);
    }

    // Cross-context read: load product from Inventory to snapshot the price
    const product = await this.productRepository.findById(ProductId.create(command.productId));
    if (!product) {
      throw new NotFoundException(`Product ${command.productId} not found`);
    }

    // Reserve stock — atomically decrements inventory and creates a Reservation
    const reservation = await this.reserveStockUseCase.execute({
      productId: command.productId,
      userId: command.userId,
      quantity: command.quantity,
    });

    const order = Order.place({
      reservationId: reservation.reservationId,
      userId: command.userId,
      quantity: command.quantity,
      totalAmount: product.price.amountInCents * command.quantity,
      currency: product.price.currency,
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
