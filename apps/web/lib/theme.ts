export const THEME_KEY = "mg_theme";
export type ThemeMode = "light" | "dark" | "system";

export const THEME_MODES: ThemeMode[] = ["light", "dark", "system"];

export function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return isThemeMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function themeIsDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle("dark", themeIsDark(mode));
}

export function persistTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* private mode */
  }
  applyTheme(mode);
}

/** Inline boot script: apply stored theme before first paint. */
export const THEME_BOOT_SCRIPT = `try{var m=localStorage.getItem('${THEME_KEY}');var d=m==='dark'||((m==='system'||!m)&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(m==='light')d=false;document.documentElement.classList.toggle('dark',d)}catch(e){}`;
