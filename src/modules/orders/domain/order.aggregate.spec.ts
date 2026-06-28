import { Order, OrderStatus } from './order.aggregate';

const makeOrder = () =>
  Order.place({
    reservationId: 'res-uuid',
    userId: 'user-uuid',
    quantity: 2,
    totalAmount: 19998,
    currency: 'USD',
    idempotencyKey: 'idem-key-uuid',
  });

describe('Order Aggregate', () => {
  describe('place()', () => {
    it('should create an order in PENDING status', () => {
      const order = makeOrder();
      expect(order.status).toBe(OrderStatus.PENDING);
    });

    it('should assign all provided fields', () => {
      const order = makeOrder();
      expect(order.reservationId).toBe('res-uuid');
      expect(order.userId).toBe('user-uuid');
      expect(order.quantity).toBe(2);
      expect(order.totalAmount).toBe(19998);
      expect(order.currency).toBe('USD');
      expect(order.idempotencyKey).toBe('idem-key-uuid');
    });

    it('should generate a unique id', () => {
      const a = makeOrder();
      const b = makeOrder();
      expect(a.id.value).not.toBe(b.id.value);
    });
  });

  describe('confirm()', () => {
    it('should transition PENDING to CONFIRMED', () => {
      const order = makeOrder();
      order.confirm();
      expect(order.status).toBe(OrderStatus.CONFIRMED);
    });

    it('should throw if order is already CONFIRMED', () => {
      const order = makeOrder();
      order.confirm();
      expect(() => order.confirm()).toThrow('Cannot confirm an order in status: CONFIRMED');
    });

    it('should throw if order is CANCELLED', () => {
      const order = makeOrder();
      order.cancel();
      expect(() => order.confirm()).toThrow('Cannot confirm an order in status: CANCELLED');
    });
  });

  describe('cancel()', () => {
    it('should transition PENDING to CANCELLED', () => {
      const order = makeOrder();
      order.cancel();
      expect(order.status).toBe(OrderStatus.CANCELLED);
    });

    it('should throw if order is already CANCELLED', () => {
      const order = makeOrder();
      order.cancel();
      expect(() => order.cancel()).toThrow('Cannot cancel an order in status: CANCELLED');
    });

    it('should throw if order is CONFIRMED', () => {
      const order = makeOrder();
      order.confirm();
      expect(() => order.cancel()).toThrow('Cannot cancel an order in status: CONFIRMED');
    });
  });

  describe('reconstitute()', () => {
    it('should restore order with the persisted status', () => {
      const order = Order.reconstitute({
        id: 'order-uuid',
        reservationId: 'res-uuid',
        userId: 'user-uuid',
        quantity: 1,
        status: OrderStatus.CONFIRMED,
        totalAmount: 9999,
        currency: 'CAD',
        idempotencyKey: 'idem-key',
        createdAt: new Date(),
      });
      expect(order.id.value).toBe('order-uuid');
      expect(order.status).toBe(OrderStatus.CONFIRMED);
    });
  });
});
