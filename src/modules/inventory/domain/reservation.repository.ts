import { Reservation } from './reservation.entity';
import { ProductId } from './value-objects/product-id.vo';

export const RESERVATION_REPOSITORY = Symbol('IReservationRepository');

export interface IReservationRepository {
  findById(id: string): Promise<Reservation | null>;

  findPendingByUserAndProduct(
    userId: string,
    productId: ProductId,
  ): Promise<Reservation | null>;

  save(reservation: Reservation): Promise<void>;

  /**
   * Updates only the status and updatedAt fields.
   * Used for confirm/release operations — avoids re-writing the full record.
   */
  updateStatus(reservation: Reservation): Promise<void>;
}
