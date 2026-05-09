import { useEffect, useMemo, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { fetchMedia, postScrape, type MediaItem } from './api';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Page />
    </QueryClientProvider>
  );
}

function Page() {
  const [type, setType] = useState<'all' | 'image' | 'video'>('all');
  const [searchInput, setSearchInput] = useState('');
  const [q, setQ] = useState('');

  // 300 ms debounce on the search box.
  useEffect(() => {
    const h = window.setTimeout(() => setQ(searchInput.trim()), 300);
    return () => window.clearTimeout(h);
  }, [searchInput]);

  return (
    <main style={styles.page}>
      <h1 style={{ margin: 0 }}>Media Scraper</h1>
      <SubmitBox />
      <Controls
        type={type}
        onType={setType}
        searchInput={searchInput}
        onSearchInput={setSearchInput}
      />
      <Grid type={type === 'all' ? undefined : type} q={q} />
    </main>
  );
}

function SubmitBox() {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<string>('');
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (urls: string[]) => postScrape(urls),
    onSuccess: (data) => {
      const reused = data.jobs.filter((j) => j.reused).length;
      const fresh = data.jobs.length - reused;
      setFeedback(`submitted: ${data.jobs.length} jobs (${fresh} new, ${reused} reused)`);
      setText('');
      // Give the worker a moment to drain, then refetch.
      window.setTimeout(() => qc.invalidateQueries({ queryKey: ['media'] }), 600);
    },
    onError: (err: Error) => setFeedback(`error: ${err.message}`),
  });

  const submit = () => {
    const urls = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    m.mutate(urls);
  };

  return (
    <section style={styles.card}>
      <label style={styles.label}>URLs (one per line, max 100)</label>
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="https://example.com/page&#10;https://example.com/another"
        style={styles.textarea}
      />
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button onClick={submit} disabled={m.isPending} style={styles.button}>
          {m.isPending ? 'Submitting…' : 'Scrape'}
        </button>
        {feedback && <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>{feedback}</span>}
      </div>
    </section>
  );
}

function Controls(props: {
  type: 'all' | 'image' | 'video';
  onType: (t: 'all' | 'image' | 'video') => void;
  searchInput: string;
  onSearchInput: (s: string) => void;
}) {
  return (
    <section style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
      <label style={{ fontSize: '0.9rem' }}>Type:</label>
      <select
        value={props.type}
        onChange={(e) => props.onType(e.target.value as 'all' | 'image' | 'video')}
        style={styles.select}
      >
        <option value="all">all</option>
        <option value="image">image</option>
        <option value="video">video</option>
      </select>
      <input
        type="search"
        value={props.searchInput}
        onChange={(e) => props.onSearchInput(e.target.value)}
        placeholder="search url or alt text…"
        style={styles.search}
      />
    </section>
  );
}

function Grid({ type, q }: { type?: 'image' | 'video'; q: string }) {
  const query = useInfiniteQuery({
    queryKey: ['media', type ?? 'all', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fetchMedia({ type, q: q || undefined, cursor: pageParam, limit: 50 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = useMemo<MediaItem[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isLoading) return <p>Loading…</p>;
  if (query.isError) return <p style={{ color: 'crimson' }}>Error: {(query.error as Error).message}</p>;
  if (items.length === 0) return <p style={{ opacity: 0.7 }}>No media yet. Submit some URLs above.</p>;

  return (
    <>
      <div style={styles.grid}>
        {items.map((m) => (
          <Tile key={m.id} m={m} />
        ))}
      </div>
      {query.hasNextPage && (
        <button onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} style={styles.button}>
          {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
  );
}

function Tile({ m }: { m: MediaItem }) {
  return (
    <figure style={styles.tile}>
      {m.mediaType === 'image' ? (
        <img
          src={m.mediaUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          style={styles.media}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = '0.2';
          }}
        />
      ) : (
        <video src={m.mediaUrl} controls preload="none" style={styles.media} />
      )}
      <figcaption style={styles.caption}>
        <span style={styles.badge}>{m.mediaType}</span>
        <span title={`appears on ${m.occurrenceCount} page${m.occurrenceCount === 1 ? '' : 's'}`}>
          x{m.occurrenceCount}
        </span>
      </figcaption>
    </figure>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: '1100px',
    margin: '0 auto',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  card: { display: 'flex', flexDirection: 'column', gap: '0.5rem' },
  label: { fontSize: '0.85rem', opacity: 0.8 },
  textarea: {
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.85rem',
    padding: '0.6rem',
    border: '1px solid #ccc',
    borderRadius: '6px',
    resize: 'vertical',
  },
  button: {
    padding: '0.5rem 0.9rem',
    border: '1px solid #333',
    background: '#222',
    color: '#fff',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.9rem',
  },
  select: {
    padding: '0.4rem',
    fontSize: '0.9rem',
  },
  search: {
    flex: 1,
    padding: '0.5rem 0.7rem',
    fontSize: '0.9rem',
    border: '1px solid #ccc',
    borderRadius: '6px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '0.75rem',
  },
  tile: {
    margin: 0,
    border: '1px solid #ddd',
    borderRadius: '8px',
    overflow: 'hidden',
    background: '#fafafa',
  },
  media: {
    width: '100%',
    height: '160px',
    objectFit: 'cover',
    display: 'block',
    background: '#eee',
  },
  caption: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.4rem 0.6rem',
    fontSize: '0.8rem',
    background: '#fff',
  },
  badge: {
    padding: '2px 6px',
    background: '#eef',
    borderRadius: '4px',
    fontSize: '0.7rem',
    textTransform: 'uppercase',
  },
};
