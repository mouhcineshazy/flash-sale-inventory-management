import {ConflictException, Inject, Injectable, NotFoundException} from "@nestjs/common";
import {IOrderRepository, ORDER_REPOSITORY} from "@modules/orders/domain/IOrderRepository";
import {ConfirmReservationUseCase} from "@modules/inventory/application/use-cases/confirm-reservation.use-case";

export interface ConfirmOrderCommand { orderId: string; }

@Injectable()
export class ConfirmOrderUseCase {
    constructor(
        @Inject(ORDER_REPOSITORY) private readonly orderRepository: IOrderRepository,
        private readonly confirmReservationUseCase: ConfirmReservationUseCase,
    ) {}

    async execute(command: ConfirmOrderCommand): Promise<void> {
        const order = await this.orderRepository.findById(command.orderId);
        if (!order) {
            throw new NotFoundException(`Order ${command.orderId} not found`);
        }

        try {
            await this.confirmReservationUseCase.execute({ reservationId: order.reservationId });
        } catch (error) {
            if (error instanceof NotFoundException || error instanceof ConflictException) {
                order.cancel();
                await this.orderRepository.save(order);
            }
            throw error;
        }

        order.confirm();
        await this.orderRepository.save(order);
    }
}