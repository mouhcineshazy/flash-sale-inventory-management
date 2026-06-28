import { BaseEntity } from '../../../shared/domain/base-entity';
import { ProductId } from './value-objects/product-id.vo';
import { StockCount } from './value-objects/stock-count.vo';
import { Money, SupportedCurrency } from './value-objects/money.vo';

interface ProductProps {
  name: string;
  description?: string;
  price: Money;
  stock: StockCount;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Product — Aggregate Root (Inventory context)
 *
 * This is the most important class in the Inventory bounded context.
 * All invariants around stock are enforced here. No service should
 * directly manipulate stock counts — they go through this aggregate.
 *
 * DDD: an Aggregate Root is the only entry point to the aggregate.
 * External code holds a reference to Product, not to its internals.
 *
 * Key invariants enforced:
 *  1. Stock cannot go below zero (oversell prevention at the domain level)
 *  2. A product name cannot be empty
 *  3. Price cannot be negative
 *
 * Note: the atomic SQL update in the repository is the REAL concurrency
 * guard at the database level. This domain decrement is the in-memory
 * representation — it runs after the DB update succeeds, keeping the
 * loaded aggregate consistent within the current request.
 */
export class Product extends BaseEntity<ProductId> {
  private _name: string;
  private _description: string | undefined;
  private _price: Money;
  private _stock: StockCount;
  readonly createdAt: Date;
  private _updatedAt: Date;

  private constructor(id: ProductId, props: ProductProps) {
    super(id);
    this._name = props.name;
    this._description = props.description;
    this._price = props.price;
    this._stock = props.stock;
    this.createdAt = props.createdAt;
    this._updatedAt = props.updatedAt;
  }

  // ---------------------------------------------------------------------------
  // Factory methods
  // ---------------------------------------------------------------------------

  static create(props: {
    name: string;
    description?: string;
    priceAmount: number;
    currency: SupportedCurrency;
    initialStock: number;
  }): Product {
    if (!props.name || props.name.trim().length === 0) {
      throw new Error('Product name cannot be empty');
    }

    const now = new Date();
    return new Product(ProductId.generate(), {
      name: props.name.trim(),
      description: props.description?.trim(),
      price: Money.of(props.priceAmount, props.currency),
      stock: StockCount.create(props.initialStock),
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * Reconstitutes a Product from a persistence record.
   * Used by the repository when loading from the database.
   * Does NOT go through the same validation as create() because
   * we trust that data already in the DB is valid.
   */
  static reconstitute(props: {
    id: string;
    name: string;
    description?: string;
    priceAmount: number;
    currency: SupportedCurrency;
    stock: number;
    createdAt: Date;
    updatedAt: Date;
  }): Product {
    return new Product(ProductId.create(props.id), {
      name: props.name,
      description: props.description,
      price: Money.of(props.priceAmount, props.currency),
      stock: StockCount.create(props.stock),
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Behaviour
  // ---------------------------------------------------------------------------

  /**
   * Reserves one unit of stock for a user.
   * Throws if stock is unavailable — the repository layer then rolls back
   * the transaction and returns a 409 to the caller.
   *
   * Note: in the high-transaction path, the actual stock decrement happens
   * atomically in the DB via an UPDATE ... WHERE stock > 0 query.
   * This method is the domain-layer representation of that operation.
   */
  reserveStock(): void {
    if (!this._stock.isAvailable()) {
      throw new Error(`Product "${this._name}" is out of stock`);
    }
    this._stock = this._stock.decrement();
    this._updatedAt = new Date();
  }

  /**
   * Releases a previously reserved unit back to available stock.
   * Called when a reservation expires or an order is cancelled.
   */
  releaseStock(): void {
    this._stock = this._stock.increment();
    this._updatedAt = new Date();
  }

  // ---------------------------------------------------------------------------
  // Accessors (read-only outside the aggregate)
  // ---------------------------------------------------------------------------

  get name(): string {
    return this._name;
  }

  get description(): string | undefined {
    return this._description;
  }

  get price(): Money {
    return this._price;
  }

  get stock(): StockCount {
    return this._stock;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }
}
