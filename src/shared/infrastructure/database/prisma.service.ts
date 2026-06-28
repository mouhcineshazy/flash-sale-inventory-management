import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '../../../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * PrismaService wraps PrismaClient and plugs into the NestJS lifecycle.
 *
 * Prisma 7.x uses "driver adapters" — the PrismaClient no longer ships
 * its own binary engine. Instead, it delegates to a native driver (here: pg).
 * This means:
 *  - Faster cold starts (no engine binary to load)
 *  - Works in edge runtimes
 *  - You pass the adapter in the constructor
 *
 * The adapter reads DATABASE_URL from the environment, which is loaded
 * by @nestjs/config (ConfigModule.forRoot) before this service initializes.
 *
 * NestJS lifecycle hooks:
 *  - onModuleInit:    module is ready → open DB connection
 *  - onModuleDestroy: app is shutting down → drain and close connection
 *
 * Pairs with app.enableShutdownHooks() in main.ts to handle SIGTERM.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
    });
    super({ adapter });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
