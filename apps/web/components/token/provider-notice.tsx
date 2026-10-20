/** Names a missing data source plainly. Missing data is never shown as zero or hidden. */
export function ProviderNotice({ title, detail, onRetry }: { title: string; detail: string; onRetry?: () => void }) {
  return (
    <div
      role="status"
      className="rounded-md border border-amber-400/40 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-xs opacity-90">{detail}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-2 text-xs underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </div>
  );
}
