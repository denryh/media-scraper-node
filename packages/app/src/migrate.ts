import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = resolve(__dirname, '../../../db/migrations');
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? DEFAULT_DIR;

export async function runMigrations(log: { info: (msg: string) => void }): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      create table if not exists migrations (
        name        text primary key,
        applied_at  timestamptz not null default now()
      )
    `);
    const { rows: alreadyApplied } = await client.query<{ name: string }>(
      'select name from migrations',
    );
    const applied = new Set(alreadyApplied.map((r) => r.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      log.info(`applying migration ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into migrations(name) values ($1)', [file]);
        await client.query('commit');
        count++;
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
    log.info(`migrations applied (${count} new, ${applied.size} previously applied)`);
  } finally {
    client.release();
  }
}
