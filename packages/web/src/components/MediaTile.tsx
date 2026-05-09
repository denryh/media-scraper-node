import { useRef } from 'react';
import type { MediaItem } from '../api';
import { hostFromUrl } from '../lib/formatters';

export function MediaTile({
  item,
  onSelect,
}: {
  item: MediaItem;
  onSelect: (id: string) => void;
}) {
  const host = hostFromUrl(item.latestSource);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleEnter = () => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  };
  const handleLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    try {
      v.currentTime = 0;
    } catch {}
  };

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      onMouseEnter={item.mediaType === 'video' ? handleEnter : undefined}
      onMouseLeave={item.mediaType === 'video' ? handleLeave : undefined}
      onFocus={item.mediaType === 'video' ? handleEnter : undefined}
      onBlur={item.mediaType === 'video' ? handleLeave : undefined}
      className="group relative aspect-square overflow-hidden bg-stone-100 transition focus:outline-none focus:ring-2 focus:ring-stone-900 focus:ring-offset-2 focus:ring-offset-stone-50"
    >
      {item.mediaType === 'image' ? (
        <img
          src={item.mediaUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover transition duration-500 group-hover:scale-[1.04] data-[broken=true]:opacity-20"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).dataset.broken = 'true';
          }}
        />
      ) : (
        <video
          ref={videoRef}
          src={`${item.mediaUrl}#t=0.1`}
          preload="metadata"
          muted
          loop
          playsInline
          className="size-full object-cover transition duration-500 group-hover:scale-[1.04] data-[broken=true]:opacity-20"
          onError={(e) => {
            (e.currentTarget as HTMLVideoElement).dataset.broken = 'true';
          }}
        />
      )}

      {item.mediaType === 'video' && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-stone-900/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-white backdrop-blur-sm transition group-hover:opacity-0"
        >
          <svg viewBox="0 0 12 12" className="size-2 fill-current" aria-hidden>
            <path d="M3 2v8l7-4z" />
          </svg>
          video
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-stone-950/85 via-stone-950/40 to-transparent px-3 pb-2.5 pt-8 opacity-0 transition duration-300 group-hover:translate-y-0 group-hover:opacity-100">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-stone-100">
            {host || 'no source'}
          </span>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-stone-300">
            ×{item.occurrenceCount}
          </span>
        </div>
      </div>
    </button>
  );
}
