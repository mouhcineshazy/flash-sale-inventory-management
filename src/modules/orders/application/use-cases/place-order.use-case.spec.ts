import { NotFoundException } from '@nestjs/common';
import { PlaceOrderUseCase } from './place-order.use-case';
import { IOrderRepository } from '@modules/orders/domain/IOrderRepository';
import { IProductRepository } from '@modules/inventory/domain/product.repository';
import { ReserveStockUseCase } from '@modules/inventory/application/use-cases/reserve-stock.use-case';
import { Order, OrderStatus } from '@modules/orders/domain/order.aggregate';
import { Product } from '@modules/inventory/domain/product.aggregate';

const makeProduct = () =>
  Product.create({ name: 'Flash Hoodie', priceAmount: 5000, currency: 'USD', initialStock: 10 });

const makeExistingOrder = () =>
  Order.place({
    reservationId: 'res-uuid',
    userId: 'user-uuid',
    quantity: 1,
    totalAmount: 5000,
    currency: 'USD',
    idempotencyKey: 'existing-key',
  });

describe('PlaceOrderUseCase', () => {
  let useCase: PlaceOrderUseCase;
  let orderRepo: jest.Mocked<IOrderRepository>;
  let productRepo: jest.Mocked<IProductRepository>;
  let reserveStockUseCase: jest.Mocked<Pick<ReserveStockUseCase, 'execute'>>;

  beforeEach(() => {
    orderRepo = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findByUserId: jest.fn(),
    };

    productRepo = {
      findById: jest.fn(),
      decrementStockAtomic: jest.fn(),
      save: jest.fn(),
    };

    reserveStockUseCase = {
      execute: jest.fn(),
    };

    useCase = new PlaceOrderUseCase(
      orderRepo,
      productRepo,
      reserveStockUseCase as unknown as ReserveStockUseCase,
    );
  });

  describe('execute()', () => {
    const command = {
      productId: 'product-uuid',
      userId: 'user-uuid',
      quantity: 2,
      idempotencyKey: 'idem-key',
    };

    it('should return existing order without re-processing when idempotency key matches', async () => {
      const existing = makeExistingOrder();
      orderRepo.findByIdempotencyKey.mockResolvedValue(existing);

      const result = await useCase.execute(command);

      expect(result.orderId).toBe(existing.id.value);
      expect(productRepo.findById).not.toHaveBeenCalled();
      expect(reserveStockUseCase.execute).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when product does not exist', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(null);

      await expect(useCase.execute(command)).rejects.toThrow(NotFoundException);
    });

    it('should create order with correct totalAmount (price × quantity)', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(makeProduct()); // priceAmount: 5000
      reserveStockUseCase.execute.mockResolvedValue({
        reservationId: 'res-uuid',
        expiresAt: new Date(),
      });
      orderRepo.save.mockResolvedValue(undefined);

      const result = await useCase.execute(command); // quantity: 2

      expect(result.totalAmount).toBe(10000); // 5000 × 2
      expect(result.status).toBe(OrderStatus.PENDING);
    });

    it('should call reserveStockUseCase with the correct productId, userId, and quantity', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(makeProduct());
      reserveStockUseCase.execute.mockResolvedValue({
        reservationId: 'res-uuid',
        expiresAt: new Date(),
      });
      orderRepo.save.mockResolvedValue(undefined);

      await useCase.execute(command);

      expect(reserveStockUseCase.execute).toHaveBeenCalledWith({
        productId: command.productId,
        userId: command.userId,
        quantity: command.quantity,
      });
    });

    it('should persist the order and return the reservation id', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(makeProduct());
      reserveStockUseCase.execute.mockResolvedValue({
        reservationId: 'res-uuid',
        expiresAt: new Date(),
      });
      orderRepo.save.mockResolvedValue(undefined);

      const result = await useCase.execute(command);

      expect(orderRepo.save).toHaveBeenCalledTimes(1);
      expect(result.reservationId).toBe('res-uuid');
    });

    it('should propagate ConflictException from ReserveStockUseCase when out of stock', async () => {
      orderRepo.findByIdempotencyKey.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(makeProduct());
      reserveStockUseCase.execute.mockRejectedValue(
        new (require('@nestjs/common').ConflictException)('Insufficient stock'),
      );

      await expect(useCase.execute(command)).rejects.toThrow('Insufficient stock');
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });
});
