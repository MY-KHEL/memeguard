"use client";

export default function ExploreError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Explore is unavailable</h1>
      <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">Something failed while rendering the list. The scanner keeps running in the worker.</p>
      {error.digest ? <p className="font-mono text-xs text-zinc-500">ref {error.digest}</p> : null}
      <button
        type="button"
        onClick={reset}
        className="w-fit rounded-md border border-black/10 px-3 py-1.5 text-sm hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10"
      >
        Try again
      </button>
    </section>
  );
}
