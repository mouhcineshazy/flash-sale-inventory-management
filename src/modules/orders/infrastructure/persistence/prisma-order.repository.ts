import { Injectable } from '@nestjs/common';
import { PrismaService } from '@shared/infrastructure/database/prisma.service';
import { IOrderRepository } from '@modules/orders/domain/IOrderRepository';
import { Order, OrderStatus } from '@modules/orders/domain/order.aggregate';
import {Prisma} from "../../../../generated/prisma/client";

@Injectable()
export class PrismaOrderRepository implements IOrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(order: Order): Promise<void> {
    try{
      await this.prisma.order.upsert({
        where: { id: order.id.value },
        create: {
          id: order.id.value,
          reservationId: order.reservationId,
          userId: order.userId,
          quantity: order.quantity,
          status: order.status,
          totalAmount: order.totalAmount,
          currency: order.currency,
          idempotencyKey: order.idempotencyKey,
          createdAt: order.createdAt,
        },
        update: {
          status: order.status,
        },
      });
    } catch (error) {
      const isIdempotencyKeyConflict =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          (error.meta?.target as string[])?.includes('idempotencyKey');
      if (isIdempotencyKeyConflict) {
        return;
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Order | null> {
    const record = await this.prisma.order.findUnique({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<Order | null> {
    const record = await this.prisma.order.findUnique({ where: { idempotencyKey } });
    return record ? this.toDomain(record) : null;
  }

  async findByUserId(userId: string): Promise<Order[]> {
    const records = await this.prisma.order.findMany({ where: { userId } });
    return records.map((r) => this.toDomain(r));
  }

  private toDomain(record: {
    id: string;
    reservationId: string;
    userId: string;
    quantity: number;
    status: string;
    totalAmount: number;
    currency: string;
    idempotencyKey: string;
    createdAt: Date;
  }): Order {
    return Order.reconstitute({
      id: record.id,
      reservationId: record.reservationId,
      userId: record.userId,
      quantity: record.quantity,
      status: record.status as OrderStatus,
      totalAmount: record.totalAmount,
      currency: record.currency,
      idempotencyKey: record.idempotencyKey,
      createdAt: record.createdAt,
    });
  }
}
