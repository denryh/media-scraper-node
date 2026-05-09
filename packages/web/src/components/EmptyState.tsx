export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div
        aria-hidden
        className="mb-5 flex size-8 items-center justify-center border border-stone-300 text-stone-400"
      >
        <span className="block size-1.5 rounded-full bg-stone-300" />
      </div>
      <p className="text-sm font-medium text-stone-900">{title}</p>
      {hint && <p className="mt-1.5 max-w-xs text-xs text-stone-500">{hint}</p>}
    </div>
  );
}
