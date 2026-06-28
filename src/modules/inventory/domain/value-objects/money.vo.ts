export type SupportedCurrency = 'CAD' | 'USD';

/**
 * Money — Value Object
 *
 * Amount is stored in the smallest currency unit (cents) to avoid
 * floating-point arithmetic errors. $99.99 is stored as 9999.
 *
 * Interview: why store money as integers?
 * Floating point: 0.1 + 0.2 === 0.30000000000000004 in JavaScript.
 * If you store prices as floats and do arithmetic, rounding errors accumulate
 * and you end up charging a user $99.999999 or applying a discount incorrectly.
 * Integers are exact. Always store money in cents.
 *
 * Currency is always carried with the amount. A $100 CAD and $100 USD are
 * NOT the same value. Separating them would allow a bug where the currency
 * is forgotten and operations mix incompatible amounts.
 */
export class Money {
  private constructor(
    readonly amountInCents: number,
    readonly currency: SupportedCurrency,
  ) {}

  static of(amountInCents: number, currency: SupportedCurrency): Money {
    if (!Number.isInteger(amountInCents)) {
      throw new Error('Money amount must be an integer (cents)');
    }
    if (amountInCents < 0) {
      throw new Error('Money amount cannot be negative');
    }
    return new Money(amountInCents, currency);
  }

  get displayAmount(): string {
    return `${(this.amountInCents / 100).toFixed(2)} ${this.currency}`;
  }

  equals(other: Money): boolean {
    return (
      this.amountInCents === other.amountInCents &&
      this.currency === other.currency
    );
  }

  toString(): string {
    return this.displayAmount;
  }
}
