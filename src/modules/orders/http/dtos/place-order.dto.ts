import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, Max, IsNotEmpty } from 'class-validator';

export class PlaceOrderDto {
  @ApiProperty({ example: 'product-uuid', description: 'Product to purchase' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 'user-uuid', description: 'User placing the order' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 2, description: 'Number of units', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;

  @ApiProperty({ example: 'unique-client-uuid', description: 'Client-generated UUID for idempotency — reuse on retry' })
  @IsUUID()
  @IsNotEmpty()
  idempotencyKey!: string;
}
