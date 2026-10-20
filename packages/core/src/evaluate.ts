import type { Verdict } from "@meme-guard/shared-types";
import type { RiskConfig } from "./config";
import { hardFilterVerdict, runHardFilters } from "./filters";
import { combineScore, scoreBand, scoreFactors } from "./scoring";
import type { RiskEvaluation, RiskInputs } from "./types";

export function collectUnavailableSources(inputs: RiskInputs): string[] {
  const sources = new Set<string>();
  for (const field of Object.values(inputs)) {
    if (field && typeof field === "object" && "status" in field && field.status === "unavailable") {
      sources.add(field.source);
    }
  }
  return [...sources].sort();
}

/**
 * Full risk evaluation (docs/SPEC.md 6.3). Scoring only runs when every
 * hard filter passed. Missing data is UNVERIFIED and never a pass.
 */
export function evaluateRisk(inputs: RiskInputs, config: RiskConfig, now = new Date()): RiskEvaluation {
  const reasons = runHardFilters(inputs, config);
  const hard = hardFilterVerdict(reasons);
  const unavailableSources = collectUnavailableSources(inputs);
  const dataFreshness = now.toISOString();
  const configVersion = config.config_version;

  if (hard === "BLOCKED") {
    return {
      verdict: "BLOCKED",
      score: null,
      band: null,
      reasons,
      factors: [],
      unavailableSources,
      dataFreshness,
      configVersion,
    };
  }
  if (hard === "UNVERIFIED") {
    return {
      verdict: "UNVERIFIED",
      score: null,
      band: null,
      reasons,
      factors: [],
      unavailableSources,
      dataFreshness,
      configVersion,
    };
  }

  const factors = scoreFactors(inputs, config);
  const combined = combineScore(factors);
  if (combined.unverified || combined.score === null) {
    return {
      verdict: "UNVERIFIED",
      score: null,
      band: null,
      reasons,
      factors,
      unavailableSources,
      dataFreshness,
      configVersion,
    };
  }

  const verdict: Verdict = "PASS";
  return {
    verdict,
    score: combined.score,
    band: scoreBand(combined.score, config),
    reasons,
    factors,
    unavailableSources,
    dataFreshness,
    configVersion,
  };
}
