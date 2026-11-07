import { join } from "node:path";
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { loadConfig, loadEnvFile } from "./config.js";
import { openDatabase } from "./db.js";
import { ensureDemo, readSyntheticCsv } from "./demo.js";
import { createLogger } from "./logger.js";
import { migrate } from "./migrate.js";

loadEnvFile();
const config = loadConfig();
const logger = createLogger();
const db = openDatabase(join(config.dataDir, "vaultify.db"));
migrate(db);
if (config.enableDemo) ensureDemo(db, readSyntheticCsv());
const staticRoot = join(process.cwd(), "dist", "client");
const app = createApp({
  db,
  config,
  logger,
  staticRoot: existsSync(staticRoot) ? staticRoot : null,
});

serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  () => {
    logger("info", "server_started", { host: config.host, port: config.port, demo: config.enableDemo });
  },
);
