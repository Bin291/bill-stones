import { Module } from '@nestjs/common';
import { FoldersModule } from '../folders/folders.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [FoldersModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
