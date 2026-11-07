import type { AppConfig } from "./config.js";
import type { AppDb } from "./db.js";
import { requiredText } from "./db.js";
import { cleanName, normalizeEmail, passwordError } from "./passwords.js";
import { addMembership, createUser, createWorkspace, listMemberships } from "./services/accounts.js";

export function seedOwner(db: AppDb, config: AppConfig): { email: string; created: boolean } {
  const email = normalizeEmail(config.seedOwnerEmail ?? "");
  const name = cleanName(config.seedOwnerName ?? "");
  const password = config.seedOwnerPassword ?? "";
  if (!email || !name) {
    throw new Error("Set VA_SEED_OWNER_EMAIL and VA_SEED_OWNER_NAME before seeding an owner.");
  }
  if (passwordError(password)) {
    throw new Error("VA_SEED_OWNER_PASSWORD must be 12-128 characters and must not be the published example placeholder.");
  }
  const now = new Date().toISOString();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  const userId = existing
    ? requiredText(existing, "id")
    : createUser(db, { email, name, password, now });
  const memberships = listMemberships(db, userId);
  if (memberships.some((membership) => !membership.isDemo && membership.role === "owner")) {
    return { email, created: false };
  }
  const workspaceName = cleanName(config.seedWorkspaceName) ?? "Pilot workspace";
  const workspaceId = createWorkspace(db, { name: workspaceName, now });
  addMembership(db, { workspaceId, userId, role: "owner", now });
  return { email, created: true };
}
