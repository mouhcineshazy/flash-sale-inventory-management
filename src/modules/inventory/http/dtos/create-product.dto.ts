import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsInt, IsPositive, IsOptional, IsIn } from 'class-validator';
import {SupportedCurrency} from "@modules/inventory/domain/value-objects/money.vo";

export class CreateProductDto {
  @ApiProperty({ example: 'Limited Edition Sneaker', description: 'Product name' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Only 100 pairs available.' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ example: 19999, description: 'Price in cents (e.g. 19999 = $199.99)' })
  @IsInt()
  @IsPositive()
  priceAmount!: number;

  @ApiProperty({ example: 'CAD', enum: ['CAD', 'USD'] })
  @IsIn(['CAD', 'USD'])
  currency!: SupportedCurrency;

  @ApiProperty({ example: 100, description: 'Initial stock quantity' })
  @IsInt()
  @IsPositive()
  initialStock!: number;
}
