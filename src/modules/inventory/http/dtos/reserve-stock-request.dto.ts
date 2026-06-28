import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class ReserveStockRequestDto {
  @ApiProperty({ example: 'user-uuid-here', description: 'ID of the user making the reservation' })
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  userId!: string;
}
