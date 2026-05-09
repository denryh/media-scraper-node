import type { FastifyPluginAsync } from 'fastify';
import { pool } from '../db.js';

export const jobRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/jobs/:id', async (req, reply) => {
    const { rows } = await pool.query(
      `select s.id, s.url, s.status, s.attempts, s.error,
              s.created_at  as "createdAt",
              s.completed_at as "completedAt",
              coalesce((select count(*) from media_occurrences o where o.job_id = s.id), 0)::int
                as "occurrenceCount"
         from scrape_jobs s
        where s.id = $1`,
      [req.params.id],
    );
    if (rows.length === 0) return reply.code(404).send({ error: 'not_found' });
    return rows[0];
  });
};
