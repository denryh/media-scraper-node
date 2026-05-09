export type MediaType = 'all' | 'image' | 'video';

const TYPES: { value: MediaType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
];

export function Filters(props: {
  type: MediaType;
  onType: (t: MediaType) => void;
  searchInput: string;
  onSearchInput: (s: string) => void;
}) {
  return (
    <section className="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Filter by media type"
        className="inline-flex rounded-lg border border-zinc-200 bg-white p-0.5 shadow-sm"
      >
        {TYPES.map((t) => {
          const active = t.value === props.type;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => props.onType(t.value)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="relative flex-1 min-w-56">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={props.searchInput}
          onChange={(e) => props.onSearchInput(e.target.value)}
          placeholder="Search URL or alt text…"
          className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-9 pr-3 text-sm text-zinc-800 placeholder:text-zinc-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
      </div>
    </section>
  );
}
