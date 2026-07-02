import { NotFoundException } from '@nestjs/common';
import { CancelOrderUseCase } from './cancel-order.use-case';
import { IOrderRepository } from '@modules/orders/domain/IOrderRepository';
import { ReleaseReservationUseCase } from '@modules/inventory/application/use-cases/release-reservation.use-case';
import { Order, OrderStatus } from '@modules/orders/domain/order.aggregate';

const makePendingOrder = () =>
  Order.place({
    reservationId: 'res-uuid',
    userId: 'user-uuid',
    quantity: 1,
    totalAmount: 5000,
    currency: 'CAD',
    idempotencyKey: 'idem-key',
  });

describe('CancelOrderUseCase', () => {
  let useCase: CancelOrderUseCase;
  let orderRepo: jest.Mocked<IOrderRepository>;
  let releaseReservationUseCase: jest.Mocked<Pick<ReleaseReservationUseCase, 'execute'>>;

  beforeEach(() => {
    orderRepo = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findByUserId: jest.fn(),
    };
    releaseReservationUseCase = { execute: jest.fn() };

    useCase = new CancelOrderUseCase(
      orderRepo,
      releaseReservationUseCase as unknown as ReleaseReservationUseCase,
    );
  });

  const command = { orderId: 'order-uuid' };

  describe('happy path', () => {
    it('should cancel the order, release the reservation, and persist', async () => {
      const order = makePendingOrder();
      orderRepo.findById.mockResolvedValue(order);
      releaseReservationUseCase.execute.mockResolvedValue(undefined);

      await useCase.execute(command);

      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(releaseReservationUseCase.execute).toHaveBeenCalledWith({
        reservationId: order.reservationId,
      });
      expect(orderRepo.save).toHaveBeenCalledWith(order);
    });
  });

  describe('order not found', () => {
    it('should throw NotFoundException without touching the reservation', async () => {
      orderRepo.findById.mockResolvedValue(null);

      await expect(useCase.execute(command)).rejects.toThrow(NotFoundException);

      expect(releaseReservationUseCase.execute).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('domain invariant violation', () => {
    it('should throw and not release the reservation when order is already CONFIRMED', async () => {
      const order = makePendingOrder();
      order.confirm();
      orderRepo.findById.mockResolvedValue(order);

      await expect(useCase.execute(command)).rejects.toThrow(
        'Cannot cancel an order in status: CONFIRMED',
      );

      expect(releaseReservationUseCase.execute).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });
});
