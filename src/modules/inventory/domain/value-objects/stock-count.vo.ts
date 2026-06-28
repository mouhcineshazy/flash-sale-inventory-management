/**
 * StockCount — Value Object
 *
 * Encapsulates the business rules around inventory quantity:
 *  - Cannot be negative
 *  - Must be a whole number (no fractional units)
 *
 * Key pattern: mutation returns a NEW instance instead of modifying in place.
 * This is immutability. The Product aggregate holds a StockCount reference
 * and replaces it on each state change. Old values are not mutated.
 *
 * Why does this matter in practice?
 * If StockCount were mutable and shared, one service reducing stock could
 * silently affect another piece of code holding the same reference.
 * Immutability makes this impossible.
 */
export class StockCount {
  private constructor(readonly value: number) {}

  static create(value: number): StockCount {
    if (!Number.isInteger(value)) {
      throw new Error(`StockCount must be an integer, received: ${value}`);
    }
    if (value < 0) {
      throw new Error(`StockCount cannot be negative, received: ${value}`);
    }
    return new StockCount(value);
  }

  static zero(): StockCount {
    return new StockCount(0);
  }

  decrement(): StockCount {
    if (this.value === 0) {
      throw new Error('Cannot decrement stock below zero');
    }
    return new StockCount(this.value - 1);
  }

  increment(): StockCount {
    return new StockCount(this.value + 1);
  }

  isAvailable(): boolean {
    return this.value > 0;
  }

  equals(other: StockCount): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return String(this.value);
  }
}
