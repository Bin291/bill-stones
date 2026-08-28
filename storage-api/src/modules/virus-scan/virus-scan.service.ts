import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ScanVerdict =
  | 'clean'
  | 'malicious'
  | 'suspicious'
  | 'unknown'
  | 'error';

/** 1 engine antivirus báo tệp có vấn đề + tên mã độc engine đó đặt. */
export interface Detection {
  engine: string;
  result: string;
  category: string; // 'malicious' | 'suspicious'
}

export interface ScanResult {
  /** false = chưa cấu hình VIRUSTOTAL_API_KEY → không quét được thật. */
  configured: boolean;
  verdict: ScanVerdict;
  malicious: number;
  suspicious: number;
  /** Tổng số engine đã chấm (harmless+malicious+suspicious+undetected+timeout). */
  total: number;
  /** Link kết quả trên virustotal.com (nếu có sha256). */
  permalink?: string;
  message?: string;
  /** Danh sách engine báo mã độc + tên mã độc (để hiện chi tiết cho người dùng). */
  detections?: Detection[];
  /** Nhãn mối đe doạ gợi ý của VirusTotal (VD "trojan.eicar/test"). */
  threatLabel?: string;
  /** Các loại mã độc phổ biến trong kết quả (VD ["trojan","virus"]). */
  threatCategories?: string[];
}

interface AnalysisStats {
  harmless?: number;
  malicious?: number;
  suspicious?: number;
  undetected?: number;
  timeout?: number;
}

interface VtEngineResult {
  category?: string;
  engine_name?: string;
  result?: string | null;
}

interface VtThreatBucket {
  count?: number;
  value?: string;
}

/** Thuộc tính tệp/analysis trả về từ VirusTotal (phần dùng tới). */
interface VtAttributes {
  last_analysis_stats?: AnalysisStats;
  stats?: AnalysisStats;
  last_analysis_results?: Record<string, VtEngineResult>;
  results?: Record<string, VtEngineResult>;
  popular_threat_classification?: {
    suggested_threat_label?: string;
    popular_threat_category?: VtThreatBucket[];
    popular_threat_name?: VtThreatBucket[];
  };
}

/**
 * Quét virus tệp thực thi bằng VirusTotal API v3 (tương đương virustotal.com).
 * Hai chế độ:
 *  - scanByHash(sha256): tra tệp ĐÃ có trong CSDL VT theo hash — kết quả tức thì,
 *    không cần tải bytes. Đa số phần mềm/mã độc phổ biến đã có sẵn.
 *  - scanBytes(buffer, name): tệp LẠ (hash 404) → tải bytes lên VT phân tích rồi
 *    chờ (poll) tới khi xong. Trần 32MB (free tier).
 */
@Injectable()
export class VirusScanService {
  private readonly logger = new Logger(VirusScanService.name);
  private readonly apiKey?: string;
  private readonly maxUploadBytes: number;
  private readonly analysisTimeoutMs: number;
  private static readonly API = 'https://www.virustotal.com/api/v3';

  /** Phần mở rộng bị coi là tệp thực thi → cảnh báo + quét. */
  private static readonly EXECUTABLE_EXTENSIONS = new Set([
    'exe', 'msi', 'dll', 'scr', 'com', 'bat', 'cmd', 'pif', 'cpl', 'sys',
    'jar', 'apk', 'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bin', 'run',
    'msc', 'gadget', 'vb', 'vbs', 'vbe', 'js', 'jse', 'ws', 'wsf', 'wsc',
    'wsh', 'ps1', 'ps1xml', 'ps2', 'psc1', 'psc2', 'msh', 'msh1', 'msh2',
    'reg', 'hta', 'lnk',
  ]);

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('virusScan.apiKey');
    this.maxUploadBytes =
      config.get<number>('virusScan.maxUploadBytes') ?? 32 * 1024 * 1024;
    this.analysisTimeoutMs =
      config.get<number>('virusScan.analysisTimeoutMs') ?? 90_000;
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  static isExecutable(name: string): boolean {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    return VirusScanService.EXECUTABLE_EXTENSIONS.has(ext);
  }

  /** Tra kết quả theo sha256 (tệp đã có trong CSDL VirusTotal). */
  async scanByHash(sha256: string): Promise<ScanResult> {
    if (!this.apiKey) return this.unconfigured();
    try {
      const res = await fetch(`${VirusScanService.API}/files/${sha256}`, {
        headers: { 'x-apikey': this.apiKey },
      });
      if (res.status === 404) {
        return {
          configured: true,
          verdict: 'unknown',
          malicious: 0,
          suspicious: 0,
          total: 0,
          message: 'not_in_database',
        };
      }
      if (!res.ok) {
        this.logger.warn(`VT hash lookup lỗi ${res.status}`);
        return this.errored(`vt_http_${res.status}`);
      }
      const json = (await res.json()) as { data?: { attributes?: VtAttributes } };
      return this.fromAttributes(json.data?.attributes ?? {}, sha256);
    } catch (err) {
      this.logger.warn(`VT hash lookup exception: ${(err as Error).message}`);
      return this.errored('vt_exception');
    }
  }

  /** Tải bytes lên VT để phân tích tệp lạ, rồi chờ kết quả. */
  async scanBytes(buffer: Buffer, fileName: string): Promise<ScanResult> {
    if (!this.apiKey) return this.unconfigured();
    if (buffer.length > this.maxUploadBytes) {
      return {
        configured: true,
        verdict: 'unknown',
        malicious: 0,
        suspicious: 0,
        total: 0,
        message: 'too_large_to_scan',
      };
    }
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(buffer)]),
        fileName || 'upload.bin',
      );
      const res = await fetch(`${VirusScanService.API}/files`, {
        method: 'POST',
        headers: { 'x-apikey': this.apiKey },
        body: form,
      });
      if (!res.ok) {
        this.logger.warn(`VT upload lỗi ${res.status}`);
        return this.errored(`vt_http_${res.status}`);
      }
      const json = (await res.json()) as { data?: { id?: string } };
      const analysisId = json.data?.id;
      if (!analysisId) return this.errored('vt_no_analysis_id');
      return await this.pollAnalysis(analysisId);
    } catch (err) {
      this.logger.warn(`VT upload exception: ${(err as Error).message}`);
      return this.errored('vt_exception');
    }
  }

  /** Chờ 1 analysis hoàn tất (poll mỗi 4s tới timeout). */
  private async pollAnalysis(analysisId: string): Promise<ScanResult> {
    const deadline = Date.now() + this.analysisTimeoutMs;
    while (Date.now() < deadline) {
      await this.sleep(4000);
      try {
        const res = await fetch(
          `${VirusScanService.API}/analyses/${analysisId}`,
          { headers: { 'x-apikey': this.apiKey! } },
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          data?: {
            attributes?: VtAttributes & { status?: string };
            meta?: { file_info?: { sha256?: string } };
          };
          meta?: { file_info?: { sha256?: string } };
        };
        const attrs = json.data?.attributes;
        if (attrs?.status === 'completed') {
          const sha256 =
            json.meta?.file_info?.sha256 ??
            json.data?.meta?.file_info?.sha256;
          // Với tệp lạ: analysis chỉ có kết quả từng engine, chưa có nhãn phân
          // loại tổng hợp → tra thêm theo sha256 để lấy popular_threat_classification.
          if (sha256) {
            const detailed = await this.scanByHash(sha256).catch(() => null);
            if (detailed && detailed.verdict !== 'unknown' && detailed.verdict !== 'error') {
              return detailed;
            }
          }
          return this.fromAttributes(attrs, sha256);
        }
      } catch {
        /* mạng chập chờn — thử lại vòng sau */
      }
    }
    return {
      configured: true,
      verdict: 'unknown',
      malicious: 0,
      suspicious: 0,
      total: 0,
      message: 'analysis_timeout',
    };
  }

  private fromAttributes(attributes: VtAttributes, sha256?: string): ScanResult {
    const stats = attributes.last_analysis_stats ?? attributes.stats ?? {};
    const malicious = stats.malicious ?? 0;
    const suspicious = stats.suspicious ?? 0;
    const total =
      (stats.harmless ?? 0) +
      malicious +
      suspicious +
      (stats.undetected ?? 0) +
      (stats.timeout ?? 0);
    let verdict: ScanVerdict = 'clean';
    if (malicious > 0) verdict = 'malicious';
    else if (suspicious > 0) verdict = 'suspicious';

    const detections = this.buildDetections(
      attributes.last_analysis_results ?? attributes.results,
    );
    const cls = attributes.popular_threat_classification;
    const threatCategories = (cls?.popular_threat_category ?? [])
      .map((c) => c.value)
      .filter((v): v is string => !!v);
    let threatLabel = cls?.suggested_threat_label;
    if (!threatLabel && detections.length) {
      threatLabel = this.mostCommon(detections.map((d) => d.result));
    }

    return {
      configured: true,
      verdict,
      malicious,
      suspicious,
      total,
      permalink: sha256
        ? `https://www.virustotal.com/gui/file/${sha256}`
        : undefined,
      detections: detections.slice(0, 20),
      threatLabel,
      threatCategories: threatCategories.length ? threatCategories : undefined,
    };
  }

  /** Lọc các engine báo malicious/suspicious kèm tên mã độc. */
  private buildDetections(
    results?: Record<string, VtEngineResult>,
  ): Detection[] {
    if (!results) return [];
    const out: Detection[] = [];
    for (const [engine, r] of Object.entries(results)) {
      if (
        (r.category === 'malicious' || r.category === 'suspicious') &&
        r.result
      ) {
        out.push({
          engine: r.engine_name || engine,
          result: r.result,
          category: r.category,
        });
      }
    }
    // Ưu tiên hiển thị các báo cáo có tên rõ ràng, sắp theo tên engine.
    return out.sort((a, b) => a.engine.localeCompare(b.engine));
  }

  /** Chuỗi xuất hiện nhiều nhất (dùng suy ra tên mã độc chung khi VT chưa gắn nhãn). */
  private mostCommon(values: string[]): string | undefined {
    const count = new Map<string, number>();
    for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
    let best: string | undefined;
    let bestN = 0;
    for (const [v, n] of count) {
      if (n > bestN) {
        best = v;
        bestN = n;
      }
    }
    return best;
  }

  private unconfigured(): ScanResult {
    return {
      configured: false,
      verdict: 'unknown',
      malicious: 0,
      suspicious: 0,
      total: 0,
      message: 'not_configured',
    };
  }

  private errored(message: string): ScanResult {
    return {
      configured: true,
      verdict: 'error',
      malicious: 0,
      suspicious: 0,
      total: 0,
      message,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
