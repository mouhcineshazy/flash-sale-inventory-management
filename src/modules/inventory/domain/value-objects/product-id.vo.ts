import { randomUUID } from 'crypto';

/**
 * ProductId — Value Object
 *
 * Why wrap a string in a class?
 *  1. Type safety: a function accepting ProductId cannot accidentally receive
 *     a UserId or an OrderId even though all three are UUID strings at runtime.
 *  2. Invariant enforcement: we validate UUID format at construction time.
 *     An invalid ID cannot exist in the domain.
 *  3. Expressiveness: the code reads "productId" not "string".
 *
 * The private constructor + static factory pattern prevents construction
 * without going through validation.
 */
export class ProductId {
  private constructor(readonly value: string) {}

  static create(value: string): ProductId {
    if (!value || value.trim().length === 0) {
      throw new Error('ProductId cannot be empty');
    }
    return new ProductId(value.trim());
  }

  static generate(): ProductId {
    return new ProductId(randomUUID());
  }

  equals(other: ProductId): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
