import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');

  console.log(`[mediasoup-sfu-system] NestJS Backend running on port ${port}`);
  console.log(`[mediasoup-sfu-system] SFU RTC Port Range: 40000 - 40100`);
}

bootstrap();
