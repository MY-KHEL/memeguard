interface PhasePlaceholderProps {
  title: string;
  phase: number;
  description: string;
}

export function PhasePlaceholder({ title, phase, description }: PhasePlaceholderProps) {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{description}</p>
      <p className="inline-flex w-fit items-center rounded-full border border-black/10 px-3 py-1 text-xs text-zinc-600 dark:border-white/15 dark:text-zinc-400">
        Arrives in Phase {phase}
      </p>
    </section>
  );
}
