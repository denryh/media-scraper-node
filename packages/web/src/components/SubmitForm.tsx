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
      // Give the worker a moment to drain, then refetch.
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

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-baseline justify-between">
        <label htmlFor="urls" className="text-sm font-medium text-zinc-800">
          URLs to scrape
        </label>
        <span className="text-xs text-zinc-500">one per line · max 100</span>
      </div>
      <textarea
        id="urls"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'https://example.com/page\nhttps://example.com/another'}
        className="w-full resize-y rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={m.isPending || text.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {m.isPending && (
            <span className="size-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          )}
          {m.isPending ? 'Submitting…' : 'Scrape'}
        </button>
        {feedback && (
          <span
            className={`text-xs ${
              feedback.kind === 'ok' ? 'text-emerald-700' : 'text-rose-700'
            }`}
          >
            {feedback.msg}
          </span>
        )}
      </div>
    </section>
  );
}
