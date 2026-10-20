"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { SessionUser } from "@meme-guard/shared-types";
import { api } from "@/lib/api-client";

interface SessionCtx {
  me: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<SessionCtx>({ me: null, loading: true, refresh: async () => undefined, logout: async () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.me();
      setMe(next);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ me, loading, refresh, logout }}>{children}</Ctx.Provider>;
}

export function useSession() {
  return useContext(Ctx);
}
