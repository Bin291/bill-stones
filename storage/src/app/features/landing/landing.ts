import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { LangService } from '../../core/i18n/lang.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { AuthService } from '../../core/services/auth.service';

export interface SearchResultItem {
  id: string;
  title: string;
  category: 'invoice' | 'contract' | 'tech' | 'sheet';
  categoryLabel: string;
  matchScore: number;
  fileType: string;
  fileSize: string;
  updatedDate: string;
  ocrSnippet: string;
  extractedEntities: { label: string; value: string }[];
  vectorDistance: number;
  highlightWords: string[];
}

export interface BentoFeature {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  icon: string;
  description: string;
  techSpec: string;
  colSpan: string;
  scatterX: number;
  scatterY: number;
  scatterZ: number;
  scatterRotate: number;
}

@Component({
  selector: 'app-landing',
  imports: [CommonModule, MatIconModule, FormsModule, RouterLink, TranslatePipe],
  templateUrl: './landing.html',
  styleUrl: './landing.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Landing {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hostEl = inject(ElementRef);
  private readonly router = inject(Router);
  readonly langService = inject(LangService);
  private readonly auth = inject(AuthService);
  readonly isAuthenticated = this.auth.isAuthenticated;

  // UI State Signals
  readonly mobileMenuOpen = signal<boolean>(false);
  readonly isScrolled = signal<boolean>(false);
  readonly activeNavSection = signal<string>('hero');
  
  // Interactive Search State in Hero & Sandbox
  readonly currentTypingIndex = signal<number>(0);
  readonly selectedFilter = signal<'all' | 'invoice' | 'contract' | 'tech' | 'sheet'>('all');
  readonly selectedResult = signal<SearchResultItem | null>(null);
  readonly showModal = signal<boolean>(false);
  readonly modalType = signal<'signup' | 'preview' | 'security'>('signup');
  readonly registerEmail = signal<string>('');
  readonly registerSuccess = signal<boolean>(false);
  readonly copyFeedback = signal<string | null>(null);

  readonly typingPrompts: string[] = [
    'landing.prompt1',
    'landing.prompt2',
    'landing.prompt3',
    'landing.prompt4',
    'landing.prompt5'
  ];

  // Comprehensive Search Data
  readonly allSearchResults: SearchResultItem[] = [
    {
      id: 'doc-001',
      title: 'Highlands_Coffee_Invoice_Aug2024.pdf',
      category: 'invoice',
      categoryLabel: 'HÓA ĐƠN & BIÊN NHẬN',
      matchScore: 99.4,
      fileType: 'PDF OCR',
      fileSize: '1.2 MB',
      updatedDate: '18/08/2024',
      ocrSnippet: 'TỔNG TIỀN THANH TOÁN: 245.000 VNĐ. Chi tiết: 02 Cà phê phin sữa đá, 01 Trà sen vàng kem phô mai. MST: 0302821264.',
      extractedEntities: [
        { label: 'Số tiền', value: '245.000 ₫' },
        { label: 'Đơn vị', value: 'Highlands Coffee Co.' },
        { label: 'MST', value: '0302821264' },
        { label: 'Hình thức', value: 'QR Momo' }
      ],
      vectorDistance: 0.042,
      highlightWords: ['Highlands', '245.000', 'Cà phê', 'Hóa đơn']
    },
    {
      id: 'doc-002',
      title: 'HopDong_ThueCanHo_Landmark_Signed.pdf',
      category: 'contract',
      categoryLabel: 'HỢP ĐỒNG PHÁP LÝ',
      matchScore: 97.8,
      fileType: 'PDF Scan',
      fileSize: '4.8 MB',
      updatedDate: '12/05/2024',
      ocrSnippet: 'HỢP ĐỒNG THUÊ CĂN HỘ Landmark 81 - Tầng 38. Bên thuê: Nguyễn Văn A. Thời hạn thuê: 12 tháng. Giá thuê: 28.000.000 VNĐ/tháng. Đặt cọc 02 tháng.',
      extractedEntities: [
        { label: 'Địa chỉ', value: 'Landmark 81, P.22, Bình Thạnh' },
        { label: 'Giá thuê', value: '28.000.000 ₫/tháng' },
        { label: 'Thời hạn', value: '12 tháng (06/2024 - 06/2025)' },
        { label: 'Chữ ký số', value: 'Đã xác thực AES-256' }
      ],
      vectorDistance: 0.081,
      highlightWords: ['Landmark 81', 'Hợp đồng', 'Thuê căn hộ', '28.000.000']
    },
    {
      id: 'doc-003',
      title: 'System_Architecture_Payment_Flow.png',
      category: 'tech',
      categoryLabel: 'SƠ ĐỒ & THIẾT KẾ',
      matchScore: 95.6,
      fileType: 'PNG Vision',
      fileSize: '3.1 MB',
      updatedDate: '04/07/2024',
      ocrSnippet: 'Luồng xử lý thanh toán phân tán: Client Gateway -> Kafka Queue (Topic: tx_events) -> Fraud Detection AI Worker -> Payment Provider (Webhook 200 OK).',
      extractedEntities: [
        { label: 'Framework', value: 'Apache Kafka + Go Worker' },
        { label: 'Độ trễ TB', value: '< 45ms P99' },
        { label: 'Bảo mật', value: 'mTLS + JWT HMAC-SHA256' },
        { label: 'Node count', value: '12 Microservices' }
      ],
      vectorDistance: 0.124,
      highlightWords: ['Microservices', 'Kafka', 'Payment Gateway', 'Kiến trúc']
    },
    {
      id: 'doc-004',
      title: 'BangKe_ChiPhi_CongTac_Q2_2024.xlsx',
      category: 'sheet',
      categoryLabel: 'BẢNG KÊ & TÀI CHÍNH',
      matchScore: 92.1,
      fileType: 'XLSX Sheet',
      fileSize: '840 KB',
      updatedDate: '30/06/2024',
      ocrSnippet: 'Bảng kê quyết toán chuyến công tác TP.HCM - Đà Nẵng: Vé máy bay Vietnam Airlines (4.200.000đ), Khách sạn Novotel 3 đêm (5.400.000đ), Tiếp khách (3.150.000đ). Tổng: 12.750.000đ.',
      extractedEntities: [
        { label: 'Tổng quyết toán', value: '12.750.000 ₫' },
        { label: 'Địa điểm', value: 'Đà Nẵng - Hội An' },
        { label: 'Trạng thái', value: 'Đã duyệt qua CFO' },
        { label: 'Phòng ban', value: 'Kỹ thuật R&D' }
      ],
      vectorDistance: 0.187,
      highlightWords: ['Chi phí', 'Công tác', 'Q2', 'Quyết toán']
    }
  ];

  // Filtered Results for Sandbox
  readonly filteredResults = computed(() => {
    const filter = this.selectedFilter();
    if (filter === 'all') return this.allSearchResults;
    return this.allSearchResults.filter(item => item.category === filter);
  });

  readonly bentoFeatures: BentoFeature[] = [
    {
      id: 'bento-1',
      title: 'bento.feature1.title',
      subtitle: 'bento.feature1.subtitle',
      tag: 'AI CORE',
      icon: 'manage_search',
      description: 'bento.feature1.desc',
      techSpec: '768-D Dense Embedding',
      colSpan: 'md:col-span-2 lg:col-span-2',
      scatterX: -180,
      scatterY: -160,
      scatterZ: 120,
      scatterRotate: -15
    },
    {
      id: 'bento-2',
      title: 'bento.feature2.title',
      subtitle: 'bento.feature2.subtitle',
      tag: 'VISION OCR',
      icon: 'document_scanner',
      description: 'bento.feature2.desc',
      techSpec: 'Gemini Vision OCR',
      colSpan: 'md:col-span-1 lg:col-span-1',
      scatterX: 180,
      scatterY: -140,
      scatterZ: 100,
      scatterRotate: 12
    },
    {
      id: 'bento-3',
      title: 'bento.feature3.title',
      subtitle: 'bento.feature3.subtitle',
      tag: 'SECURITY',
      icon: 'vpn_key',
      description: 'bento.feature3.desc',
      techSpec: 'Presigned-only URL',
      colSpan: 'md:col-span-1 lg:col-span-1',
      scatterX: -220,
      scatterY: 20,
      scatterZ: 140,
      scatterRotate: -8
    },
    {
      id: 'bento-4',
      title: 'bento.feature4.title',
      subtitle: 'bento.feature4.subtitle',
      tag: 'INFRASTRUCTURE',
      icon: 'bolt',
      description: 'bento.feature4.desc',
      techSpec: 'Cloudflare R2 // TTL 600s',
      colSpan: 'md:col-span-2 lg:col-span-2',
      scatterX: 200,
      scatterY: 40,
      scatterZ: 150,
      scatterRotate: 10
    },
    {
      id: 'bento-5',
      title: 'bento.feature5.title',
      subtitle: 'bento.feature5.subtitle',
      tag: 'RERANK',
      icon: 'auto_awesome',
      description: 'bento.feature5.desc',
      techSpec: 'bge-reranker-v2-m3',
      colSpan: 'md:col-span-1 lg:col-span-1',
      scatterX: -160,
      scatterY: 170,
      scatterZ: 110,
      scatterRotate: -12
    },
    {
      id: 'bento-6',
      title: 'bento.feature6.title',
      subtitle: 'bento.feature6.subtitle',
      tag: 'NLP ENGINE',
      icon: 'translate',
      description: 'bento.feature6.desc',
      techSpec: 'Vietnamese & English',
      colSpan: 'md:col-span-1 lg:col-span-1',
      scatterX: 0,
      scatterY: 210,
      scatterZ: 80,
      scatterRotate: 6
    },
    {
      id: 'bento-7',
      title: 'bento.feature7.title',
      subtitle: 'bento.feature7.subtitle',
      tag: 'HYBRID FUSION',
      icon: 'layers',
      description: 'bento.feature7.desc',
      techSpec: 'RRF dense + bge + fts',
      colSpan: 'md:col-span-1 lg:col-span-1',
      scatterX: 190,
      scatterY: 180,
      scatterZ: 130,
      scatterRotate: 14
    },
    {
      id: 'bento-8',
      title: 'bento.feature8.title',
      subtitle: 'bento.feature8.subtitle',
      tag: 'ROBUSTNESS',
      icon: 'spellcheck',
      description: 'bento.feature8.desc',
      techSpec: 'Leet-speak & unaccent FTS',
      colSpan: 'md:col-span-1 lg:col-span-1',
      scatterX: -140,
      scatterY: -200,
      scatterZ: 90,
      scatterRotate: -9
    }
  ];


  constructor() {
    afterNextRender(() => {
      if (isPlatformBrowser(this.platformId)) {
        // afterNextRender ở đây chạy TRƯỚC khi DOM thật sự "chốt" — nếu bind
        // ScrollTrigger ngay, GSAP giữ tham chiếu tới node sẽ bị thay thế ngay
        // sau đó (animation chạy nhưng vô hình vì áp lên node đã rời DOM).
        // Delay 1 tick để chắc chắn bind đúng vào node đang gắn trong DOM thật.
        setTimeout(() => {
          this.initGsapAnimations();
          this.initTypewriterSimulation();
          this.initScrollSpy();
        }, 100);
      }
    });
  }

  // Truy vấn mẫu -> điều hướng thật sang /search (yêu cầu đăng nhập qua authGuard).
  setQuery(query: string): void {
    const translated = this.langService.translate(query);
    void this.router.navigate(['/search'], { queryParams: { q: translated } });
  }

  setFilter(filter: 'all' | 'invoice' | 'contract' | 'tech' | 'sheet'): void {
    this.selectedFilter.set(filter);
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update(v => !v);
  }

  openModal(type: 'signup' | 'preview' | 'security', item?: SearchResultItem): void {
    this.modalType.set(type);
    if (item) {
      this.selectedResult.set(item);
    }
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
    this.registerSuccess.set(false);
  }

  handleRegisterSubmit(): void {
    const email = this.registerEmail().trim();
    if (!email) {
      void this.router.navigate(['/login']);
      return;
    }
    void this.router.navigate(['/login'], { queryParams: { email } });
  }

  copyToClipboard(text: string, label: string): void {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      this.copyFeedback.set(`Đã sao chép ${label}!`);
      setTimeout(() => this.copyFeedback.set(null), 2200);
    }
  }

  // Smooth scroll helper
  scrollToSection(sectionId: string): void {
    this.mobileMenuOpen.set(false);
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // --- GSAP ANIMATION ORCHESTRATION ---
  private initGsapAnimations(): void {
    gsap.registerPlugin(ScrollTrigger);

    const isDesktop = window.innerWidth >= 1024;

    // 1. Hero 3D Mockup Tilt Transition to Flat on Scroll
    const heroMockup = this.hostEl.nativeElement.querySelector('#hero-mockup');
    const heroSection = this.hostEl.nativeElement.querySelector('#hero');
    const heroContainer = this.hostEl.nativeElement.querySelector('.hero-container');

    if (heroMockup && heroSection) {
      gsap.to(heroMockup, {
        scrollTrigger: {
          trigger: heroSection,
          start: 'top top',
          end: 'bottom center',
          scrub: 1.2,
        },
        rotateX: 0,
        rotateY: 0,
        rotateZ: 0,
        translateY: 0,
        scale: 1,
        ease: 'power2.out',
      });
    }

    // 2. Hero Section Fade-out & Slide-up
    if (heroContainer && heroSection) {
      gsap.to(heroContainer, {
        scrollTrigger: {
          trigger: heroSection,
          start: 'center top',
          end: 'bottom top',
          scrub: true,
        },
        opacity: 0,
        y: -80,
        ease: 'power1.in',
      });
    }

    // 3. How BillPrime Works Section (Pinned Sequence on Desktop)
    const howItWorksSection = this.hostEl.nativeElement.querySelector('#how-it-works');
    const stepCards = this.hostEl.nativeElement.querySelectorAll('.how-step-card');
    const pathDraw1 = this.hostEl.nativeElement.querySelector('#pipeline-path-1');
    const pathDraw2 = this.hostEl.nativeElement.querySelector('#pipeline-path-2');

    if (howItWorksSection && isDesktop) {
      // Set initial states
      gsap.set(stepCards, { opacity: 0, y: 35 });
      if (pathDraw1) gsap.set(pathDraw1, { strokeDashoffset: 300 });
      if (pathDraw2) gsap.set(pathDraw2, { strokeDashoffset: 300 });

      const howTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: howItWorksSection,
          start: 'top top',
          end: '+=1600',
          pin: true,
          scrub: 1,
          anticipatePin: 1,
        },
      });

      // Sequence: Card 1 -> Line 1 -> Card 2 -> Line 2 -> Card 3
      if (stepCards[0]) {
        howTimeline.to(stepCards[0], { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
      }
      if (pathDraw1) {
        howTimeline.to(pathDraw1, { strokeDashoffset: 0, duration: 0.8, ease: 'linear' });
      }
      if (stepCards[1]) {
        howTimeline.to(stepCards[1], { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
      }
      if (pathDraw2) {
        howTimeline.to(pathDraw2, { strokeDashoffset: 0, duration: 0.8, ease: 'linear' });
      }
      if (stepCards[2]) {
        howTimeline.to(stepCards[2], { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out' });
      }
    } else if (stepCards.length > 0) {
      // Mobile fallback: simple stagger reveal on scroll
      gsap.from(stepCards, {
        scrollTrigger: {
          trigger: howItWorksSection,
          start: 'top 75%',
        },
        opacity: 0,
        y: 30,
        stagger: 0.25,
        duration: 0.7,
        ease: 'power2.out',
      });
    }

    const featuresSection = this.hostEl.nativeElement.querySelector('#features');
    const bentoContainer = this.hostEl.nativeElement.querySelector('.bento-shutter-container');
    const bentoTiles = this.hostEl.nativeElement.querySelectorAll('.bento-tile');
    const shutterGlowMsg = this.hostEl.nativeElement.querySelector('.shutter-glow-message');

    if (bentoContainer && featuresSection && isDesktop && bentoTiles.length > 0) {
      const bentoTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: bentoContainer,
          start: 'top 72px',
          end: '+=3200',
          pin: featuresSection,
          scrub: 1.2,
          anticipatePin: 1,
        },
      });

      // Giữ nguyên lưới (đọc được hết 8 thẻ) trong ~15% quãng cuộn đầu,
      // rồi mới bắt đầu phân rã — tránh vỡ tan ngay khi vừa pin xong.
      const HOLD = 0.15;

      // Scatter each tile according to its metadata
      bentoTiles.forEach((tile: HTMLElement, idx: number) => {
        const feature = this.bentoFeatures[idx];
        if (feature) {
          bentoTimeline.to(
            tile,
            {
              x: feature.scatterX * 1.5,
              y: feature.scatterY * 1.5,
              z: feature.scatterZ,
              rotation: feature.scatterRotate,
              opacity: 0,
              scale: 0.45,
              duration: 1,
              ease: 'power2.inOut',
            },
            HOLD // All scatter at the same time, sau khi giữ lưới ổn định
          );
        }
      });

      if (shutterGlowMsg) {
        bentoTimeline.fromTo(
          shutterGlowMsg,
          { opacity: 0.1, scale: 0.85 },
          { opacity: 1, scale: 1.05, duration: 1, ease: 'power2.out' },
          HOLD + 0.3
        );
      }
    }

    // 5. SVG Shield Draw-in Animation on Scroll
    const shieldSection = this.hostEl.nativeElement.querySelector('#security');
    const shieldDrawPaths = this.hostEl.nativeElement.querySelectorAll('.shield-draw-path');

    if (shieldSection && shieldDrawPaths.length > 0) {
      gsap.to(shieldDrawPaths, {
        scrollTrigger: {
          trigger: shieldSection,
          start: 'top 70%',
          end: 'center center',
          scrub: 1,
        },
        strokeDashoffset: 0,
        ease: 'power2.out',
      });
    }

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      ScrollTrigger.getAll().forEach(t => t.kill());
    });
  }

  // Typewriter search simulation (Safe counter method, NO TextPlugin)
  private initTypewriterSimulation(): void {
    const searchInputDisplay = this.hostEl.nativeElement.querySelector('#hero-typed-input');
    if (!searchInputDisplay) return;

    let promptIndex = 0;
    const typeNextPrompt = () => {
      const targetText = this.typingPrompts[promptIndex];
      const charCounter = { count: 0 };

      // Type forward
      gsap.to(charCounter, {
        count: targetText.length,
        duration: 1.8,
        ease: 'none',
        onUpdate: () => {
          const currentLength = Math.floor(charCounter.count);
          searchInputDisplay.textContent = targetText.slice(0, currentLength);
        },
        onComplete: () => {
          // Pause at full text
          setTimeout(() => {
            // Backspace delete animation
            gsap.to(charCounter, {
              count: 0,
              duration: 0.8,
              ease: 'none',
              onUpdate: () => {
                const currentLength = Math.floor(charCounter.count);
                searchInputDisplay.textContent = targetText.slice(0, currentLength);
              },
              onComplete: () => {
                promptIndex = (promptIndex + 1) % this.typingPrompts.length;
                setTimeout(typeNextPrompt, 400);
              },
            });
          }, 2400);
        },
      });
    };

    // Initial trigger
    typeNextPrompt();
  }

  // Track scroll position for header blur and active section spy
  private initScrollSpy(): void {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      this.isScrolled.set(scrollY > 40);

      const sections = ['hero', 'features', 'how-it-works', 'security', 'sandbox', 'pricing'];
      for (const sectionId of sections) {
        const el = document.getElementById(sectionId);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= 200 && rect.bottom >= 200) {
            this.activeNavSection.set(sectionId);
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('scroll', handleScroll);
    });
  }
}
