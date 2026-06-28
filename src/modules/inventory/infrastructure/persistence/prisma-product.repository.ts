import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../shared/infrastructure/database/prisma.service';
import { IProductRepository } from '../../domain/product.repository';
import { Product } from '../../domain/product.aggregate';
import { ProductId } from '../../domain/value-objects/product-id.vo';
import { SupportedCurrency } from '../../domain/value-objects/money.vo';

/**
 * PrismaProductRepository — Adapter (Infrastructure layer)
 *
 * Translates between Prisma records (plain objects) and Product domain objects.
 * The domain layer never sees Prisma types — only domain types cross that boundary.
 *
 * decrementStockAtomic strategy (Prisma 7.x):
 *
 * Instead of raw SQL, we use Prisma's built-in atomic operations:
 *   updateMany({ where: { id, stock > 0 }, data: { stock: { decrement: 1 } } })
 *
 * Under the hood Prisma emits:
 *   UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0
 *
 * PostgreSQL's MVCC serializes concurrent writes on the same row.
 * Only one writer wins per stock unit — no overselling possible.
 * `result.count === 0` means either product not found OR stock was 0.
 */
@Injectable()
export class PrismaProductRepository implements IProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: ProductId): Promise<Product | null> {
    const record = await this.prisma.product.findUnique({
      where: { id: id.value },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async decrementStockAtomic(id: ProductId, quantity: number): Promise<Product | null> {
    // Step 1: atomically decrement — only succeeds if stock >= quantity
    const result = await this.prisma.product.updateMany({
      where: {
        id: id.value,
        stock: { gte: quantity },
      },
      data: {
        stock: { decrement: quantity },
      },
    });

    // count === 0 means product doesn't exist OR stock was already 0
    if (result.count === 0) return null;

    // Step 2: fetch the updated record to return to the caller
    // A second read is acceptable here — we only need the updated state
    // for the response; the atomic decrement above is the correctness guarantee.
    const record = await this.prisma.product.findUnique({
      where: { id: id.value },
    });

    if (!record) return null;
    return this.toDomain(record);
  }

  async save(product: Product): Promise<void> {
    await this.prisma.product.upsert({
      where: { id: product.id.value },
      create: this.toPrismaCreate(product),
      update: this.toPrismaUpdate(product),
    });
  }

  // ---------------------------------------------------------------------------
  // Mapping helpers
  // ---------------------------------------------------------------------------

  private toDomain(record: {
    id: string;
    name: string;
    description: string | null;
    priceAmount: number;
    currency: string;
    stock: number;
    createdAt: Date;
    updatedAt: Date;
  }): Product {
    return Product.reconstitute({
      id: record.id,
      name: record.name,
      description: record.description ?? undefined,
      priceAmount: record.priceAmount,
      currency: record.currency as SupportedCurrency,
      stock: record.stock,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }

  private toPrismaCreate(product: Product) {
    return {
      id: product.id.value,
      name: product.name,
      description: product.description,
      priceAmount: product.price.amountInCents,
      currency: product.price.currency,
      stock: product.stock.value,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private toPrismaUpdate(product: Product) {
    return {
      name: product.name,
      description: product.description,
      priceAmount: product.price.amountInCents,
      currency: product.price.currency,
      stock: product.stock.value,
      updatedAt: product.updatedAt,
    };
  }
}
