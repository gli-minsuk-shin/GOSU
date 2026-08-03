import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import type { SyncApiConfig } from './config.js';

export async function createSyncApiApplication(
  config: SyncApiConfig,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: config.environment === 'test' ? false : ['log', 'warn', 'error'] },
  );
  app.enableCors({ origin: [...config.allowedOrigins], credentials: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  return app;
}
