# Vaultify Audit

Vaultify Audit is a single-company pilot for reviewing possible duplicate supplier invoices from CSV exports. A finance reviewer uploads a file, maps columns, inspects explainable groups, records a decision, and exports findings.

It does not send payments, write to an accounting system, or decide that an invoice is fraud. Totals are calculated from the imported rows and from review decisions. A recorded recovery is a note. It is not money moved.

This repository is the pilot implementation. It is not a certification, a tax opinion, or a claim that the security boundary is perfect. Hassan retains all licensing and exclusivity decisions. The files here do not grant a license to use, copy, modify, or distribute the software except to people Hassan explicitly authorizes.

The name `audit.getvaultify.io` is only a tentative label for a future hostname. This project does not register it, point DNS at it, or claim that the name is available or controlled.

## What a reviewer can do

- Download the CSV template and import an export with a chosen amount format and date format.
- See a validation preview. Ambiguous amounts and impossible dates are rejected and listed. Original cells are kept.
- Review exact-key groups and, separately, proximity candidates.
- Mark a case false positive, confirm it for review, or record a recovery amount on an exact-key case.
- Export findings and the audit log. Exports prefix spreadsheet formula characters.

The synthetic demo is a separate workspace with fictional invoices. Its password is public. The banner says it is not production authentication. Demo data is not readable from a real workspace, and a demo session cannot open a real workspace.

## Requirements

- Node.js 22.13 or newer. On a MacBook Pro 2018, use the official macOS x64 (Intel) build.
- npm 10.
- Google Chrome is used by the browser test. The app itself runs without Chrome.

The database is Node’s built-in SQLite driver (`node:sqlite`). Node 22 still prints an experimental warning for that driver; the start and test scripts disable that warning. The file on disk is an ordinary SQLite database. No native add-on is compiled, which avoids a node-gyp toolchain on the 2018 Mac.

## Commands

```bash
cp .env.example .env
npm install
npm run seed:demo
npm run dev
```

Dev UI: `http://127.0.0.1:5173`  
Dev API: `http://127.0.0.1:8787`

Demo entry: open `/demo` and choose **Enter synthetic demo**. The published password is `synthetic-demo-only`. That value is not a secret. Do not reuse it for a real owner.

Create a real workspace owner only when you set a non-placeholder password:

```bash
# Edit VA_SEED_OWNER_EMAIL, VA_SEED_OWNER_NAME, and VA_SEED_OWNER_PASSWORD in .env first.
npm run seed
```

`npm run seed` applies migrations, loads the synthetic demo when `VA_ENABLE_DEMO` is not `false`, and creates the owner if that email is not already an owner of a real workspace. It does not print the password. Re-running it does not reset the owner password.

Other commands:

```bash
npm run migrate       # apply SQL migrations only
npm run typecheck
npm run lint
npm test              # unit and HTTP integration tests
npm run test:e2e      # production build, then browser workflow
npm run build
npm start             # serves the built UI and API on VA_HOST:VA_PORT
```

`npm start` also applies migrations and, unless demo is disabled, loads the synthetic workspace if it is missing.

### Docker, local only

```bash
docker compose up --build
```

The published port is bound to `127.0.0.1:8787`. The SQLite file lives in the `vaultify-audit-data` volume. To create an owner inside the container, run `npm run seed` with the owner variables set in the environment. Do not bake a real password into the image.

## Environment variables

Names and placeholders only. Copy `.env.example`. Do not commit `.env`.

| Name | Example | Role |
| --- | --- | --- |
| `VA_DATA_DIR` | `./data` | Directory for `vaultify.db` |
| `VA_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` only inside a container you intend to publish |
| `VA_PORT` | `8787` | HTTP port |
| `VA_COOKIE_SECURE` | `false` | Set `true` only behind HTTPS |
| `VA_SESSION_TTL_HOURS` | `12` | Session lifetime |
| `VA_MAX_UPLOAD_BYTES` | `2000000` | CSV upload cap |
| `VA_MAX_IMPORT_ROWS` | `5000` | Data-row cap |
| `VA_ENABLE_DEMO` | `true` | `false` hides demo sign-in and skips demo seeding |
| `VA_TRUST_PROXY` | `false` | Trust `X-Forwarded-For` only behind your own proxy |
| `VA_LOGIN_RATE_LIMIT` | `10` | Login attempts per window per IP |
| `VA_LOGIN_RATE_WINDOW_SECONDS` | `900` | Rate-limit window |
| `VA_SEED_OWNER_EMAIL` | `owner@example.com` | Owner seed |
| `VA_SEED_OWNER_NAME` | `Example Owner` | Owner seed |
| `VA_SEED_OWNER_PASSWORD` | `replace-with-a-long-password` | Rejected until replaced. Minimum 12 characters |
| `VA_SEED_WORKSPACE_NAME` | `Pilot workspace` | Real workspace name |

`VA_ALLOW_TEST_IP_HEADER` exists for tests. Leave it unset in any shared deployment.

## Synthetic demo figures

`samples/synthetic-demo.csv` is fictional. With the default window of 3 days and amount tolerance of 0, the engine produces:

| Bucket | Amount | Why |
| --- | --- | --- |
| Exact SAR | 2,905.00 | Acme 2,000.00 + Beta 450.00 + Kappa 250.00 + North Wind 80.00 + شركة النور 125.00 |
| Exact EUR | 1,000.00 | Iota, same supplier id |
| Proximity SAR | 2,640.00 | Gamma 2,000.00 + Mu 640.00. Not included in the exact total |
| Recorded recovery | none | Until a reviewer types an amount |

Marking the Acme case a false positive removes its 2,000.00 from potential exposure. SAR exact becomes 905.00. Recovery stays empty. These numbers are locked by `tests/matching.test.ts` and the HTTP demo test.

Credits, installments, recurring invoices, cancelled invoices, and rows missing a supplier or invoice number are stored and excluded. The same invoice number in SAR and USD is not one case.

## Architecture

Browser UI (React, Vite) and HTTP API (Hono on Node) in one process after `npm run build`. In dev, Vite proxies `/api` to the API.

```text
src/domain     parsing, normalization, matching, totals
src/server     SQLite, sessions, routes, import and review services
src/client     English and Arabic UI
migrations     SQL schema
samples        template and synthetic CSV
```

Every invoice, case, export, and audit read uses the workspace id stored on the server session. A workspace id in the query string is ignored. Roles are `owner`, `reviewer`, and `read_only`. Read-only can view and export. Reviewers can import and decide. Owners can also change settings, users, and delete invoice data. The demo workspace has no owner and refuses those owner actions.

Sessions are random tokens. The database stores only a SHA-256 hash. The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when `VA_COOKIE_SECURE=true`. Mutating requests need the header `X-Vaultify-Request: 1` and the session CSRF token. If an `Origin` header is present, its host must match the request `Host`.

### Data model

- `workspaces`, `users`, `memberships`, `sessions`
- `imports` and `import_files` (original CSV text)
- `source_rows` (original cells plus parsed minor units, ISO date, normalized keys, error and exclusion codes)
- `cases` and `case_rows` (one kept row, the rest extras)
- `decisions` (comment and optional recovery amount)
- `audit_events` (insert only; SQLite triggers reject update and delete)

Amounts are integer minor units in text columns, not binary floating point. The currency allowlist is in `src/domain/currencies.ts`. Unknown currencies are rejected.

### Matching rules

Exact group: same supplier key, same normalized invoice number, same currency, at least two matchable rows. Supplier id wins over the name when the id is present. Names are lowercased with punctuation folded; `Acme Inc` does not match `Acme Incorporated`. Invoice numbers lose spaces and `- / .` separators. That is deterministic normalization, not a fuzzy similarity score.

Potential exposure for a group is the sum of member amounts minus the kept amount. The kept row is the largest amount, then the earliest date, then the lowest id. Different currencies are never placed in one group.

Proximity group: same supplier and currency, different invoice numbers, date gap within the workspace window, absolute minor-unit gap within the tolerance. Rows already in an exact group are not also counted as proximity. A chain of three rows is one cluster, so exposure is not the sum of every pair.

Dashboard potential duplicate exposure includes only exact groups with status `open` or `confirmed_for_review`, minus any recovery recorded on those cases. Proximity has its own total. False positives and dissolved groups contribute nothing. Recorded recovery is summed only for those same active exact groups, and only up to each case’s exposure.

Case ids are a hash of the workspace and the group key, so the same logical group keeps its decision when imports are recalculated.

## Threat assumptions

Assumed adversary: another signed-in user, a person who can submit a hostile CSV, or a browser page on another site trying to reuse a session. The pilot also assumes the operator can read the server disk.

The app does not try to stop a person who can read `vaultify.db` or the process environment. It does not claim to resist a stolen backup. Rate limits live in process memory and reset on restart; they are not a shared limit across multiple servers. Request bodies are rejected after the configured size is known, but a chunked upload is fully read before that check. Put a reverse-proxy body limit in front of any shared deployment.

Passwords are scrypt hashes. Failed sign-in uses the same hash work when the email is unknown. Logs drop fields whose names look like passwords, tokens, invoice content, amounts, or comments. That filter is a backstop, not a proof that every future log line is safe. Audit metadata stores counts, ids, and decision codes, not raw invoice cells. A reviewer’s comment can still quote an invoice; that comment is in the decision record and the findings export, which are visible to workspace members.

Uploads must be `.csv`, a small allowlist of content types, UTF-8, and free of NUL bytes. There is no malware scanner.

## Known gaps

- No SSO, password reset email, or password-change screen for the signed-in user (an owner can set another member’s password).
- No member removal screen.
- One Node process and one SQLite writer. Not a high-availability deployment.
- In-memory rate limit and no distributed session store.
- Currency list is a short allowlist, not every ISO code.
- Amounts that are valid under two separator styles with different values are rejected, including `1.234` and `1,234`, even when a locale is selected.
- Proximity tolerance is one minor-unit number for every currency in the workspace. `100` is 1.00 SAR and 100 JPY.
- Demo password is public by design.
- Arabic copy is product UI copy, not a legal translation.
- Node’s SQLite API is still marked experimental on Node 22.
- No SOC 2, ISO, tax, or fraud-prevention claim is made or implied by running this software.

## Backup, retention, deletion

The system of record is `VA_DATA_DIR/vaultify.db` plus its `-wal` and `-shm` files while the process is running.

Backup: stop the process, copy those files, start again. Copying the database while it is open can produce a partial file unless you use SQLite’s own backup API. This pilot does not schedule backups.

Retention for a pilot is a business choice. A practical default is to keep the file for the pilot and then export findings before destroying it. That is a suggestion, not a legal schedule.

Deletion inside the product:

- An owner of a real workspace can delete one import, or delete all invoice data by typing `DELETE INVOICE DATA`.
- That removes imports, source rows, cases, and decision comments for that workspace.
- Audit events stay. Their triggers forbid update and delete. They are not a copy of the invoice file.
- The synthetic demo cannot use that wipe. A demo reviewer can reset the fictional file instead.
- To destroy audit events as well, stop the app and delete the database file.

## Pilot acceptance checklist

- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run test:e2e` pass on the machine you will demo.
- [ ] Demo banner is visible and says this is not production authentication.
- [ ] Overview shows SAR 2,905.00 and EUR 1,000.00 exact exposure, SAR 2,640.00 proximity, and no recorded recovery.
- [ ] Acme `INV-100` shows SAR 2,000.00 and the source rows. Marking it a false positive changes SAR exact exposure to 905.00 and leaves recovery empty.
- [ ] A CSV cell beginning with `=` is prefixed with a quote in the findings export.
- [ ] An amount such as `1,234` under English grouping is reported as ambiguous and is not matched.
- [ ] A read-only user cannot import or decide. A user in another workspace receives 404 for the first workspace’s import and does not see its supplier names in an export.
- [ ] Owner seed rejects the placeholder password in `.env.example`.
- [ ] You can stop the app, copy `vaultify.db`, and open the copy with SQLite.
- [ ] You have decided, in writing outside this repo, the hostname, TLS certificate, backup owner, and who may sign in. None of that is done by cloning this repository.

## MacBook Pro 2018

Install Node 22 from nodejs.org (macOS installer, Intel). In Terminal:

```bash
git clone <this-repository>
cd vaultify-audit
cp .env.example .env
npm install
npm run seed:demo
npm run dev
```

Open `http://127.0.0.1:5173/demo`. For a built local server instead of dev mode: `npm run build && npm start`, then open `http://127.0.0.1:8787/demo`.

Chrome is already typical on that machine. Xcode command-line tools are not required for this stack.

## Commercial note

`docs/commercial-pack.en.md` and `docs/commercial-pack.ar.md` are hypotheses and proposed pilot options at illustrative 10,000 USD and 15,000 USD. They are not evidence that anyone will pay those amounts. Hassan keeps licensing and exclusivity.
