export type LogLevel = "info" | "warn" | "error";

export type Logger = (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;

const SENSITIVE_KEY = /password|secret|token|csrf|cookie|csv|raw|supplier|invoice|amount|email|authorization|comment/i;

export function sanitizeLogFields(fields: Record<string, unknown>): Record<string, string | number | boolean | null> {
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_KEY.test(key)) continue;
    if (value === null) safe[key] = null;
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") safe[key] = value;
  }
  return safe;
}

export function createLogger(): Logger {
  return (level, event, fields) => {
    const payload = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(fields ? sanitizeLogFields(fields) : {}),
    };
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  };
}
