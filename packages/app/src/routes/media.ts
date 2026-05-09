import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';

const querySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', enum: ['image', 'video'] },
    q: { type: 'string', minLength: 1, maxLength: 200 },
    cursor: { type: 'string', maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  },
} as const;

type Query = { type?: 'image' | 'video'; q?: string; cursor?: string; limit?: number };

const encodeCursor = (id: string | number): string =>
  Buffer.from(String(id), 'utf8').toString('base64url');
const decodeCursor = (cursor: string): bigint | null => {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!/^\d+$/.test(raw)) return null;
    return BigInt(raw);
  } catch {
    return null;
  }
};

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: Query }>('/media', { schema: { querystring: querySchema } }, async (req, reply) => {
    const { type, q, cursor, limit = 50 } = req.query;

    const cursorId = cursor ? decodeCursor(cursor) : null;
    if (cursor && cursorId === null) {
      return reply.code(400).send({ error: 'invalid_cursor' });
    }

    // Use parameter slots; pass null when filter is not active.
    // Fetch limit+1 to know if there's another page.
    const sql = `
      select a.id,
             a.media_url        as "mediaUrl",
             a.media_type       as "mediaType",
             a.occurrence_count as "occurrenceCount",
             a.first_seen_at    as "firstSeenAt",
             a.last_seen_at     as "lastSeenAt"
        from media_assets a
       where ($1::text is null or a.media_type = $1)
         and (
           $2::text is null
           or a.media_url ilike '%' || $2 || '%'
           or exists (
             select 1 from media_occurrences o
              where o.asset_id = a.id and o.alt_text ilike '%' || $2 || '%'
           )
         )
         and ($3::bigint is null or a.id < $3::bigint)
       order by a.id desc
       limit $4::int
    `;
    const { rows } = await pool.query<{
      id: string;
      mediaUrl: string;
      mediaType: 'image' | 'video';
      occurrenceCount: number;
      firstSeenAt: string;
      lastSeenAt: string;
    }>(sql, [type ?? null, q ?? null, cursorId?.toString() ?? null, limit + 1]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor(items[items.length - 1]!.id) : null;

    return { items, nextCursor };
  });
};
