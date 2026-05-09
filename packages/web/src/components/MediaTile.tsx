import type { MediaItem } from '../api';
import { hostFromUrl } from '../lib/formatters';
import { Badge } from './Badge';

export function MediaTile({ item, onSelect }: { item: MediaItem; onSelect: (id: string) => void }) {
  const host = hostFromUrl(item.latestSource);
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500/40"
    >
      <div className="relative aspect-4/3 w-full overflow-hidden bg-zinc-100">
        {item.mediaType === 'image' ? (
          <img
            src={item.mediaUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="size-full object-cover transition group-hover:scale-[1.02] data-[broken=true]:opacity-20"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).dataset.broken = 'true';
            }}
          />
        ) : (
          <video
            src={item.mediaUrl}
            preload="none"
            muted
            playsInline
            className="size-full object-cover"
          />
        )}
        <div className="absolute left-2 top-2">
          <Badge tone={item.mediaType === 'image' ? 'image' : 'video'}>{item.mediaType}</Badge>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span
          className="truncate text-xs text-zinc-600"
          title={item.latestSource ?? ''}
        >
          {host || 'no source'}
        </span>
        <span
          className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-600"
          title={`Found on ${item.occurrenceCount} page${item.occurrenceCount === 1 ? '' : 's'}`}
        >
          ×{item.occurrenceCount}
        </span>
      </div>
    </button>
  );
}
