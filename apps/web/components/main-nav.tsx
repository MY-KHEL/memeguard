"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LiveStatus } from "@/lib/live";
import { cn } from "@/lib/utils";

export const NAV_ITEMS = [
  { href: "/explore", label: "Explore" },
  { href: "/trade", label: "Trade" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/journal", label: "Journal" },
  { href: "/settings", label: "Settings" },
  { href: "/calibration", label: "Calibration" },
] as const;

function NavLinks({ onNavigate, stacked }: { onNavigate?: () => void; stacked?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn("flex items-center gap-1 text-sm", stacked && "flex-col items-stretch gap-1")}>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className={cn(
              stacked
                ? cn(
                    "rounded-xl px-3 py-3 text-base tracking-tight transition-colors",
                    active ? "bg-accent text-accent-foreground" : "text-foreground/80 hover:bg-muted",
                  )
                : cn(buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" })),
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function DesktopNav() {
  return (
    <div className="hidden lg:block">
      <NavLinks />
    </div>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open menu" onClick={() => setOpen(true)}>
        <MenuIcon />
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" className="w-[min(100%,20rem)] p-0">
        <SheetHeader className="border-b border-border px-4 py-4">
          <SheetTitle className="text-base tracking-tight">Meme Guard</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-6 p-4">
          <NavLinks stacked onNavigate={() => setOpen(false)} />
          <LiveStatus />
        </div>
      </SheetContent>
    </Sheet>
    </>
  );
}

export function MainNav() {
  return <DesktopNav />;
}
