import { Global, Module } from '@nestjs/common';
import { SupabaseJwtService } from './supabase-jwt.service';
import { PublicAuthController } from './public-auth.controller';
import { PublicAuthService } from './public-auth.service';

/**
 * Cung cấp SupabaseJwtService cho guard toàn cục (verify JWKS) và các endpoint
 * auth công khai (username + password).
 */
@Global()
@Module({
  controllers: [PublicAuthController],
  providers: [SupabaseJwtService, PublicAuthService],
  exports: [SupabaseJwtService, PublicAuthService],
})
export class AuthModule {}
