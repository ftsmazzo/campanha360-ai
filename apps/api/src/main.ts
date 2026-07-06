import { NestFactory } from '@nestjs/core';
import { AppModule } from './modules/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: process.env.WEB_PUBLIC_URL || true,
    credentials: true,
  });
  const port = Number(process.env.PORT || 3001);
  await app.listen(port);
}

bootstrap();
