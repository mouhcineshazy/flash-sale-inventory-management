import { Injectable, Inject, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { ProductId } from '../../domain/value-objects/product-id.vo';
import { Reservation } from '../../domain/reservation.entity';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/product.repository';
import { RESERVATION_REPOSITORY, IReservationRepository } from '../../domain/reservation.repository';

export interface ReserveStockCommand {
  productId: string;
  userId: string;
  quantity: number;
}

export interface ReserveStockResult {
  reservationId: string;
  expiresAt: Date;
  priceAmount: number;
  currency: string;
}

/**
 * ReserveStockUseCase
 *
 * Orchestrates the stock reservation flow:
 *  1. Atomically decrement stock in the DB (prevents overselling)
 *  2. If decrement succeeds, create a Reservation entity
 *  3. Persist the reservation
 *  4. Return the reservation ID to the caller
 *
 * Why is this an application service and not a domain service?
 *  - It coordinates between two repositories (Product + Reservation)
 *  - It handles infrastructure concerns (transactions, logging)
 *  - The domain objects (Product, Reservation) contain the business rules
 *  - This class contains the orchestration logic
 *
 * Transaction boundary (V1): two separate writes — no shared transaction.
 * decrementStockAtomic is a single atomic UPDATE (self-sufficient).
 * If reservationRepository.save() fails after decrement, stock is orphaned
 * until TTL expiry. Production fix: Unit of Work pattern.
 */
@Injectable()
export class ReserveStockUseCase {
  private readonly logger = new Logger(ReserveStockUseCase.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: IReservationRepository,
  ) {}

  async execute(command: ReserveStockCommand): Promise<ReserveStockResult> {
    const productId = ProductId.create(command.productId);

    // decrementStockAtomic is a single atomic UPDATE — no explicit transaction needed.
    // If reservationRepository.save() fails after decrement, stock is orphaned until TTL expiry.
    // Production fix: Unit of Work pattern passing tx client through repositories.
    const product = await this.productRepository.decrementStockAtomic(productId, command.quantity);

    if (!product) {
      const exists = await this.productRepository.findById(productId);
      if (!exists) {
        throw new NotFoundException(`Product ${command.productId} not found`);
      }
      throw new ConflictException(
        `Product "${exists.name}" has insufficient stock for quantity ${command.quantity}`,
      );
    }

    const reservation = Reservation.create(
      productId,
      command.userId,
      command.quantity,
      product.price.amountInCents,
      product.price.currency,
    );
    await this.reservationRepository.save(reservation);

    this.logger.log(
      `Stock reserved: product=${command.productId} user=${command.userId} reservation=${reservation.id}`,
    );

    return {
      reservationId: reservation.id,
      expiresAt: reservation.expiresAt,
      priceAmount: reservation.priceAmount,
      currency: reservation.currency,
    };
  }
}
