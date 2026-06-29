import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/database/prisma.service';
import { IReservationRepository } from '../../domain/reservation.repository';
import { Reservation, ReservationStatus } from '../../domain/reservation.entity';
import { ProductId } from '../../domain/value-objects/product-id.vo';

@Injectable()
export class PrismaReservationRepository implements IReservationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Reservation | null> {
    const record = await this.prisma.reservation.findUnique({
      where: { id },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async findPendingByUserAndProduct(
    userId: string,
    productId: ProductId,
  ): Promise<Reservation | null> {
    const record = await this.prisma.reservation.findFirst({
      where: {
        userId,
        productId: productId.value,
        status: 'PENDING',
      },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async save(reservation: Reservation): Promise<void> {
    await this.prisma.reservation.create({
      data: {
        id: reservation.id,
        productId: reservation.productId.value,
        userId: reservation.userId,
        quantity: reservation.quantity,
        priceAmount: reservation.priceAmount,
        currency: reservation.currency,
        status: reservation.status,
        expiresAt: reservation.expiresAt,
        createdAt: reservation.createdAt,
        updatedAt: reservation.updatedAt,
      },
    });
  }

  async updateStatus(reservation: Reservation): Promise<void> {
    await this.prisma.reservation.update({
      where: { id: reservation.id },
      data: {
        status: reservation.status,
        updatedAt: reservation.updatedAt,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Mapping
  // ---------------------------------------------------------------------------

  private toDomain(record: {
    id: string;
    productId: string;
    userId: string;
    quantity: number;
    priceAmount: number;
    currency: string;
    status: string;
    expiresAt: Date;
    createdAt: Date;
    updatedAt: Date;
  }): Reservation {
    return Reservation.reconstitute({
      id: record.id,
      productId: record.productId,
      userId: record.userId,
      quantity: record.quantity,
      priceAmount: record.priceAmount,
      currency: record.currency,
      status: record.status as ReservationStatus,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}
