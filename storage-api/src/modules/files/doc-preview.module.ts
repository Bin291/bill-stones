import { Global, Module } from '@nestjs/common';
import { DocPreviewService } from './doc-preview.service';

/** Global (giống ThumbnailModule) — UploadsService cần gọi pregenerateInBackground(). */
@Global()
@Module({
  providers: [DocPreviewService],
  exports: [DocPreviewService],
})
export class DocPreviewModule {}
