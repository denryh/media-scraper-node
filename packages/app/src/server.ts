import Fastify from 'fastify';
import { runMigrations } from './migrate.js';
import { pool } from './db.js';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 16 * 1024,
});

app.get('/healthz', async () => ({ ok: true }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

async function start() {
  try {
    await runMigrations(app.log);
    const addr = await app.listen({ port, host });
    app.log.info(`listening on ${addr}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
