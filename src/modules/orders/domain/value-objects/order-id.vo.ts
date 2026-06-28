import {randomUUID} from "crypto";

export class OrderId {

    constructor(readonly value: string) { }
    static create(value: string): OrderId {
        if (!value || value.trim().length === 0) {
            throw new Error('ProductId cannot be empty');
        }
        return new OrderId(value.trim());
    }

    static generate(): OrderId {
        return new OrderId(randomUUID());
    }

    equals(other: OrderId): boolean {
        return this.value === other.value;
    }

    toString(): string {
        return this.value;
    }
}