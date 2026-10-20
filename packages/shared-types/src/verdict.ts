import { z } from "zod";

/**
 * Verdict for a scanned coin.
 * PASS       all hard filters passed and a score exists.
 * BLOCKED    at least one hard filter failed. Visible, never tradable.
 * UNVERIFIED a data source was missing or down. Fail closed: not tradable.
 */
export const VERDICTS = ["PASS", "BLOCKED", "UNVERIFIED"] as const;
export const verdictSchema = z.enum(VERDICTS);
export type Verdict = z.infer<typeof verdictSchema>;

export const POSITION_MODES = ["paper", "live"] as const;
export const positionModeSchema = z.enum(POSITION_MODES);
export type PositionMode = z.infer<typeof positionModeSchema>;

export const REGIMES = ["HOT", "NEUTRAL", "COLD"] as const;
export const regimeSchema = z.enum(REGIMES);
export type Regime = z.infer<typeof regimeSchema>;

export const LIMIT_EVENT_TYPES = ["daily_loss", "cooldown", "size_cap"] as const;
export const limitEventTypeSchema = z.enum(LIMIT_EVENT_TYPES);
export type LimitEventType = z.infer<typeof limitEventTypeSchema>;

export const MISTAKE_TAGS = [
  "oversized",
  "ignored_red_flag",
  "emotional_entry",
  "no_exit_plan",
  "other",
] as const;
export const mistakeTagSchema = z.enum(MISTAKE_TAGS);
export type MistakeTag = z.infer<typeof mistakeTagSchema>;
