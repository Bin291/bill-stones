-- ============================================================
-- Hybrid Search (mục 8.E) — chạy MỘT LẦN qua:
--   npx prisma db execute --file prisma/hybrid-search-setup.sql --url "$DATABASE_URL"
-- Idempotent: dùng CREATE OR REPLACE / IF NOT EXISTS xuyên suốt, chạy lại an
-- toàn. KHÔNG dùng `prisma migrate` cho file này — DB hiện có drift so với
-- lịch sử migration cục bộ (bảng Tag/FileTag + cột File.hlsStatus áp dụng
-- thẳng, không qua migration ghi lại), nên `prisma migrate dev` sẽ đòi reset
-- (xoá sạch dữ liệu). `db execute` áp SQL trực tiếp, không đụng lịch sử.
-- ============================================================

-- 1) Cột "embeddingBge" (1024d, BGE-M3) — khớp field Unsupported trong
--    schema.prisma. Prisma không tạo được cột vector qua migrate an toàn ở
--    đây nên thêm tay.
alter table "DocumentChunk"
  add column if not exists "embeddingBge" vector(1024);

-- 2) RPC dense (Gemini/BazaarLink 768d) — CHƯA từng tồn tại trong DB này
--    (bản trước chỉ có FTS thuần, không dùng embedding). LUÔN filter user_id.
create or replace function match_document_chunks(
  query_embedding vector(768),
  match_user_id uuid,
  match_count int default 20
)
returns table (
  file_id text,
  file_name text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    f.id as file_id,
    f.name as file_name,
    dc.content,
    1 - (dc.embedding <=> query_embedding) as similarity
  from "DocumentChunk" dc
  join "File" f on f.id = dc."fileId"
  where f."userId" = match_user_id::text
    and f.status = 'ready'
    and f."deletedAt" is null
    and dc.embedding is not null
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- 3) Cột tsvector "content_tsv" — Postgres tự đồng bộ với "content".
--    'simple' để giữ dấu tiếng Việt (config 'english' sẽ stem sai).
alter table "DocumentChunk"
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('simple', coalesce(content, ''))) stored;

create index if not exists document_chunk_content_tsv_gin
  on "DocumentChunk" using gin (content_tsv);

-- 3b) FTS ACCENT-INSENSITIVE — user gõ "so 7" phải match "số 7". Extension
--     `unaccent` sẵn có (đã bật ở migration đầu); wrap IMMUTABLE để dùng
--     được trong GENERATED column (unaccent gốc STABLE).
create extension if not exists unaccent;
create or replace function public.immutable_unaccent(text)
  returns text language sql immutable strict parallel safe as
$$ select public.unaccent('public.unaccent', $1) $$;

alter table "DocumentChunk"
  add column if not exists content_tsv_ua tsvector
  generated always as (
    to_tsvector('simple', public.immutable_unaccent(coalesce(content, '')))
  ) stored;

create index if not exists document_chunk_content_tsv_ua_gin
  on "DocumentChunk" using gin (content_tsv_ua);

-- 4) BGE-M3 (1024d) — RPC giống dense nhưng đọc cột "embeddingBge".
create or replace function match_document_chunks_bge(
  query_embedding vector(1024),
  match_user_id uuid,
  match_count int default 20
)
returns table (
  file_id text,
  file_name text,
  chunk_id text,
  content text,
  similarity float
)
language sql stable
as $$
  select
    f.id as file_id,
    f.name as file_name,
    dc.id as chunk_id,
    dc.content,
    1 - (dc."embeddingBge" <=> query_embedding) as similarity
  from "DocumentChunk" dc
  join "File" f on f.id = dc."fileId"
  where f."userId" = match_user_id::text
    and f.status = 'ready'
    and f."deletedAt" is null
    and dc."embeddingBge" is not null
  order by dc."embeddingBge" <=> query_embedding
  limit match_count;
$$;

-- 5) FTS lexical — TÊN FILE (ILIKE + tsvector, giữ hành vi bản FTS-only cũ)
--    UNION nội dung tài liệu (ts_rank_cd, websearch_to_tsquery cho phép cú
--    pháp Google-like: "quoted", -exclude). Match cả bản có dấu lẫn unaccent.
create or replace function match_document_chunks_fts(
  query_text text,
  match_user_id uuid,
  match_count int default 20
)
returns table (
  file_id text,
  file_name text,
  chunk_id text,
  content text,
  rank float
)
language sql stable
as $$
  with q as (
    select
      websearch_to_tsquery('simple', query_text) as tsq,
      websearch_to_tsquery('simple', public.immutable_unaccent(query_text)) as tsq_ua
  ),
  name_hits as (
    select
      f.id as file_id,
      f.name as file_name,
      null::text as chunk_id,
      f.name as content,
      (
        case when public.immutable_unaccent(f.name) ilike
                   '%' || public.immutable_unaccent(query_text) || '%'
             then 1.0 else 0.0 end
        + coalesce(
            ts_rank_cd(
              to_tsvector('simple', public.immutable_unaccent(regexp_replace(f.name, '[^[:alnum:]]+', ' ', 'g'))),
              (select tsq_ua from q)
            ), 0
          )
      )::float as rank
    from "File" f
    where f."userId" = match_user_id::text
      and f.status = 'ready'
      and f."deletedAt" is null
      and (
        public.immutable_unaccent(f.name) ilike
          '%' || public.immutable_unaccent(query_text) || '%'
        or to_tsvector('simple', public.immutable_unaccent(regexp_replace(f.name, '[^[:alnum:]]+', ' ', 'g'))) @@ (select tsq_ua from q)
      )
  ),
  content_hits as (
    select
      f.id as file_id,
      f.name as file_name,
      dc.id as chunk_id,
      dc.content,
      greatest(
        ts_rank_cd(dc.content_tsv, (select tsq from q)),
        ts_rank_cd(dc.content_tsv_ua, (select tsq_ua from q))
      )::float as rank
    from "DocumentChunk" dc
    join "File" f on f.id = dc."fileId"
    cross join q
    where f."userId" = match_user_id::text
      and f.status = 'ready'
      and f."deletedAt" is null
      and (dc.content_tsv @@ q.tsq or dc.content_tsv_ua @@ q.tsq_ua)
  )
  select * from name_hits
  union all
  select * from content_hits
  order by rank desc
  limit match_count;
$$;

-- 6) Index vector cho cột mới. CONCURRENTLY không dùng được trong transaction
--    của `db execute`/migrate — bảng còn nhỏ nên build thường (không CONCURRENTLY)
--    chấp nhận được; đổi lại thành CONCURRENTLY thủ công trong SQL Editor nếu
--    bảng đã lớn và cần tránh khoá.
create index if not exists document_chunk_bge_hnsw
  on "DocumentChunk" using hnsw ("embeddingBge" vector_cosine_ops);

create index if not exists document_chunk_embedding_hnsw
  on "DocumentChunk" using hnsw (embedding vector_cosine_ops);
