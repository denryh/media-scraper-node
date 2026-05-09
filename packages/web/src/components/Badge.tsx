import type { ReactNode } from 'react';

type Tone = 'image' | 'video' | 'neutral';

const tones: Record<Tone, string> = {
  image: 'bg-stone-900 text-stone-50',
  video: 'bg-stone-50 text-stone-900 ring-1 ring-stone-300 ring-inset',
  neutral: 'bg-stone-100 text-stone-700 ring-1 ring-stone-200 ring-inset',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
