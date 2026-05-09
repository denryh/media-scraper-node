// In dev, Vite proxies /api/* to localhost:3000.
// In prod (the nginx image), nginx proxies /api/* to app:3000.
const API_BASE = '/api';

export type MediaItem = {
  id: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  latestSource: string | null;
};

export type MediaPage = {
  items: MediaItem[];
  nextCursor: string | null;
};

export type MediaSource = {
  id: string;
  sourceUrl: string;
  altText: string | null;
  observedAt: string;
  jobUrl: string;
};

export async function fetchMedia(params: {
  type?: 'image' | 'video';
  q?: string;
  cursor?: string;
  limit?: number;
}): Promise<MediaPage> {
  const qs = new URLSearchParams();
  if (params.type) qs.set('type', params.type);
  if (params.q) qs.set('q', params.q);
  if (params.cursor) qs.set('cursor', params.cursor);
  qs.set('limit', String(params.limit ?? 50));
  const r = await fetch(`${API_BASE}/media?${qs.toString()}`);
  if (!r.ok) throw new Error(`fetchMedia ${r.status}`);
  return r.json();
}

export async function fetchSources(assetId: string): Promise<{ items: MediaSource[] }> {
  const r = await fetch(`${API_BASE}/media/${encodeURIComponent(assetId)}/sources`);
  if (!r.ok) throw new Error(`fetchSources ${r.status}`);
  return r.json();
}

export type ScrapeResponseJob = { id: string; url: string; reused: boolean };

export async function postScrape(urls: string[]): Promise<{ jobs: ScrapeResponseJob[] }> {
  const r = await fetch(`${API_BASE}/scrape`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body?.error ?? body?.message ?? `scrape ${r.status}`);
  }
  return body;
}
