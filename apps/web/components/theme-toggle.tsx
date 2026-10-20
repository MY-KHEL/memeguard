"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { persistTheme, readStoredTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: typeof SunIcon }> = [
  { mode: "light", label: "Light", icon: SunIcon },
  { mode: "dark", label: "Dark", icon: MoonIcon },
  { mode: "system", label: "System", icon: MonitorIcon },
];

export function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode | null>(null);

  useEffect(() => {
    const stored = readStoredTheme();
    setMode(stored);
    persistTheme(stored);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readStoredTheme() === "system") persistTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  if (mode === null) {
    return <div className="inline-flex h-8 w-[5.375rem] rounded-full border border-border/80 bg-muted/50 p-0.5" aria-hidden />;
  }

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="inline-flex h-8 rounded-full border border-border/80 bg-muted/50 p-0.5"
    >
      {OPTIONS.map(({ mode: next, label, icon: Icon }) => {
        const selected = mode === next;
        return (
          <button
            key={next}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => {
              setMode(next);
              persistTheme(next);
            }}
            className={cn(
              "flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors",
              selected && "bg-background text-foreground shadow-sm",
            )}
          >
            <Icon className="size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
