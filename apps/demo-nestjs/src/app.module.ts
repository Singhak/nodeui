import { Module } from '@nestjs/common';
import { NodeUIModule } from '@singhak/nodeui-nestjs';
import { AppController } from './app.controller';

@Module({
  imports: [
    NodeUIModule.register({
      config: { appName: 'demo-nestjs', version: '0.1.0', port: Number(process.env.PORT ?? 3001) },
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
