import { Global, Module } from '@nestjs/common';
import { DocumentParserService } from './document-parser.service';
import { IndexingService } from './indexing.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { AiEmbeddingService } from './ai-embedding.service';
import { HfInferenceService } from './hf-inference.service';

@Global()
@Module({
  controllers: [SearchController],
  providers: [
    DocumentParserService,
    AiEmbeddingService,
    HfInferenceService,
    IndexingService,
    SearchService,
  ],
  exports: [IndexingService],
})
export class SearchModule {}
