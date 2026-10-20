"use client";

import { useEffect, useState } from "react";
import type { NotificationDto } from "@meme-guard/shared-types";
import { api } from "@/lib/api-client";
import { useLive } from "@/lib/live";
import { useSession } from "@/components/wallet/session-provider";
import { BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NotificationBell() {
  const { me } = useSession();
  const { notifRev } = useLive();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[]>([]);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!me) {
      setItems([]);
      setUnread(0);
      return;
    }
    void api
      .notifications()
      .then((res) => {
        setItems(res.items);
        setUnread(res.unread);
      })
      .catch(() => undefined);
  }, [me, notifRev]);

  if (!me) return null;

  return (
    <div className="relative">
      <Button type="button" variant="ghost" size="icon-sm" onClick={() => setOpen((v) => !v)} className="relative" aria-label="Notifications">
        <BellIcon />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-destructive px-1 text-[10px] text-white">{unread > 9 ? "9+" : unread}</span>
        ) : null}
      </Button>
      {open ? (
        <Card className="absolute right-0 z-50 mt-2 w-[min(20rem,calc(100vw-2rem))] shadow-lg">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-xs">Notifications</CardTitle>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => void api.markAllNotificationsRead().then(() => setUnread(0))}
            >
              Mark all read
            </Button>
          </CardHeader>
          <CardContent>
          {items.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No alerts yet.</p>
          ) : (
            <ul className="max-h-80 overflow-auto">
              {items.map((n) => (
                <li key={n.id} className={`border-t border-black/5 px-2 py-2 text-xs dark:border-white/5 ${n.urgent ? "text-red-700 dark:text-red-300" : ""}`}>
                  <button
                    type="button"
                    className="w-full text-left"
                    onClick={() => void api.markNotificationRead(n.id).then(() => setUnread((u) => Math.max(0, u - (n.readAt ? 0 : 1))))}
                  >
                    <p className="font-medium">{n.title}</p>
                    <p className="text-muted-foreground">{n.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
