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
      <div className="flex justify-center py-16">
        <span className="size-6 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
      </div>
    );
  }
  if (query.isError) {
    return (
      <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        Error: {(query.error as Error).message}
      </p>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title={q ? 'No results match your search' : 'No media yet'}
        hint={q ? 'Try a different query.' : 'Submit some URLs above to start scraping.'}
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((m) => (
          <MediaTile key={m.id} item={m} onSelect={setSelectedId} />
        ))}
      </div>
      {query.hasNextPage && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
            className="rounded-lg border border-zinc-200 bg-white px-4 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
          >
            {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
      <MediaModal item={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
