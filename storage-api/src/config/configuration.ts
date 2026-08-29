/**
 * Cấu hình tập trung, đọc từ biến môi trường (mục 5.D, 5.F, 7.E, 8, 12).
 * Dùng qua ConfigService: `config.get('r2.bucket')`, ...
 */
export default () => ({
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  webOrigin: (process.env.WEB_ORIGIN ?? 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  database: {
    url: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  },

  supabase: {
    jwtSecret: process.env.SUPABASE_JWT_SECRET,
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    anonKey: process.env.SUPABASE_ANON_KEY,
    // Verify access token bằng JWKS (ES256 bất đối xứng — mặc định của Supabase mới).
    jwksUrl: process.env.SUPABASE_URL
      ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`
      : undefined,
    issuer: process.env.SUPABASE_URL
      ? `${process.env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1`
      : undefined,
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID,
    bucket: process.env.R2_BUCKET,
    region: process.env.R2_REGION ?? 'auto',
    endpoint:
      process.env.R2_ENDPOINT ||
      (process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : undefined),
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    // Để trống theo mục 12.B -> publicUrl() luôn trả null, mọi đường đọc là presigned.
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL || null,
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  limits: {
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? '2048', 10),
    chunkSizeMb: parseInt(process.env.CHUNK_SIZE_MB ?? '8', 10),
    rateLimitEnabled: (process.env.RATE_LIMIT ?? 'off') === 'on',
  },

  trash: {
    retentionDays: parseInt(process.env.TRASH_RETENTION_DAYS ?? '30', 10),
  },

  // Quét virus tệp thực thi (.exe…) bằng VirusTotal API v3 (mục cảnh báo .exe).
  // Lấy key miễn phí tại https://www.virustotal.com/gui/join-us. Để trống -> chỉ
  // cảnh báo .exe, bỏ qua bước quét thật.
  virusScan: {
    apiKey: process.env.VIRUSTOTAL_API_KEY || undefined,
    // Trần dung lượng gửi bytes lên VT để phân tích (free tier: 32MB).
    maxUploadBytes: parseInt(
      process.env.VIRUSTOTAL_MAX_UPLOAD_MB ?? '32',
      10,
    ) * 1024 * 1024,
    // Thời gian tối đa chờ VT phân tích xong 1 tệp lạ (ms).
    analysisTimeoutMs: parseInt(
      process.env.VIRUSTOTAL_TIMEOUT_MS ?? '90000',
      10,
    ),
  },

  share: {
    contentTtlSeconds: parseInt(
      process.env.SHARE_CONTENT_TTL_SECONDS ?? '600',
      10,
    ),
    baseUrl:
      process.env.SHARE_BASE_URL ??
      process.env.WEB_ORIGIN ??
      'http://localhost:4200',
    sessionSecret:
      process.env.SHARE_SESSION_SECRET ?? 'dev-share-session-secret',
  },

  ai: {
    // Embedding dense (768d, khớp DocumentChunk.embedding) + vision (OCR/caption
    // ảnh) — thứ tự ưu tiên: BazaarLink (OpenAI-compatible) nếu có key VÀ chưa
    // gặp 402, fallback Gemini direct. Xem mục 8.E (hybrid search) trong PLAN.
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiEmbeddingModel:
      process.env.GEMINI_EMBEDDING_MODEL ?? 'gemini-embedding-001',
    geminiOcrModel: process.env.GEMINI_OCR_MODEL ?? 'gemini-3.6-flash',
    embedDimensions: parseInt(process.env.AI_EMBED_DIMENSIONS ?? '768', 10),
    bazaarlinkApiKey: process.env.BAZAARLINK_API_KEY || undefined,
    bazaarlinkBaseUrl: process.env.BAZAARLINK_BASE_URL || undefined,
    bazaarlinkEmbeddingModel:
      process.env.BAZAARLINK_EMBEDDING_MODEL ?? 'openai/text-embedding-3-small',
    bazaarlinkOcrModel:
      process.env.BAZAARLINK_OCR_MODEL ?? 'google/gemini-2.5-flash',
    // HuggingFace Inference Providers — nhánh BGE-M3 (dense đa ngôn ngữ, 1024d)
    // + reranker cross-encoder cuối pipeline hybrid search.
    hfApiKey: process.env.HF_API_KEY || undefined,
    hfBaseUrl: process.env.HF_BASE_URL ?? 'https://router.huggingface.co',
    hfBgeModel: process.env.HF_BGE_MODEL ?? 'BAAI/bge-m3',
    hfBgeDimensions: parseInt(process.env.HF_BGE_DIMENSIONS ?? '1024', 10),
    hfRerankerModel: process.env.HF_RERANKER_MODEL ?? 'BAAI/bge-reranker-v2-m3',
    hfTimeoutMs: parseInt(process.env.HF_TIMEOUT_MS ?? '45000', 10),
    hfEnableBge: (process.env.HF_ENABLE_BGE ?? 'true') !== 'false',
    hfEnableReranker: (process.env.HF_ENABLE_RERANKER ?? 'true') !== 'false',
    // SigLIP: HF Inference Providers không host CLIP/SigLIP serverless nữa
    // (2025) — nhánh ảnh dùng Gemini vision auto-caption thay thế (xem
    // DocumentParserService). Cờ này giữ lại để bật lại nếu HF phục vụ lại.
    hfEnableSiglip: (process.env.HF_ENABLE_SIGLIP ?? 'false') === 'true',
  },
});

export type AppConfig = ReturnType<typeof import('./configuration').default>;
