import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { postScrape } from '../api';

export function SubmitForm() {
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);
  const qc = useQueryClient();

  const m = useMutation({
    mutationFn: (urls: string[]) => postScrape(urls),
    onSuccess: (data) => {
      const reused = data.jobs.filter((j) => j.reused).length;
      const fresh = data.jobs.length - reused;
      setFeedback({
        kind: 'ok',
        msg: `Submitted ${data.jobs.length} job${data.jobs.length === 1 ? '' : 's'} · ${fresh} new · ${reused} reused`,
      });
      setText('');
      window.setTimeout(() => qc.invalidateQueries({ queryKey: ['media'] }), 600);
    },
    onError: (err: Error) => setFeedback({ kind: 'err', msg: err.message }),
  });

  const submit = () => {
    const urls = text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (urls.length === 0) return;
    m.mutate(urls);
  };

  const lineCount = text.split(/\r?\n/).filter((s) => s.trim().length > 0).length;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-stone-500">
          Submit
        </h2>
        <span className="font-mono text-[11px] text-stone-400">
          one per line · max 100
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white transition focus-within:border-stone-900">
        <textarea
          id="urls"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://example.com/page&#10;https://example.com/another"
          className="block w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-stone-900 placeholder:text-stone-400 focus:outline-none"
        />
        <div className="flex items-center justify-between border-t border-stone-100 bg-stone-50/60 px-3 py-2">
          <span className="font-mono text-[11px] tabular-nums text-stone-500">
            {lineCount} URL{lineCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={m.isPending || lineCount === 0}
            className="group inline-flex items-center gap-1.5 rounded-md bg-stone-900 px-3 py-1.5 text-xs font-medium text-stone-50 transition hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-stone-900/20 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-400"
          >
            {m.isPending && (
              <span className="size-3 animate-spin rounded-full border border-stone-50/40 border-t-stone-50" />
            )}
            <span>{m.isPending ? 'Submitting' : 'Scrape'}</span>
            <span aria-hidden className="transition group-enabled:group-hover:translate-x-0.5">
              →
            </span>
          </button>
        </div>
      </div>

      {feedback && (
        <p
          className={`mt-3 font-mono text-[11px] ${
            feedback.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
          }`}
        >
          {feedback.msg}
        </p>
      )}
    </section>
  );
}
