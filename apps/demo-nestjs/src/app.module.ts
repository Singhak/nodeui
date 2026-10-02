import { Module } from '@nestjs/common';
import { NodeUIModule } from '@singhak/nodeui-nestjs';
import { AppController } from './app.controller';

@Module({
  imports: [
    NodeUIModule.register({
      config: { appName: 'demo-nestjs', version: '0.4.0', port: Number(process.env.PORT ?? 3001) },
      // Response bodies are captured. Nest parses request bodies before module middleware
      // runs, so request bodies are not visible here (headers and query are).
      captureRequestDetail: { bodies: true },
      slowQueryMs: 50,
    }),
  ],
  controllers: [AppController],
})
export class AppModule {}
