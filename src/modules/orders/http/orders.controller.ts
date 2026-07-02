import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlaceOrderUseCase } from '../application/use-cases/place-order.use-case';
import { ConfirmOrderUseCase } from '../application/use-cases/confirm-order.use-case';
import { CancelOrderUseCase } from '../application/use-cases/cancel-order.use-case';
import { PlaceOrderDto } from './dtos/place-order.dto';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly placeOrderUseCase: PlaceOrderUseCase,
    private readonly confirmOrderUseCase: ConfirmOrderUseCase,
    private readonly cancelOrderUseCase: CancelOrderUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Place an order for a product' })
  @ApiResponse({ status: 201, description: 'Order created in PENDING state' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Insufficient stock' })
  async placeOrder(@Body() dto: PlaceOrderDto) {
    return this.placeOrderUseCase.execute({
      productId: dto.productId,
      userId: dto.userId,
      quantity: dto.quantity,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm an order after payment succeeds' })
  @ApiResponse({ status: 204, description: 'Order confirmed' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: 'Reservation expired or already confirmed' })
  async confirmOrder(@Param('id') id: string) {
    return this.confirmOrderUseCase.execute({ orderId: id });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel an order and release reserved stock' })
  @ApiResponse({ status: 204, description: 'Order cancelled and stock released' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: 'Order already confirmed, cannot cancel' })
  async cancelOrder(@Param('id') id: string) {
    return this.cancelOrderUseCase.execute({ orderId: id });
  }
}
