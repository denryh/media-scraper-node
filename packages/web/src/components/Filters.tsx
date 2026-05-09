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
    <section className="flex flex-wrap items-end justify-between gap-6 border-b border-stone-200">
      <nav role="tablist" aria-label="Filter by media type" className="flex gap-7">
        {TYPES.map((t) => {
          const active = t.value === props.type;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => props.onType(t.value)}
              className={`relative -mb-px pb-3 text-sm transition focus:outline-none ${
                active
                  ? 'font-medium text-stone-900'
                  : 'text-stone-400 hover:text-stone-700'
              }`}
            >
              {t.label}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-0 -bottom-px h-px bg-stone-900"
                />
              )}
            </button>
          );
        })}
      </nav>

      <div className="relative w-full max-w-xs flex-1">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 size-3.5 -translate-y-1/2 text-stone-400"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={props.searchInput}
          onChange={(e) => props.onSearchInput(e.target.value)}
          placeholder="Search URL or alt text"
          className="block w-full border-0 border-b border-stone-200 bg-transparent py-2.5 pl-6 pr-1 text-sm text-stone-900 placeholder:text-stone-400 transition focus:border-stone-900 focus:outline-none"
        />
      </div>
    </section>
  );
}
