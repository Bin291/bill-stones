import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { DocPreviewService } from './doc-preview.service';

@Module({
  imports: [FoldersModule],
  controllers: [FilesController],
  providers: [FilesService, DocPreviewService],
  exports: [FilesService],
})
export class FilesModule {}
