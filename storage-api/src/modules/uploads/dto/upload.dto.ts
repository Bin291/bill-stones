import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class InitUploadDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  // size dạng chuỗi để nhận số lớn > 2^53 an toàn (BigInt phía server).
  @IsString()
  size!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  folderId?: string | null;

  // Client chỉ định cách xử lý trùng tên CHO LẦN NÀY (ghi đè lựa chọn mặc định
  // trong Cài đặt) — dùng khi frontend đã hỏi lại user sau khi backend báo trùng.
  @IsOptional()
  @IsIn(['rename', 'overwrite'])
  duplicateAction?: 'rename' | 'overwrite';
}

export class CompletedPartDto {
  @IsInt()
  @Min(1)
  PartNumber!: number;

  @IsString()
  ETag!: string;
}

export class CompleteUploadDto {
  @IsString()
  fileId!: string;

  @IsString()
  uploadId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CompletedPartDto)
  parts!: CompletedPartDto[];
}

export class AbortUploadDto {
  @IsString()
  fileId!: string;

  @IsString()
  uploadId!: string;
}
