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
        if (e.target === ref.current) onClose();
      }}
      className="w-full max-w-3xl rounded-xl border border-stone-200 bg-stone-50 p-0 shadow-2xl"
    >
      {item && (
        <div className="flex max-h-[88vh] flex-col">
          <div className="relative flex items-start gap-5 border-b border-stone-200 bg-white px-6 py-5">
            <div className="size-24 shrink-0 overflow-hidden rounded-md bg-stone-100">
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
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-center gap-2">
                <Badge tone={item.mediaType === 'image' ? 'image' : 'video'}>
                  {item.mediaType}
                </Badge>
                <span className="font-mono text-[11px] tabular-nums text-stone-500">
                  ×{item.occurrenceCount} occurrence{item.occurrenceCount === 1 ? '' : 's'}
                </span>
              </div>
              <a
                href={item.mediaUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 block truncate text-base font-medium text-stone-900 hover:underline"
                title={item.mediaUrl}
              >
                {hostFromUrl(item.mediaUrl) || item.mediaUrl}
              </a>
              <p
                className="mt-0.5 truncate font-mono text-[11px] text-stone-400"
                title={item.mediaUrl}
              >
                {item.mediaUrl}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-4 rounded-md p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-900"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
            </button>
          </div>

          <div className="flex items-center justify-between border-b border-stone-200 bg-stone-50 px-6 py-2.5">
            <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
              Sources
            </h3>
            {sources.data && (
              <span className="font-mono text-[11px] tabular-nums text-stone-400">
                {sources.data.items.length}
                {sources.data.items.length === 100 ? '+' : ''}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto bg-white">
            {sources.isLoading && (
              <div className="flex justify-center py-10">
                <span className="size-4 animate-spin rounded-full border-2 border-stone-200 border-t-stone-900" />
              </div>
            )}
            {sources.isError && (
              <p className="px-6 py-8 text-center font-mono text-xs text-rose-600">
                {(sources.error as Error).message}
              </p>
            )}
            {sources.data && <SourceList items={sources.data.items} />}
          </div>
        </div>
      )}
    </dialog>
  );
}
