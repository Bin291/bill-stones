import { Global, Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { HlsController } from './hls.controller';
import { HlsTranscodeService } from './hls-transcode.service';

@Global()
@Module({
  imports: [FilesModule],
  controllers: [HlsController],
  providers: [HlsTranscodeService],
  exports: [HlsTranscodeService],
})
export class HlsModule {}
