"use client";

import Link from "next/link";

export default function TokenDetailError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Could not load this coin</h1>
      <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
        The database or a data provider did not answer. Nothing here is assumed safe while data is missing.
      </p>
      {error.digest ? <p className="font-mono text-xs text-zinc-500">ref {error.digest}</p> : null}
      <div className="flex gap-3 text-sm">
        <button type="button" onClick={reset} className="rounded-md border border-black/10 px-3 py-1.5 hover:bg-black/5 dark:border-white/15 dark:hover:bg-white/10">
          Try again
        </button>
        <Link href="/explore" className="rounded-md px-3 py-1.5 underline underline-offset-2">
          Back to Explore
        </Link>
      </div>
    </section>
  );
}
