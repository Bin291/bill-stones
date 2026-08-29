import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { UsersModule } from '../users/users.module';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { VirusScanService } from '../virus-scan/virus-scan.service';

@Module({
  imports: [FoldersModule, UsersModule],
  controllers: [UploadsController],
  providers: [UploadsService, VirusScanService],
  exports: [UploadsService],
})
export class UploadsModule {}
