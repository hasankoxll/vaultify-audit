import { join } from "node:path";
import { loadConfig, loadEnvFile } from "./config.js";
import { openDatabase } from "./db.js";
import { ensureDemo, readSyntheticCsv } from "./demo.js";
import { migrate } from "./migrate.js";
import { seedOwner } from "./seed-owner.js";

loadEnvFile();
const config = loadConfig();
const command = process.argv[2];
const db = openDatabase(join(config.dataDir, "vaultify.db"));
const applied = migrate(db);

if (command === "migrate") {
  console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Migrations already current.");
  process.exit(0);
}

if (command === "seed" || command === "seed-demo") {
  if (!config.enableDemo) {
    console.error("Demo seeding is off because VA_ENABLE_DEMO=false.");
    process.exit(1);
  }
  ensureDemo(db, readSyntheticCsv());
  console.log("Synthetic demo workspace is ready.");
}

if (command === "seed") {
  const owner = seedOwner(db, config);
  console.log(owner.created ? `Owner created for ${owner.email}.` : `Owner already present for ${owner.email}.`);
  process.exit(0);
}

if (command === "seed-demo") process.exit(0);

console.error("Usage: tsx src/server/cli.ts <migrate|seed|seed-demo>");
process.exit(1);
