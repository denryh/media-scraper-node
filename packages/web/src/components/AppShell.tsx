import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="border-b border-stone-200/80">
        <div className="mx-auto flex max-w-5xl items-end justify-between px-6 pb-6 pt-10">
          <div>
            <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-stone-900">
              <span aria-hidden className="size-2 rounded-[2px] bg-stone-900" />
              media scraper
            </h1>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-stone-500">
              Submit URLs. Browse what's inside.
            </p>
          </div>
          <span className="hidden font-mono text-[11px] uppercase tracking-[0.2em] text-stone-400 md:block">
            v0.1
          </span>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-12 px-6 py-10">
        {children}
      </main>
    </div>
  );
}
