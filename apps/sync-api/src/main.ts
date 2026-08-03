import 'dotenv/config';
import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createSyncApiApplication } from './application.js';
import { loadSyncApiConfig, SyncApiConfigurationError } from './config.js';

async function bootstrap() {
  let app: NestFastifyApplication | undefined;
  try {
    const config = loadSyncApiConfig();
    app = await createSyncApiApplication(config);
    app.enableShutdownHooks();
    await app.listen({ port: config.port, host: config.host });
    Logger.log(`GOSU Sync API listening on ${await app.getUrl()}`);
  } catch (error) {
    await app?.close().catch(() => undefined);
    const code =
      error instanceof SyncApiConfigurationError ? error.code : 'sync_api_startup_failed';
    Logger.error(`GOSU Sync API startup rejected: ${code}`);
    process.exitCode = 1;
  }
}

void bootstrap();
