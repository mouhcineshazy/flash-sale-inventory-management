import { Order } from './order.aggregate';

export const ORDER_REPOSITORY = Symbol('IOrderRepository');

export interface IOrderRepository {
  save(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<Order | null>;
  findByUserId(userId: string): Promise<Order[]>;
}
