import type { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-zinc-900">
              Media Scraper
            </h1>
            <p className="text-xs text-zinc-500">
              Submit URLs, browse extracted images and videos.
            </p>
          </div>
          <a
            href="https://github.com"
            className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
            target="_blank"
            rel="noopener noreferrer"
          >
            docs
          </a>
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">{children}</main>
    </div>
  );
}
