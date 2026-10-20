"use client";

import { useEffect, useState } from "react";
import { MISTAKE_TAGS, type JournalEntryDto } from "@meme-guard/shared-types";
import { api, ApiError } from "@/lib/api-client";
import { useSession } from "@/components/wallet/session-provider";
import { Card, CardContent } from "@/components/ui/card";

export function JournalClient() {
  const { me } = useSession();
  const [items, setItems] = useState<JournalEntryDto[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    void api
      .journal()
      .then((r) => setItems(r.items as JournalEntryDto[]))
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load journal"));
  }, [me]);

  if (!me) return <p className="text-sm text-muted-foreground">Sign in to see your journal.</p>;
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No closed paper trades yet.</p>;

  return (
    <ul className="flex flex-col gap-3">
      {items.map((e) => (
        <li key={e.id}>
        <Card size="sm">
          <CardContent className="text-sm">
          <p className="font-medium">{e.symbol ?? e.mint ?? "Position"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Thesis: {e.thesis}</p>
          <p className="mt-1 text-xs">{e.outcomeNotes}</p>
          <label className="mt-2 block text-xs text-muted-foreground">
            Mistake tag
            <select
              value={e.mistakeTag ?? ""}
              onChange={(ev) => {
                const tag = ev.target.value;
                if (!tag) return;
                void api.patchJournal(e.id, tag).then(() => api.journal().then((r) => setItems(r.items as JournalEntryDto[])));
              }}
              className="ml-2 rounded-md border border-input bg-transparent px-2 py-1"
            >
              <option value="">Set tag…</option>
              {MISTAKE_TAGS.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          </CardContent>
        </Card>
        </li>
      ))}
    </ul>
  );
}
