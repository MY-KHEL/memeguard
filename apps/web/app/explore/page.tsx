import { Suspense } from "react";
import { ExploreTable } from "@/components/explore/explore-table";

export const metadata = { title: "Explore · Meme Guard" };

export default function ExplorePage() {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <ExploreTable />
    </Suspense>
  );
}
