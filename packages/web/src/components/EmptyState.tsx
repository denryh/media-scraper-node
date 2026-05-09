export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-white/60 px-6 py-16 text-center">
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 6h16v12H4z" strokeLinejoin="round" />
          <circle cx="9" cy="11" r="1.5" />
          <path d="m4 16 5-5 4 4 3-3 4 4" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
