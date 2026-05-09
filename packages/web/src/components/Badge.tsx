import type { ReactNode } from 'react';

type Tone = 'image' | 'video' | 'neutral';

const tones: Record<Tone, string> = {
  image: 'bg-blue-50 text-blue-700 ring-blue-200',
  video: 'bg-violet-50 text-violet-700 ring-violet-200',
  neutral: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
