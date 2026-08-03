import 'dotenv/config';
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );
  app.enableCors({
    origin: process.env.GOSU_ALLOWED_ORIGINS?.split(',') ?? ['http://127.0.0.1:3000'],
    credentials: true,
  });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  const port = Number(process.env.GOSU_SYNC_API_PORT ?? 4000);
  await app.listen({ port, host: process.env.GOSU_SYNC_API_HOST ?? '127.0.0.1' });
  Logger.log(`GOSU Sync API listening on ${await app.getUrl()}`);
}

void bootstrap();
