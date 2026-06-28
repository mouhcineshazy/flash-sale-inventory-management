import { Injectable, Inject, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { ProductId } from '../../domain/value-objects/product-id.vo';
import { Reservation } from '../../domain/reservation.entity';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/product.repository';
import { RESERVATION_REPOSITORY, IReservationRepository } from '../../domain/reservation.repository';
import { PrismaService } from '../../../../shared/infrastructure/database/prisma.service';

export interface ReserveStockCommand {
  productId: string;
  userId: string;
  quantity: number;
}

export interface ReserveStockResult {
  reservationId: string;
  expiresAt: Date;
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
 * Transaction boundary: the $transaction wraps both the stock decrement
 * and the reservation insert atomically. If the reservation insert fails,
 * the stock decrement is rolled back and no stock is lost.
 */
@Injectable()
export class ReserveStockUseCase {
  private readonly logger = new Logger(ReserveStockUseCase.name);

  constructor(
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: IReservationRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: ReserveStockCommand): Promise<ReserveStockResult> {
    const productId = ProductId.create(command.productId);

    return this.prisma.$transaction(async () => {
      // Atomic decrement — returns null if product not found or stock === 0
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

      const reservation = Reservation.create(productId, command.userId, command.quantity);
      await this.reservationRepository.save(reservation);

      this.logger.log(
        `Stock reserved: product=${command.productId} user=${command.userId} reservation=${reservation.id}`,
      );

      return {
        reservationId: reservation.id,
        expiresAt: reservation.expiresAt,
      };
    });
  }
}
