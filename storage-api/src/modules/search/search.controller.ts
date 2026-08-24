import { Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SearchService } from './search.service';
import { IndexingService } from './indexing.service';

@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly indexing: IndexingService,
  ) {}

  /** GET /search?q= — tìm kiếm (FTS accent-insensitive). */
  @Get()
  async query(@CurrentUser('id') userId: string, @Query('q') q?: string) {
    const results = await this.search.search(userId, q ?? '');
    return { results };
  }

  /** POST /search/reindex — lập chỉ mục lại các file text chưa index (backfill). */
  @Post('reindex')
  async reindex(@CurrentUser('id') userId: string) {
    const queued = await this.indexing.reindexUser(userId);
    return { queued };
  }
}
