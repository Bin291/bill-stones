import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

const DUPLICATE_POLICIES = ['rename', 'overwrite', 'ask'] as const;
const SHARE_PRIVACIES = ['private', 'email', 'public'] as const;

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  uploadWarnSizeMb?: number;

  @IsOptional()
  @IsIn(DUPLICATE_POLICIES)
  duplicateFilePolicy?: (typeof DUPLICATE_POLICIES)[number];

  @IsOptional()
  @IsString()
  defaultUploadFolderId?: string | null;

  @IsOptional()
  @IsIn(SHARE_PRIVACIES)
  defaultSharePrivacy?: (typeof SHARE_PRIVACIES)[number];
}
