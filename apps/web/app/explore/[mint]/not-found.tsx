import Link from "next/link";

export default function TokenNotFound() {
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Coin not tracked</h1>
      <p className="max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
        This address is not a valid Solana mint, or the scanner has not seen it yet. New coins appear within about 30 seconds of being
        listed. If you pasted a contract address, search for it on Explore to confirm.
      </p>
      <Link href="/explore" className="w-fit text-sm underline underline-offset-2">
        Back to Explore
      </Link>
    </section>
  );
}
