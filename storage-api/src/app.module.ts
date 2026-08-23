import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { validationSchema } from './config/validation.schema';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TransformBigIntInterceptor } from './common/interceptors/transform-bigint.interceptor';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { FoldersModule } from './modules/folders/folders.module';
import { FilesModule } from './modules/files/files.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { ThumbnailModule } from './modules/thumbnail/thumbnail.module';
import { HlsModule } from './modules/hls/hls.module';
import { SearchModule } from './modules/search/search.module';
import { TrashModule } from './modules/trash/trash.module';
import { ShareModule } from './modules/share/share.module';
import { NotificationModule } from './modules/notification/notification.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: { allowUnknown: true, abortEarly: false },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StorageModule,
    ThumbnailModule,
    HlsModule,
    SearchModule,
    AuthModule,
    FoldersModule,
    FilesModule,
    UploadsModule,
    TrashModule,
    NotificationModule,
    ShareModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // JWT bảo vệ toàn app; route @Public() được bỏ qua (mục 3, 12).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Chuyển BigInt -> string trong mọi response (mục 7.B).
    { provide: APP_INTERCEPTOR, useClass: TransformBigIntInterceptor },
  ],
})
export class AppModule {}
