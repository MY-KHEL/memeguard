import pino from "pino";

/** Server-only structured logger for route handlers and server actions. */
export const logger = pino({
  name: "web",
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: ["*.apiKey", "*.API_KEY", "headers.authorization", "headers.cookie"], censor: "[redacted]" },
});
