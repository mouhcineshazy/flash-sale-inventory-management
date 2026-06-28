/**
 * BaseEntity
 *
 * All domain entities extend this. It enforces identity-based equality.
 *
 * DDD rule: two entities with the same ID are the same entity regardless
 * of their other properties. This is the opposite of Value Objects,
 * where two instances with identical values are considered equal.
 *
 * Generic T constrains the ID type (string, number, a typed VO, etc.)
 * so subclasses get proper type safety on their identity field.
 */
export abstract class BaseEntity<T> {
  protected readonly _id: T;

  protected constructor(id: T) {
    this._id = id;
  }

  get id(): T {
    return this._id;
  }

  equals(other: BaseEntity<T>): boolean {
    if (!(other instanceof BaseEntity)) return false;
    return this._id === other._id;
  }
}
