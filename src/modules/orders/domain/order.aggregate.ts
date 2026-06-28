import { BaseEntity } from '@shared/domain/base-entity';
import { OrderId } from '@modules/orders/domain/value-objects/order-id.vo';

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

interface OrderProps {
  reservationId: string;
  userId: string;
  quantity: number;
  status: OrderStatus;
  totalAmount: number;
  currency: string;
  idempotencyKey: string;
  createdAt: Date;
}

export class Order extends BaseEntity<OrderId> {
  readonly reservationId: string;
  readonly userId: string;
  readonly quantity: number;
  readonly totalAmount: number;
  readonly currency: string;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  private _status: OrderStatus;

  private constructor(id: OrderId, props: OrderProps) {
    super(id);
    this.reservationId = props.reservationId;
    this.userId = props.userId;
    this.quantity = props.quantity;
    this._status = props.status;
    this.totalAmount = props.totalAmount;
    this.currency = props.currency;
    this.idempotencyKey = props.idempotencyKey;
    this.createdAt = props.createdAt;
  }

  static place(props: {
    reservationId: string;
    userId: string;
    quantity: number;
    totalAmount: number;
    currency: string;
    idempotencyKey: string;
  }): Order {
    return new Order(OrderId.generate(), {
      ...props,
      status: OrderStatus.PENDING,
      createdAt: new Date(),
    });
  }

  static reconstitute(props: {
    id: string;
    reservationId: string;
    userId: string;
    quantity: number;
    status: OrderStatus;
    totalAmount: number;
    currency: string;
    idempotencyKey: string;
    createdAt: Date;
  }): Order {
    return new Order(OrderId.create(props.id), props);
  }

  confirm(): void {
    if (this._status !== OrderStatus.PENDING) {
      throw new Error(`Cannot confirm an order in status: ${this._status}`);
    }
    this._status = OrderStatus.CONFIRMED;
  }

  cancel(): void {
    if (this._status !== OrderStatus.PENDING) {
      throw new Error(`Cannot cancel an order in status: ${this._status}`);
    }
    this._status = OrderStatus.CANCELLED;
  }

  get status(): OrderStatus {
    return this._status;
  }
}
