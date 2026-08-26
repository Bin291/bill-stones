import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicAuthService } from './public-auth.service';

class RegisterProfileDto {
  @IsString()
  userId!: string;

  @IsString()
  username!: string;

  @IsEmail()
  email!: string;
}

class UsernameLoginDto {
  @IsString()
  username!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

/** Các endpoint auth công khai (không cần Bearer) cho luồng username + password. */
@Public()
@Controller('auth')
export class PublicAuthController {
  constructor(private readonly auth: PublicAuthService) {}

  @Get('username-available')
  async available(@Query('u') username: string): Promise<{ available: boolean }> {
    return { available: await this.auth.isUsernameAvailable(username ?? '') };
  }

  @Post('register-profile')
  async register(@Body() dto: RegisterProfileDto): Promise<{ ok: true }> {
    await this.auth.registerProfile(dto.userId, dto.username, dto.email);
    return { ok: true };
  }

  @Post('username-login')
  async login(@Body() dto: UsernameLoginDto) {
    return this.auth.loginWithUsername(dto.username, dto.password);
  }
}
