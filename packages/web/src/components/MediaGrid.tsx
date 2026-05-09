import { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchMedia, type MediaItem } from '../api';
import { MediaTile } from './MediaTile';
import { MediaModal } from './MediaModal';
import { EmptyState } from './EmptyState';

export function MediaGrid({ type, q }: { type?: 'image' | 'video'; q: string }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['media', type ?? 'all', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      fetchMedia({ type, q: q || undefined, cursor: pageParam, limit: 50 }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const items = useMemo<MediaItem[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const selected = useMemo(
    () => items.find((m) => m.id === selectedId) ?? null,
    [items, selectedId],
  );

  if (query.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <span className="size-5 animate-spin rounded-full border-2 border-stone-200 border-t-stone-900" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 font-mono text-xs text-rose-700">
        {(query.error as Error).message}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={q ? 'No results' : 'Nothing scraped yet'}
        hint={q ? 'Try a different query.' : 'Submit some URLs above to get started.'}
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((m) => (
          <MediaTile key={m.id} item={m} onSelect={setSelectedId} />
        ))}
      </div>
      {query.hasNextPage && (
        <div className="flex justify-center pt-6">
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="group inline-flex items-center gap-2 border-b border-stone-300 pb-1 font-mono text-[11px] uppercase tracking-[0.2em] text-stone-600 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:text-stone-300"
          >
            {query.isFetchingNextPage ? 'Loading' : 'Load more'}
            <span aria-hidden className="transition group-enabled:group-hover:translate-y-0.5">
              ↓
            </span>
          </button>
        </div>
      )}
      <MediaModal item={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
