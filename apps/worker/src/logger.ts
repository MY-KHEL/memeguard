import pino from "pino";

export function createLogger(level: string, pretty: boolean) {
  return pino({
    name: "worker",
    level,
    base: { service: "worker" },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Never log secrets. Provider keys and connection strings are redacted by path.
    redact: {
      paths: ["env.DATABASE_URL", "env.REDIS_URL", "*.apiKey", "*.API_KEY", "headers.authorization"],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
