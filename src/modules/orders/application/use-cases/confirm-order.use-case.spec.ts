import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfirmOrderUseCase } from './confirm-order.use-case';
import { IOrderRepository } from '@modules/orders/domain/IOrderRepository';
import { ConfirmReservationUseCase } from '@modules/inventory/application/use-cases/confirm-reservation.use-case';
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

describe('ConfirmOrderUseCase', () => {
  let useCase: ConfirmOrderUseCase;
  let orderRepo: jest.Mocked<IOrderRepository>;
  let confirmReservationUseCase: jest.Mocked<Pick<ConfirmReservationUseCase, 'execute'>>;

  beforeEach(() => {
    orderRepo = {
      save: jest.fn(),
      findById: jest.fn(),
      findByIdempotencyKey: jest.fn(),
      findByUserId: jest.fn(),
    };
    confirmReservationUseCase = { execute: jest.fn() };

    useCase = new ConfirmOrderUseCase(
      orderRepo,
      confirmReservationUseCase as unknown as ConfirmReservationUseCase,
    );
  });

  const command = { orderId: 'order-uuid' };

  describe('happy path', () => {
    it('should confirm the reservation then transition the order to CONFIRMED', async () => {
      const order = makePendingOrder();
      orderRepo.findById.mockResolvedValue(order);
      confirmReservationUseCase.execute.mockResolvedValue(undefined);

      await useCase.execute(command);

      expect(confirmReservationUseCase.execute).toHaveBeenCalledWith({
        reservationId: order.reservationId,
      });
      expect(order.status).toBe(OrderStatus.CONFIRMED);
      expect(orderRepo.save).toHaveBeenCalledWith(order);
    });
  });

  describe('order not found', () => {
    it('should throw NotFoundException without touching the reservation', async () => {
      orderRepo.findById.mockResolvedValue(null);

      await expect(useCase.execute(command)).rejects.toThrow(NotFoundException);

      expect(confirmReservationUseCase.execute).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('reservation confirmation fails with a domain error', () => {
    it('should cancel the order and re-throw when reservation throws ConflictException', async () => {
      const order = makePendingOrder();
      orderRepo.findById.mockResolvedValue(order);
      confirmReservationUseCase.execute.mockRejectedValue(
        new ConflictException('Reservation expired'),
      );

      await expect(useCase.execute(command)).rejects.toThrow(ConflictException);

      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(orderRepo.save).toHaveBeenCalledWith(order);
    });

    it('should cancel the order and re-throw when reservation throws NotFoundException', async () => {
      const order = makePendingOrder();
      orderRepo.findById.mockResolvedValue(order);
      confirmReservationUseCase.execute.mockRejectedValue(
        new NotFoundException('Reservation not found'),
      );

      await expect(useCase.execute(command)).rejects.toThrow(NotFoundException);

      expect(order.status).toBe(OrderStatus.CANCELLED);
      expect(orderRepo.save).toHaveBeenCalledWith(order);
    });
  });

  describe('infrastructure failure', () => {
    it('should re-throw without cancelling the order on unexpected errors', async () => {
      const order = makePendingOrder();
      orderRepo.findById.mockResolvedValue(order);
      confirmReservationUseCase.execute.mockRejectedValue(new Error('DB timeout'));

      await expect(useCase.execute(command)).rejects.toThrow('DB timeout');

      // Order must stay PENDING — we don't know reservation state on infra errors
      expect(order.status).toBe(OrderStatus.PENDING);
      expect(orderRepo.save).not.toHaveBeenCalled();
    });
  });
});
