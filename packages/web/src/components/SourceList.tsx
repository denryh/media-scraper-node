import type { MediaSource } from '../api';
import { hostFromUrl, relativeTime } from '../lib/formatters';

export function SourceList({ items }: { items: MediaSource[] }) {
  if (items.length === 0) {
    return (
      <p className="px-6 py-10 text-center font-mono text-xs text-stone-500">
        No sources recorded yet.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-stone-100">
      {items.map((s) => (
        <li key={s.id} className="px-6 py-3.5 transition hover:bg-stone-50">
          <a
            href={s.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-sm font-medium text-stone-900 hover:underline"
          >
            {hostFromUrl(s.sourceUrl)}
          </a>
          <p
            className="mt-0.5 truncate font-mono text-[11px] text-stone-400"
            title={s.sourceUrl}
          >
            {s.sourceUrl}
          </p>
          {s.altText && (
            <p className="mt-1.5 line-clamp-2 text-xs italic text-stone-600">
              "{s.altText}"
            </p>
          )}
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-stone-400">
            {relativeTime(s.observedAt)}
          </p>
        </li>
      ))}
    </ul>
  );
}
