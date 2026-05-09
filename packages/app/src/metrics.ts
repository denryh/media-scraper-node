import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { FastifyPluginAsync } from 'fastify';
import { scrapeQueue } from './queue.js';

const elDelay: IntervalHistogram = monitorEventLoopDelay({ resolution: 20 });
elDelay.enable();

const ns_to_ms = (ns: number): number => Math.round((ns / 1e6) * 100) / 100;

export type MetricsSnapshot = {
  rss_mb: number;
  heap_used_mb: number;
  event_loop_delay_ms: { p50: number; p99: number; max: number; mean: number };
  queue: { waiting: number; active: number; delayed: number; failed: number; completed: number };
  uptime_s: number;
};

async function snapshot(): Promise<MetricsSnapshot> {
  const m = process.memoryUsage();
  const c = await scrapeQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  return {
    rss_mb: Math.round((m.rss / 1024 / 1024) * 10) / 10,
    heap_used_mb: Math.round((m.heapUsed / 1024 / 1024) * 10) / 10,
    event_loop_delay_ms: {
      p50: ns_to_ms(elDelay.percentile(50)),
      p99: ns_to_ms(elDelay.percentile(99)),
      max: ns_to_ms(elDelay.max),
      mean: ns_to_ms(elDelay.mean),
    },
    queue: {
      waiting: c.waiting ?? 0,
      active: c.active ?? 0,
      delayed: c.delayed ?? 0,
      failed: c.failed ?? 0,
      completed: c.completed ?? 0,
    },
    uptime_s: Math.round(process.uptime() * 10) / 10,
  };
}

/** Reset the histogram so a fresh test window starts clean. */
export function resetMetrics(): void {
  elDelay.reset();
}

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics', async () => snapshot());
  app.post('/metrics/reset', async () => {
    resetMetrics();
    return { ok: true };
  });
};
