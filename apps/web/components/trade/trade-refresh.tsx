"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLive } from "@/lib/live";

/** Reload the PASS list when any verdict is saved, including a new PASS the page was not watching. */
export function TradeRefresh() {
  const { verdictRev } = useLive();
  const router = useRouter();
  const seen = useRef(verdictRev);

  useEffect(() => {
    if (verdictRev === seen.current) return;
    seen.current = verdictRev;
    const timer = setTimeout(() => router.refresh(), 400);
    return () => clearTimeout(timer);
  }, [verdictRev, router]);

  return null;
}
