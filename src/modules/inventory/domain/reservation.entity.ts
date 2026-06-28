import { randomUUID } from 'crypto';
import { BaseEntity } from '../../../shared/domain/base-entity';
import { ProductId } from './value-objects/product-id.vo';

export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  RELEASED = 'RELEASED',
}

// How long a reservation holds stock before it expires (15 minutes)
const RESERVATION_TTL_MS = 15 * 60 * 1000;

/**
 * Reservation — Entity (Inventory context)
 *
 * A reservation is a time-limited claim on one unit of a product's stock.
 * It is created when a user initiates checkout and released when:
 *  - The order is confirmed (payment succeeded) → status: CONFIRMED
 *  - The order is cancelled or payment failed  → status: RELEASED
 *  - The TTL expires before the user acts       → status: RELEASED
 *
 * This is an Entity (not an Aggregate Root) because it cannot exist without
 * a Product. Its lifecycle is bounded by the Product's existence.
 *
 * Invariants enforced:
 *  - A CONFIRMED reservation cannot be released
 *  - A RELEASED reservation cannot be confirmed
 *  - Expiry status is derived from time, not stored (prevents stale state)
 */
export class Reservation extends BaseEntity<string> {
  private _status: ReservationStatus;
  readonly productId: ProductId;
  readonly userId: string;
  readonly quantity: number;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: {
    id: string;
    productId: ProductId;
    userId: string;
    quantity: number;
    status: ReservationStatus;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }) {
    super(props.id);
    this._status = props.status;
    this.productId = props.productId;
    this.userId = props.userId;
    this.quantity = props.quantity;
    this.expiresAt = props.expiresAt;
    this.createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static create(productId: ProductId, userId: string, quantity: number): Reservation {
    const now = new Date();
    return new Reservation({
      id: randomUUID(),
      productId,
      userId,
      quantity,
      status: ReservationStatus.PENDING,
      expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: {
    id: string;
    productId: string;
    userId: string;
    quantity: number;
    status: ReservationStatus;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): Reservation {
    return new Reservation({
      ...props,
      productId: ProductId.create(props.productId),
    });
  }

  // ---------------------------------------------------------------------------
  // State transitions — guard invariants explicitly
  // ---------------------------------------------------------------------------

  confirm(): void {
    if (this._status !== ReservationStatus.PENDING) {
      throw new Error(
        `Cannot confirm a reservation in status: ${this._status}`,
      );
    }
    if (this.isExpired()) {
      throw new Error('Cannot confirm an expired reservation');
    }
    this._status = ReservationStatus.CONFIRMED;
    this._updatedAt = new Date();
  }

  release(): void {
    if (this._status === ReservationStatus.CONFIRMED) {
      throw new Error('Cannot release a confirmed reservation');
    }
    this._status = ReservationStatus.RELEASED;
    this._updatedAt = new Date();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  isExpired(): boolean {
    return new Date() > this.expiresAt;
  }

  get status(): ReservationStatus {
    return this._status;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }
}
