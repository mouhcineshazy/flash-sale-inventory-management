import {Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post,} from '@nestjs/common';
import {ApiOperation, ApiParam, ApiResponse, ApiTags} from '@nestjs/swagger';
import {CreateProductDto} from './dtos/create-product.dto';
import {ReserveStockRequestDto} from './dtos/reserve-stock-request.dto';
import {ReserveStockUseCase} from '../application/use-cases/reserve-stock.use-case';
import { CreateProductUseCase } from "@modules/inventory/application/use-cases/create-product.use-case";

/**
 * InventoryController
 *
 * HTTP adapter layer. Its only job:
 *  1. Parse and validate the HTTP request (via ValidationPipe + DTOs)
 *  2. Call the appropriate use case
 *  3. Shape the response
 *
 * No business logic lives here. The controller does not know what
 * "reserving stock" means — it delegates entirely to the use case.
 *
 * Notice: the response is a plain object, not the domain aggregate.
 * We never expose domain internals through the HTTP boundary.
 */
@ApiTags('inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly reserveStockUseCase: ReserveStockUseCase, private readonly createProductUseCase: CreateProductUseCase) {}

  @Post('products')
  @ApiOperation({ summary: 'Create a new product with initial stock' })
  @ApiResponse({ status: 201, description: 'Product created' })
  async createProduct(@Body() dto: CreateProductDto) {
    return this.createProductUseCase.execute({
      name: dto.name,
      description: dto.description,
      priceAmount: dto.priceAmount,
      currency: dto.currency,
      initialStock: dto.initialStock,
    });
  }

  @Post('products/:productId/reserve')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Reserve one unit of stock for a user' })
  @ApiParam({ name: 'productId', type: String, format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Reservation created' })
  @ApiResponse({ status: 404, description: 'Product not found' })
  @ApiResponse({ status: 409, description: 'Out of stock' })
  async reserveStock(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ReserveStockRequestDto,
  ) {
    const result = await this.reserveStockUseCase.execute({
      productId,
      userId: dto.userId,
      quantity: dto.quantity,
    });

    return {
      reservationId: result.reservationId,
      expiresAt: result.expiresAt,
    };
  }
}
