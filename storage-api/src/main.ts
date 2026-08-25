import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // bodyParser: false để tự đăng ký — route /uploads/part cần raw octet-stream (mục 5.A).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);

  const chunkSizeMb = config.get<number>('limits.chunkSizeMb') ?? 8;
  // Cho phép chunk + overhead; gấp đôi chunk size để dư.
  app.use(
    '/uploads/part',
    raw({ type: () => true, limit: `${chunkSizeMb * 2}mb` }),
  );
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ extended: true, limit: '5mb' }));

  // CORS: allowlist từ WEB_ORIGIN. Ở dev, chấp nhận mọi cổng localhost/127.0.0.1
  // (preview/dev server dùng cổng động nên không thể liệt kê cứng).
  const allowlist = config.get<string[]>('webOrigin') ?? ['http://localhost:4200'];
  const isDev = config.get<string>('nodeEnv') !== 'production';
  const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
  app.enableCors({
    origin: (origin, cb) => {
      // Không có origin (curl, server-to-server) hoặc nằm trong allowlist → cho phép.
      if (!origin || allowlist.includes(origin)) return cb(null, true);
      if (isDev && localhostRe.test(origin)) return cb(null, true);
      return cb(new Error(`Origin không được phép bởi CORS: ${origin}`), false);
    },
    credentials: true,
    exposedHeaders: ['ETag'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const port = config.get<number>('port') ?? 3000;
  await app.listen(port);

  console.log(`storage-api đang chạy ở http://localhost:${port}`);
}
void bootstrap();
