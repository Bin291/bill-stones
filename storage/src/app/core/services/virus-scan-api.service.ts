import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type ScanVerdict =
  | 'clean'
  | 'malicious'
  | 'suspicious'
  | 'unknown'
  | 'error';

export interface Detection {
  engine: string;
  result: string;
  category: string;
}

export interface ScanResult {
  configured: boolean;
  verdict: ScanVerdict;
  malicious: number;
  suspicious: number;
  total: number;
  permalink?: string;
  message?: string;
  /** Danh sách engine báo mã độc + tên mã độc. */
  detections?: Detection[];
  /** Nhãn mối đe doạ gợi ý (VD "trojan.eicar/test"). */
  threatLabel?: string;
  /** Loại mã độc phổ biến trong kết quả (VD ["trojan","virus"]). */
  threatCategories?: string[];
}

/**
 * Quét virus tệp thực thi (.exe…) bằng VirusTotal (qua backend). Trình tự:
 *  1) Tính sha256 phía client → tra theo hash (tệp phổ biến có kết quả tức thì).
 *  2) Nếu hash chưa có trong CSDL VT (và tệp ≤ 32MB) → gửi bytes cho backend tải
 *     lên VT phân tích rồi chờ kết quả.
 */
@Injectable({ providedIn: 'root' })
export class VirusScanApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/uploads`;

  /** Trần dung lượng gửi bytes lên VT phân tích (free tier 32MB). */
  private static readonly MAX_SCAN_BYTES = 32 * 1024 * 1024;

  private static readonly EXECUTABLE_EXTENSIONS = new Set([
    'exe', 'msi', 'dll', 'scr', 'com', 'bat', 'cmd', 'pif', 'cpl', 'sys',
    'jar', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bin', 'run',
    'msc', 'gadget', 'vb', 'vbs', 'vbe', 'js', 'jse', 'ws', 'wsf', 'wsc',
    'wsh', 'ps1', 'ps1xml', 'ps2', 'psc1', 'psc2', 'msh', 'msh1', 'msh2',
    'reg', 'hta', 'lnk',
  ]);

  static isExecutable(name: string): boolean {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    return VirusScanApiService.EXECUTABLE_EXTENSIONS.has(ext);
  }

  isExecutable(name: string): boolean {
    return VirusScanApiService.isExecutable(name);
  }

  /** Quét 1 tệp; trả kết quả cuối cùng (đã gộp 2 bước hash + bytes). */
  async scan(file: File): Promise<ScanResult> {
    const sha256 = await this.sha256(file);
    const byHash = await this.scanHash(sha256);
    // Chưa cấu hình / đã có kết quả rõ ràng → trả luôn.
    if (!byHash.configured) return byHash;
    if (byHash.verdict !== 'unknown') return byHash;
    // Tệp lạ (hash 404) và đủ nhỏ → tải bytes lên VT phân tích.
    if (
      byHash.message === 'not_in_database' &&
      file.size <= VirusScanApiService.MAX_SCAN_BYTES
    ) {
      return this.scanBytes(file);
    }
    return byHash;
  }

  private scanHash(sha256: string): Promise<ScanResult> {
    return firstValueFrom(
      this.http.post<ScanResult>(`${this.base}/scan-hash`, { sha256 }),
    );
  }

  private async scanBytes(file: File): Promise<ScanResult> {
    const buffer = await file.arrayBuffer();
    return firstValueFrom(
      this.http.post<ScanResult>(`${this.base}/scan-file`, buffer, {
        headers: new HttpHeaders({
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(file.name),
        }),
      }),
    );
  }

  /** SHA-256 hex của tệp qua Web Crypto. */
  private async sha256(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
