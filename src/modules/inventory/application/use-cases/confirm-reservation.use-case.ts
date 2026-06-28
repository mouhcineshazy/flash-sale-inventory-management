import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { RESERVATION_REPOSITORY, IReservationRepository } from '../../domain/reservation.repository';

export interface ConfirmReservationCommand {
  reservationId: string;
}

/**
 * ConfirmReservationUseCase
 *
 * Called by the Orders context after payment succeeds.
 * Marks the reservation as CONFIRMED so it is no longer eligible
 * for TTL expiry or accidental release.
 *
 * Stock is NOT returned here — the unit is consumed by the order.
 * The decremented stock count stays as-is.
 *
 * Notice this use case does NOT need a transaction for a single-row
 * status update. A transaction is only necessary when multiple writes
 * need to be atomic. Single-row updates are already atomic in PostgreSQL.
 */
@Injectable()
export class ConfirmReservationUseCase {
  private readonly logger = new Logger(ConfirmReservationUseCase.name);

  constructor(
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: IReservationRepository,
  ) {}

  async execute(command: ConfirmReservationCommand): Promise<void> {
    const reservation = await this.reservationRepository.findById(
      command.reservationId,
    );

    if (!reservation) {
      throw new NotFoundException(
        `Reservation ${command.reservationId} not found`,
      );
    }

    // Domain invariant — throws if expired or already confirmed/released
    reservation.confirm();

    await this.reservationRepository.updateStatus(reservation);

    this.logger.log(`Reservation confirmed: id=${command.reservationId}`);
  }
}
