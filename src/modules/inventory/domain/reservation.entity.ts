import { randomUUID } from 'crypto';
import { BaseEntity } from '../../../shared/domain/base-entity';
import { ProductId } from './value-objects/product-id.vo';
import {DomainException} from "@shared/domain/domain.exception";

export enum ReservationStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  RELEASED = 'RELEASED',
}

const RESERVATION_TTL_MS = 15 * 60 * 1000;

export class Reservation extends BaseEntity<string> {
  private _status: ReservationStatus;
  readonly productId: ProductId;
  readonly userId: string;
  readonly quantity: number;
  readonly priceAmount: number;
  readonly currency: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  private _updatedAt: Date;

  private constructor(props: {
    id: string;
    productId: ProductId;
    userId: string;
    quantity: number;
    priceAmount: number;
    currency: string;
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
    this.priceAmount = props.priceAmount;
    this.currency = props.currency;
    this.expiresAt = props.expiresAt;
    this.createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  static create(
    productId: ProductId,
    userId: string,
    quantity: number,
    priceAmount: number,
    currency: string,
  ): Reservation {
    const now = new Date();
    return new Reservation({
      id: randomUUID(),
      productId,
      userId,
      quantity,
      priceAmount,
      currency,
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
    priceAmount: number;
    currency: string;
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

  confirm(): void {
    if (this._status !== ReservationStatus.PENDING) {
      throw new DomainException(`Cannot confirm a reservation in status: ${this._status}`);
    }
    if (this.isExpired()) {
      throw new DomainException('Cannot confirm an expired reservation');
    }
    this._status = ReservationStatus.CONFIRMED;
    this._updatedAt = new Date();
  }

  release(): void {
    if (this._status === ReservationStatus.CONFIRMED) {
      throw new DomainException('Cannot release a confirmed reservation');
    }
    this._status = ReservationStatus.RELEASED;
    this._updatedAt = new Date();
  }

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
