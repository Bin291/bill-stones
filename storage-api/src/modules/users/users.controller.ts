import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('settings')
  getSettings(@CurrentUser('id') userId: string, @CurrentUser('email') email: string) {
    return this.users.getSettings(userId, email ?? '');
  }

  @Patch('settings')
  updateSettings(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.users.updateSettings(userId, email ?? '', dto);
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  setAvatar(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Thiếu file ảnh');
    return this.users.setAvatar(userId, email ?? '', file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser('id') userId: string, @CurrentUser('email') email: string) {
    return this.users.removeAvatar(userId, email ?? '');
  }
}
