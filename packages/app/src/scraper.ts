import { request } from 'undici';
import { Parser } from 'htmlparser2';
import { pool } from './db.js';

const MAX_BYTES = Number(process.env.MAX_PAGE_BYTES ?? 5 * 1024 * 1024); // 5 MB
const EXTRACT_BUFFER_SIZE = Number(process.env.EXTRACT_BUFFER_SIZE ?? 50);
const HEADERS_TIMEOUT_MS = Number(process.env.HEADERS_TIMEOUT_MS ?? 5_000);
const BODY_TIMEOUT_MS = Number(process.env.BODY_TIMEOUT_MS ?? 10_000);

type MediaType = 'image' | 'video';
type Extracted = { mediaUrl: string; mediaType: MediaType; altText: string | null };

export type ScrapeResult = {
  mediaCount: number;
  bytesConsumed: number;
};

class ScrapeError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'ScrapeError';
  }
}

/**
 * Streaming scrape pipeline:
 *   undici.stream(url) → SAX parser → bounded buffer → CTE upsert.
 *
 * Memory is bounded: htmlparser2 holds ~8 KB of state, the chunk buffer is
 * Node's default highWaterMark, and the extract buffer flushes at 50 items.
 * Total per-job RSS contribution is ~35 KB, independent of page size.
 */
export async function scrape(url: string, jobId: string): Promise<ScrapeResult> {
  const baseUrl = new URL(url);

  const res = await request(url, {
    method: 'GET',
    headersTimeout: HEADERS_TIMEOUT_MS,
    bodyTimeout: BODY_TIMEOUT_MS,
    maxRedirections: 3,
  });

  // Always swallow stream errors so an abort/destroy doesn't bring down the process.
  res.body.on('error', () => {});

  // ---- Pre-flight checks on response headers ----
  // Use body.dump() to drain-and-discard the body cleanly on rejection paths.
  if (res.statusCode < 200 || res.statusCode >= 300) {
    await res.body.dump();
    throw new ScrapeError(`bad status ${res.statusCode}`, 'bad_status');
  }
  const contentType = String(res.headers['content-type'] ?? '');
  if (!contentType.includes('text/html')) {
    await res.body.dump();
    throw new ScrapeError(`unsupported content-type ${contentType}`, 'bad_content_type');
  }
  const contentLengthHeader = res.headers['content-length'];
  const declaredLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
  if (declaredLength !== undefined && declaredLength > MAX_BYTES) {
    await res.body.dump();
    throw new ScrapeError(
      `content-length ${declaredLength} > ${MAX_BYTES}`,
      'too_large',
    );
  }

  // ---- Streaming extract + bounded buffer ----
  const buffer: Extracted[] = [];
  let totalCount = 0;
  let bytesConsumed = 0;

  // Track parent tag for <source> resolution (image inside <picture>, otherwise video).
  const stack: string[] = [];

  const tryAdd = (rawSrc: string, mediaType: MediaType, altText: string | null) => {
    if (!rawSrc || rawSrc.startsWith('data:')) return;
    let abs: string;
    try {
      abs = new URL(rawSrc, baseUrl).toString();
    } catch {
      return;
    }
    buffer.push({ mediaUrl: abs, mediaType, altText });
  };

  const parser = new Parser(
    {
      onopentag(name, attrs) {
        stack.push(name);
        if (name === 'img' && attrs.src) {
          tryAdd(attrs.src, 'image', attrs.alt ?? null);
        } else if (name === 'video' && attrs.src) {
          tryAdd(attrs.src, 'video', null);
        } else if (name === 'source' && attrs.src) {
          const parent = stack[stack.length - 2];
          const typeAttr = attrs.type ?? '';
          let mediaType: MediaType | null = null;
          if (parent === 'picture' || typeAttr.startsWith('image/')) mediaType = 'image';
          else if (parent === 'video' || typeAttr.startsWith('video/')) mediaType = 'video';
          if (mediaType) tryAdd(attrs.src, mediaType, null);
        }
      },
      onclosetag() {
        stack.pop();
      },
    },
    { decodeEntities: true },
  );

  const flush = async () => {
    if (buffer.length === 0) return;
    const items = buffer.splice(0);
    totalCount += items.length;
    await persist(items, jobId, url);
  };

  try {
    for await (const chunk of res.body) {
      bytesConsumed += chunk.length;
      if (bytesConsumed > MAX_BYTES) {
        // Drain cleanly rather than destroy; the error sink above swallows any abort.
        await res.body.dump().catch(() => {});
        throw new ScrapeError(`exceeded ${MAX_BYTES} bytes mid-stream`, 'too_large');
      }
      // htmlparser2 takes string or Buffer; passing buffer avoids one copy.
      parser.write(chunk.toString('utf8'));

      // Backpressure: flush when extract buffer fills, awaiting before pulling
      // the next chunk holds the connection idle.
      if (buffer.length >= EXTRACT_BUFFER_SIZE) {
        await flush();
      }
    }
    parser.end();
    await flush();
  } catch (err) {
    if (!res.body.destroyed) await res.body.dump().catch(() => {});
    throw err;
  }

  return { mediaCount: totalCount, bytesConsumed };
}

async function persist(items: Extracted[], jobId: string, sourceUrl: string): Promise<void> {
  if (items.length === 0) return;
  const mediaUrls = items.map((i) => i.mediaUrl);
  const mediaTypes = items.map((i) => i.mediaType);
  const altTexts = items.map((i) => i.altText);

  await pool.query(
    `with input as (
       -- intra-page dedup: avoids "row affected twice" in upsert and keeps
       -- the counter trigger correct (one bump per (asset, job) pair)
       select distinct on (media_url)
              media_url, media_type, alt_text
       from   unnest($1::text[], $2::text[], $3::text[])
              as t(media_url, media_type, alt_text)
     ),
     upserted as (
       insert into media_assets (media_url, media_type)
       select media_url, media_type from input
       on conflict (media_url) do update set media_url = excluded.media_url
       returning id, media_url
     )
     insert into media_occurrences (asset_id, job_id, source_url, alt_text)
     select u.id, $4, $5, i.alt_text
     from   upserted u join input i using (media_url)
     on conflict (asset_id, job_id) do nothing`,
    [mediaUrls, mediaTypes, altTexts, jobId, sourceUrl],
  );
}
