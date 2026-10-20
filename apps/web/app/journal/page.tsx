import { JournalClient } from "@/components/journal/journal-client";

export const dynamic = "force-dynamic";
export const metadata = { title: "Journal · Meme Guard" };

export default function JournalPage() {
  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Journal</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One entry per closed paper position with your thesis, the result, and a mistake tag.
        </p>
      </header>
      <JournalClient />
    </section>
  );
}
