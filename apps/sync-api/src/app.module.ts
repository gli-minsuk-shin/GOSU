import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AuthGuard } from './auth.js';
import { RelayGateway } from './relay.gateway.js';
import { SyncStore } from './store.js';

@Module({
  controllers: [AppController],
  providers: [SyncStore, RelayGateway, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
