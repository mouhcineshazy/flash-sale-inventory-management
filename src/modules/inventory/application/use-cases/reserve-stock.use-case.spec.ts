import { ConflictException, NotFoundException } from '@nestjs/common';
import { ReserveStockUseCase } from '@modules/inventory/application/use-cases/reserve-stock.use-case';
import { Product } from '@modules/inventory/domain/product.aggregate';
import { IProductRepository } from '@modules/inventory/domain/product.repository';
import { IReservationRepository } from '@modules/inventory/domain/reservation.repository';


const makeProduct = () =>
  Product.create({ name: 'Flash Hoodie', priceAmount: 5000, currency: 'USD', initialStock: 10 });

describe('ReserveStockUseCase', () => {
  let useCase: ReserveStockUseCase;
  let productRepo: jest.Mocked<IProductRepository>;
  let reservationRepo: jest.Mocked<IReservationRepository>;
  beforeEach(() => {
    productRepo = {
      findById: jest.fn(),
      decrementStockAtomic: jest.fn(),
      save: jest.fn(),
    };

    reservationRepo = {
      findById: jest.fn(),
      findPendingByUserAndProduct: jest.fn(),
      save: jest.fn(),
      updateStatus: jest.fn(),
    };

    useCase = new ReserveStockUseCase(
      productRepo,
      reservationRepo,
    );
  });

  describe('execute()', () => {
    it('should return a reservationId and expiresAt when stock is available', async () => {
      // Arrange
      productRepo.decrementStockAtomic.mockResolvedValue(makeProduct());
      reservationRepo.save.mockResolvedValue(undefined);

      // Act
      const result = await useCase.execute({ productId: 'some-uuid', userId: 'user-1', quantity: 1 });

      // Assert
      expect(reservationRepo.save).toHaveBeenCalledTimes(1);
      expect(result.reservationId).toBeDefined();
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException when the product does not exist', async () => {
      // Arrange
      productRepo.decrementStockAtomic.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(null);

      // Act + Assert
      await expect(
        useCase.execute({ productId: 'nonexistent-uuid', userId: 'user-1', quantity: 1 }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when the product exists but stock is zero', async () => {
      // Arrange
      productRepo.decrementStockAtomic.mockResolvedValue(null);
      productRepo.findById.mockResolvedValue(makeProduct());

      // Act + Assert
      await expect(
        useCase.execute({ productId: 'some-uuid', userId: 'user-1', quantity: 1 }),
      ).rejects.toThrow(ConflictException);
    });
  });
});
