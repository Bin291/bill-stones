import { Global, Module } from '@nestjs/common';
import { DocumentParserService } from './document-parser.service';
import { IndexingService } from './indexing.service';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { AiService } from './ai.service';

@Global()
@Module({
  controllers: [SearchController],
  providers: [DocumentParserService, IndexingService, SearchService, AiService],
  exports: [IndexingService],
})
export class SearchModule {}
