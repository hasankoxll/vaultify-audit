import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type SqlParam = string | number | bigint | null;

export interface Prepared {
  all(...params: SqlParam[]): Record<string, unknown>[];
  get(...params: SqlParam[]): Record<string, unknown> | undefined;
  run(...params: SqlParam[]): void;
}

export interface AppDb {
  exec(sql: string): void;
  prepare(sql: string): Prepared;
}

export function openDatabase(filename: string): AppDb {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  if (filename !== ":memory:") db.exec("PRAGMA journal_mode = WAL");
  return {
    exec(sql: string) {
      db.exec(sql);
    },
    prepare(sql: string): Prepared {
      const statement = db.prepare(sql);
      return {
        all(...params: SqlParam[]) {
          return statement.all(...(params as never[])) as Record<string, unknown>[];
        },
        get(...params: SqlParam[]) {
          const row = statement.get(...(params as never[])) as Record<string, unknown> | null | undefined;
          return row ?? undefined;
        },
        run(...params: SqlParam[]) {
          statement.run(...(params as never[]));
        },
      };
    },
  };
}

export function transaction<T>(db: AppDb, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* The original error is the one that matters. */
    }
    throw error;
  }
}

export function requiredText(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`missing_column:${key}`);
  return value;
}

export function requiredNumber(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`missing_column:${key}`);
  return value;
}
