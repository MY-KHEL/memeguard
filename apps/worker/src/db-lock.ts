let tail: Promise<void> = Promise.resolve();

/** One token-table writer at a time so a scan upsert and a live quote cannot lock each other out. */
export function withDbWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = tail.then(fn, fn);
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
