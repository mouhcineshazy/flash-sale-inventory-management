import { NotFoundException, ConflictException } from '@nestjs/common';
import { PlaceOrderUseCase } from './place-order.use-case';
import { IOrderRepository } from '@modules/orders/domain/IOrderRepository';
import { ReserveStockUseCase } from '@modules/inventory/application/use-cases/reserve-stock.use-case';
import { Order, OrderStatus } from '@modules/orders/domain/order.aggregate';

const makeExistingOrder = () =>
  Order.place({
    reservationId: 'res-uuid',
    userId: 'user-uuid',
    quantity: 1,
    totalAmount: 5000,
    currency: 'USD',
    idempotencyKey: 'existing-key',
  });

const reservationResult = {
  reservationId: 'res-uuid',
  expiresAt: new Date(),
  priceAmount: 5000,
  currency: 'USD',
};

describe('PlaceOrderUseCase', () => {
  let useCase: PlaceOrderUseCase;
  let orderRepo: jest.Mocked<IOrderRepository>;
  let reserveStockUseCase: jest.Mocked<Pick<ReserveStockUseCase, 'execute'>>;

  beforeEach(() => {
    orderRepo = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findByUserId: jest.fn(),
    };

    reserveStockUseCase = { execute: jest.fn() };

    useCase = new PlaceOrderUseCase(
      orderRepo,
      reserveStockUseCase as unknown as ReserveStockUseCase,
    );
  });

  const command = {
    productId: 'product-uuid',
    userId: 'user-uuid',
    quantity: 2,
    idempotencyKey: 'idem-key',
  };

  describe('idempotency', () => {
    it('should return the existing order without any side effects on duplicate key', async () => {
      const existing = makeExistingOrder();
      orderRepo.findByIdempotencyKey.mockResolvedValue(existing);

      const result = await useCase.execute(command);

      expect(result.orderId).toBe(existing.id.value);
      expect(reserveStockUseCase.execute).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    beforeEach(() => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      reserveStockUseCase.execute.mockResolvedValue(reservationResult);
      orderRepo.save.mockResolvedValue(undefined);
    });

    it('should calculate totalAmount from the snapshotted reservation price × quantity', async () => {
      const result = await useCase.execute(command); // quantity: 2, priceAmount: 5000
      expect(result.totalAmount).toBe(10000);
    });

    it('should use the currency from the reservation snapshot, not from the command', async () => {
      const result = await useCase.execute(command);
      expect(result.currency).toBe('USD');
    });

    it('should create the order in PENDING status', async () => {
      const result = await useCase.execute(command);
      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it('should persist the order and return the reservation id', async () => {
      const result = await useCase.execute(command);
      expect(orderRepo.save).toHaveBeenCalledTimes(1);
      expect(result.reservationId).toBe('res-uuid');
    });

    it('should call ReserveStockUseCase with productId, userId, and quantity', async () => {
      await useCase.execute(command);
      expect(reserveStockUseCase.execute).toHaveBeenCalledWith({
        productId: command.productId,
        userId: command.userId,
        quantity: command.quantity,
      });
    });
  });

  describe('failure paths', () => {
    it('should propagate NotFoundException from ReserveStockUseCase when product not found', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      reserveStockUseCase.execute.mockRejectedValue(
        new NotFoundException('Product not found'),
      );

      await expect(useCase.execute(command)).rejects.toThrow(NotFoundException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('should propagate ConflictException and not save the order when stock is insufficient', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      reserveStockUseCase.execute.mockRejectedValue(
        new ConflictException('Insufficient stock'),
      );

      await expect(useCase.execute(command)).rejects.toThrow(ConflictException);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });
});
