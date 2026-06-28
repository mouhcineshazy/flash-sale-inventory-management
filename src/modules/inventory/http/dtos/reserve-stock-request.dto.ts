import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID, IsInt, Min, Max } from 'class-validator';

export class ReserveStockRequestDto {
  @ApiProperty({ example: 'user-uuid-here', description: 'ID of the user making the reservation' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 1, description: 'Number of units to reserve', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  quantity!: number;
}
