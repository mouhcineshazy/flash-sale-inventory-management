import { Product } from './product.aggregate';
import { ProductId } from './value-objects/product-id.vo';

/**
 * IProductRepository — Port (Hexagonal Architecture)
 *
 * This interface lives in the domain layer. It defines what persistence
 * operations the domain needs — without knowing anything about SQL, Prisma,
 * or any other infrastructure detail.
 *
 * The infrastructure layer provides the concrete implementation (adapter).
 * NestJS DI wires them together at runtime.
 *
 * Why an interface here?
 *  - The domain never depends on infrastructure (Dependency Inversion)
 *  - You can swap Prisma for TypeORM or an in-memory implementation for tests
 *    without touching a single line of domain or application code
 *
 * The `tx` parameter on mutating methods accepts an optional transaction client.
 * When present, the query runs within that transaction.
 * When absent, it runs standalone.
 */
export const PRODUCT_REPOSITORY = Symbol('IProductRepository');

export interface IProductRepository {
  findById(id: ProductId): Promise<Product | null>;

  /**
   * Atomically decrements stock by 1 and returns the updated Product.
   * Returns null if the product does not exist or stock is already 0.
   *
   * This is the core of our oversell prevention strategy. The implementation
   * uses: UPDATE products SET stock = stock - 1 WHERE id = ? AND stock > 0
   */
  decrementStockAtomic(id: ProductId, quantity: number): Promise<Product | null>;

  save(product: Product): Promise<void>;
}
