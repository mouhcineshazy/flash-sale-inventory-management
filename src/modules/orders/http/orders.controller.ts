import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlaceOrderUseCase } from '../application/use-cases/place-order.use-case';
import { PlaceOrderDto } from './dtos/place-order.dto';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly placeOrderUseCase: PlaceOrderUseCase) {}

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
}
