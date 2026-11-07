import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppDb } from "./db.js";

export function migrate(db: AppDb, migrationsDir = join(process.cwd(), "migrations")): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    db
      .prepare("SELECT id FROM schema_migrations")
      .all()
      .map((row) => String(row.id)),
  );
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(file, new Date().toISOString());
      db.exec("COMMIT");
      ran.push(file);
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        /* preserve the migration error */
      }
      throw error;
    }
  }
  return ran;
}
