import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { pool } from './db.js';
import { scrape } from './scraper.js';

export type ScrapeJobData = { url: string };

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

const connection: ConnectionOptions = redis;

export const scrapeQueue = new Queue<ScrapeJobData>('scrape', { connection });

export const JOB_FRESH_TTL_S = Number(process.env.JOB_FRESH_TTL_S ?? 900);
const WORKER_CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 5);
export const JOB_ATTEMPTS = Number(process.env.JOB_ATTEMPTS ?? 3);

export function startWorker(log: {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (e: unknown, msg?: string) => void;
}) {
  const worker = new Worker<ScrapeJobData>(
    'scrape',
    async (job) => {
      const id = job.id!;
      const attempt = job.attemptsMade + 1;
      await pool.query(
        "update scrape_jobs set status='running', attempts=$2, error=null where id=$1",
        [id, attempt],
      );
      await scrape(job.data.url, id);
      await pool.query(
        "update scrape_jobs set status='done', completed_at=now(), error=null where id=$1",
        [id],
      );
    },
    { connection, concurrency: WORKER_CONCURRENCY },
  );

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const finalAttempt = job.attemptsMade >= (job.opts.attempts ?? 1);
    const msg = err instanceof Error ? err.message : String(err);
    if (finalAttempt) {
      await pool.query(
        "update scrape_jobs set status='failed', completed_at=now(), error=$2, attempts=$3 where id=$1",
        [job.id, msg, job.attemptsMade],
      );
      log.error(err, `job ${job.id} failed (final): ${msg}`);
    } else {
      await pool.query("update scrape_jobs set error=$2 where id=$1", [job.id, msg]);
      log.warn(`job ${job.id} attempt ${job.attemptsMade} failed: ${msg}`);
    }
  });

  log.info(`worker started (concurrency=${WORKER_CONCURRENCY})`);
  return worker;
}

export async function shutdownQueue() {
  await scrapeQueue.close();
  await redis.quit();
}
