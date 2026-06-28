import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { RESERVATION_REPOSITORY, IReservationRepository } from '../../domain/reservation.repository';
import { PRODUCT_REPOSITORY, IProductRepository } from '../../domain/product.repository';
import { ProductId } from '../../domain/value-objects/product-id.vo';
import { PrismaService } from '../../../../shared/infrastructure/database/prisma.service';

export interface ReleaseReservationCommand {
  reservationId: string;
}

/**
 * ReleaseReservationUseCase
 *
 * Called when:
 *  - Payment fails
 *  - User cancels before checkout
 *  - A background job expires stale reservations (TTL enforcement)
 *
 * It restores the reserved stock unit back to the product.
 * Transaction wraps both the status update and the stock increment
 * so they are atomic — no half-releases possible.
 */
@Injectable()
export class ReleaseReservationUseCase {
  private readonly logger = new Logger(ReleaseReservationUseCase.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: IReservationRepository,
    @Inject(PRODUCT_REPOSITORY)
    private readonly productRepository: IProductRepository,
    private readonly prisma: PrismaService,
  ) {}

  async execute(command: ReleaseReservationCommand): Promise<void> {
    return this.prisma.$transaction(async () => {
      const reservation = await this.reservationRepository.findById(
        command.reservationId,
      );

      if (!reservation) {
        throw new NotFoundException(
          `Reservation ${command.reservationId} not found`,
        );
      }

      // Domain invariant enforced here — throws if already confirmed
      reservation.release();

      const product = await this.productRepository.findById(
        reservation.productId,
      );

      if (!product) {
        throw new NotFoundException(
          `Product ${reservation.productId.value} not found`,
        );
      }

      product.releaseStock();

      await this.reservationRepository.updateStatus(reservation);
      await this.productRepository.save(product);

      this.logger.log(
        `Reservation released: id=${command.reservationId} product=${reservation.productId.value}`,
      );
    });
  }
}
