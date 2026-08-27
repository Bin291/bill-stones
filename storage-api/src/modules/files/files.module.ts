import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';

@Module({
  imports: [FoldersModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
