import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';
import { scrapeQueue, JOB_FRESH_TTL_S, JOB_ATTEMPTS, type ScrapeJobData } from '../queue.js';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

const bodySchema = {
  type: 'object',
  required: ['urls'],
  additionalProperties: false,
  properties: {
    urls: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: 2048,
        pattern: '^https?://',
      },
    },
  },
} as const;

type ScrapeBody = { urls: string[] };

export const scrapeRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: ScrapeBody }>('/scrape', { schema: { body: bodySchema } }, async (req, reply) => {
    const unique = [...new Set(req.body.urls)];
    const rows = unique.map((url) => ({ id: sha1(url), url }));

    // Multi-row insert; conflicting (existing) rows produce no return.
    const ids = rows.map((r) => r.id);
    const urls = rows.map((r) => r.url);
    const inserted = await pool.query<{ id: string }>(
      `insert into scrape_jobs (id, url, status)
       select t.id, t.url, 'queued'
         from unnest($1::text[], $2::text[]) as t(id, url)
       on conflict (id) do nothing
       returning id`,
      [ids, urls],
    );

    const newIds = new Set(inserted.rows.map((r) => r.id));
    const toEnqueue = rows
      .filter((r) => newIds.has(r.id))
      .map((r) => ({
        name: 'scrape',
        data: { url: r.url } satisfies ScrapeJobData,
        opts: {
          jobId: r.id,
          attempts: JOB_ATTEMPTS,
          backoff: { type: 'exponential' as const, delay: 500 },
          removeOnComplete: { age: JOB_FRESH_TTL_S },
          removeOnFail: { age: 60 },
        },
      }));

    if (toEnqueue.length > 0) {
      await scrapeQueue.addBulk(toEnqueue);
    }

    return reply.code(202).send({
      jobs: rows.map((r) => ({ id: r.id, url: r.url, reused: !newIds.has(r.id) })),
    });
  });
};
