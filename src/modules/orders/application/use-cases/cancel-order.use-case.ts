import {Inject, Injectable, NotFoundException} from "@nestjs/common";
import {IOrderRepository, ORDER_REPOSITORY} from "@modules/orders/domain/IOrderRepository";
import {ReleaseReservationUseCase} from "@modules/inventory/application/use-cases/release-reservation.use-case";

export interface CancelOrderCommand { orderId: string; }

@Injectable()
export class CancelOrderUseCase {
    constructor(
        @Inject(ORDER_REPOSITORY) private readonly orderRepository: IOrderRepository,
        private readonly releaseReservationUseCase: ReleaseReservationUseCase,
    ) {}

    async execute(command: CancelOrderCommand): Promise<void> {
        const order = await this.orderRepository.findById(command.orderId);
        if (!order) {
            throw new NotFoundException(`Order ${command.orderId} not found`);
        }

        order.cancel();
        await this.releaseReservationUseCase.execute({ reservationId: order.reservationId });
        await this.orderRepository.save(order);
    }
}