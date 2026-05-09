import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchSources, type MediaItem } from '../api';
import { Badge } from './Badge';
import { SourceList } from './SourceList';
import { hostFromUrl } from '../lib/formatters';

export function MediaModal({
  item,
  onClose,
}: {
  item: MediaItem | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  // Open / close the native <dialog> in sync with `item`.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (item && !d.open) d.showModal();
    if (!item && d.open) d.close();
  }, [item]);

  const sources = useQuery({
    queryKey: ['sources', item?.id],
    queryFn: () => fetchSources(item!.id),
    enabled: !!item,
  });

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        // Click on backdrop (target === dialog itself) closes.
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-0 shadow-2xl backdrop:bg-zinc-900/50"
    >
      {item && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-start gap-4 border-b border-zinc-100 p-4">
            <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-zinc-100">
              {item.mediaType === 'image' ? (
                <img
                  src={item.mediaUrl}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-full object-cover"
                />
              ) : (
                <video src={item.mediaUrl} muted playsInline className="size-full object-cover" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge tone={item.mediaType === 'image' ? 'image' : 'video'}>
                  {item.mediaType}
                </Badge>
                <span className="text-xs text-zinc-500">
                  {item.occurrenceCount} occurrence{item.occurrenceCount === 1 ? '' : 's'}
                </span>
              </div>
              <a
                href={item.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block truncate text-sm font-medium text-zinc-800 hover:underline"
                title={item.mediaUrl}
              >
                {hostFromUrl(item.mediaUrl)}
              </a>
              <p className="truncate text-xs text-zinc-400" title={item.mediaUrl}>
                {item.mediaUrl}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Sources
            </h3>
            {sources.data && (
              <span className="text-[11px] text-zinc-400">
                {sources.data.items.length}
                {sources.data.items.length === 100 ? '+' : ''}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {sources.isLoading && (
              <div className="flex justify-center py-8">
                <span className="size-5 animate-spin rounded-full border-2 border-zinc-200 border-t-blue-500" />
              </div>
            )}
            {sources.isError && (
              <p className="px-4 py-6 text-center text-sm text-rose-600">
                Failed to load sources: {(sources.error as Error).message}
              </p>
            )}
            {sources.data && <SourceList items={sources.data.items} />}
          </div>
        </div>
      )}
    </dialog>
  );
}
