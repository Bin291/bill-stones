import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml, SafeResourceUrl } from '@angular/platform-browser';
import { firstValueFrom } from 'rxjs';
import { FilesApiService } from '../../core/services/files-api.service';
import { SharedApiService } from '../../core/services/shared-api.service';
import { Loader } from '../ui/loader';
import { StoredFile } from '../../core/models/file.model';
import { categoryOf, formatBytes, iconOf } from '../../core/util/file-types';

type Kind = 'image' | 'audio' | 'pdf' | 'doc' | 'other';

const DOC_EXT = new Set([
  'docx', 'xlsx', 'xls', 'csv',
  'txt', 'md', 'markdown', 'json', 'log', 'xml', 'yml', 'yaml',
  'js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp',
  'cs', 'go', 'rs', 'rb', 'php', 'sh', 'sql',
]);

/** Xem trước mọi loại file: ảnh, PDF, docx/excel/text (render HTML), khác → tải. */
@Component({
  selector: 'app-file-preview',
  imports: [Loader],
  templateUrl: './file-preview.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilePreview implements OnInit {
  private readonly filesApi = inject(FilesApiService);
  private readonly sharedApi = inject(SharedApiService);
  private readonly sanitizer = inject(DomSanitizer);

  readonly file = input.required<StoredFile>();
  readonly sharedMode = input<boolean>(false);
  readonly closed = output<void>();

  readonly kind = signal<Kind>('other');
  readonly url = signal<string | null>(null);
  readonly safeUrl = signal<SafeResourceUrl | null>(null);
  readonly html = signal<SafeHtml | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly iconOf = iconOf;
  readonly formatBytes = formatBytes;

  async ngOnInit(): Promise<void> {
    const f = this.file();
    this.kind.set(this.detectKind(f.extension));
    try {
      if (this.sharedMode()) {
        // Shared file mode: fetch shared content URL.
        const { url } = await firstValueFrom(this.sharedApi.contentUrl(f.id));
        this.url.set(url);
        this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
      } else {
        if (this.kind() === 'doc') {
          // Backend render docx/excel/text -> HTML.
          const { html } = await firstValueFrom(this.filesApi.previewHtml(f.id));
          this.html.set(this.sanitizer.bypassSecurityTrustHtml(html));
        } else if (this.kind() !== 'other') {
          const { url } = await firstValueFrom(this.filesApi.previewUrl(f.id));
          this.url.set(url);
          this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(url));
        }
      }
    } catch {
      this.error.set('Không tải được nội dung xem trước.');
    } finally {
      this.loading.set(false);
    }
  }

  private detectKind(ext: string): Kind {
    const e = ext.toLowerCase();
    if (e === 'pdf') return 'pdf';
    const cat = categoryOf(e);
    if (cat === 'image') return 'image';
    if (cat === 'audio') return 'audio';
    if (DOC_EXT.has(e)) return 'doc';
    return 'other';
  }

  async download(): Promise<void> {
    let url: string;
    if (this.sharedMode()) {
      const { url: dlUrl } = await firstValueFrom(this.sharedApi.downloadUrl(this.file().id));
      url = dlUrl;
    } else {
      const { url: dlUrl } = await firstValueFrom(this.filesApi.downloadUrl(this.file().id));
      url = dlUrl;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = this.file().name;
    a.click();
  }

  close(): void {
    this.closed.emit();
  }
}
