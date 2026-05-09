import type { MediaSource } from '../api';
import { hostFromUrl, relativeTime } from '../lib/formatters';

export function SourceList({ items }: { items: MediaSource[] }) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-zinc-500">No sources recorded yet.</p>;
  }
  return (
    <ul className="divide-y divide-zinc-100">
      {items.map((s) => (
        <li key={s.id} className="px-4 py-3">
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-medium text-blue-700 hover:underline"
          >
            {hostFromUrl(s.sourceUrl)}
          </a>
          <p className="mt-0.5 truncate text-xs text-zinc-500" title={s.sourceUrl}>
            {s.sourceUrl}
          </p>
          {s.altText && (
            <p className="mt-1 line-clamp-2 text-xs italic text-zinc-600">“{s.altText}”</p>
          )}
          <p className="mt-1 text-[11px] text-zinc-400">observed {relativeTime(s.observedAt)}</p>
        </li>
      ))}
    </ul>
  );
}
