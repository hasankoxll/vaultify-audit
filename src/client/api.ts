export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string[];

  constructor(code: string, status: number, details: string[] = []) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let csrfToken = "";

export function currentCsrf(): string {
  return csrfToken;
}

export interface SessionPayload {
  csrfToken: string;
  demo: boolean;
  user: { id: string; email: string; name: string };
  workspace: {
    id: string;
    name: string;
    isDemo: boolean;
    dateWindowDays: number;
    amountToleranceMinor: string;
  };
  role: "owner" | "reviewer" | "read_only";
  memberships: Array<{ id: string; name: string; role: string; isDemo: boolean }>;
}

export interface MoneyTotal {
  currency: string;
  minor: string;
}

export interface DashboardPayload {
  exactExposure: MoneyTotal[];
  proximityExposure: MoneyTotal[];
  realizedRecovery: MoneyTotal[];
  counts: {
    imports: number;
    sourceRows: number;
    invalidRows: number;
    excludedRows: number;
    matchableRows: number;
    openCases: number;
    confirmedCases: number;
    falsePositiveCases: number;
    exactCases: number;
    proximityCases: number;
  };
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-vaultify-request", "1");
    if (csrfToken) headers.set("x-csrf-token", csrfToken);
    if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
  }
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = isRecord(data) && isRecord(data.error) ? data.error : {};
    const details = Array.isArray(body.details) ? body.details.filter((item): item is string => typeof item === "string") : [];
    throw new ApiError(typeof body.code === "string" ? body.code : "request_failed", response.status, details);
  }
  if (isRecord(data) && typeof data.csrfToken === "string") csrfToken = data.csrfToken;
  return data as T;
}

export async function loadSession(): Promise<SessionPayload | null> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin" });
  if (response.status === 401) return null;
  const data = (await response.json()) as SessionPayload;
  csrfToken = data.csrfToken;
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
