import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addMembership, createUser, createWorkspace } from "../src/server/services/accounts.js";
import { ensureDemo, readSyntheticCsv, resetDemo } from "../src/server/demo.js";
import { DEMO_ACK, DEMO_PASSWORD, DEMO_WORKSPACE_ID } from "../src/server/demo-constants.js";
import { login, mutationHeaders, readHeaders, testContext } from "./helpers.js";

const ownerPassword = "owner-password-1";
const reviewerPassword = "reviewer-password-1";
const readerPassword = "reader-password-1";

function seedCompanies() {
  const ctx = testContext();
  const now = "2026-01-01T00:00:00.000Z";
  const workspaceA = createWorkspace(ctx.db, { name: "Company A", now });
  const workspaceB = createWorkspace(ctx.db, { name: "Company B", now });
  const owner = createUser(ctx.db, { email: "owner@example.com", name: "Owner A", password: ownerPassword, now });
  const reviewer = createUser(ctx.db, { email: "reviewer@example.com", name: "Reviewer A", password: reviewerPassword, now });
  const reader = createUser(ctx.db, { email: "reader@example.com", name: "Reader A", password: readerPassword, now });
  const ownerB = createUser(ctx.db, { email: "owner-b@example.com", name: "Owner B", password: ownerPassword, now });
  addMembership(ctx.db, { workspaceId: workspaceA, userId: owner, role: "owner", now });
  addMembership(ctx.db, { workspaceId: workspaceA, userId: reviewer, role: "reviewer", now });
  addMembership(ctx.db, { workspaceId: workspaceA, userId: reader, role: "read_only", now });
  addMembership(ctx.db, { workspaceId: workspaceB, userId: ownerB, role: "owner", now });
  return { ...ctx, workspaceA, workspaceB };
}

async function upload(ctx: ReturnType<typeof seedCompanies>, cookie: string, csrf: string, csv: string, filename = "invoices.csv") {
  const form = new FormData();
  form.set("file", new File([csv], filename, { type: "text/csv" }));
  const headers = mutationHeaders(cookie, csrf);
  delete (headers as { "content-type"?: string })["content-type"];
  return ctx.app.request("http://localhost/api/imports", { method: "POST", headers, body: form });
}

describe("workspace isolation and authorization", () => {
  it("rejects missing CSRF, blocks other roles, and hides the other workspace", async () => {
    const ctx = seedCompanies();
    const owner = await login(ctx.app, "owner@example.com", ownerPassword);
    const reviewer = await login(ctx.app, "reviewer@example.com", reviewerPassword);
    const reader = await login(ctx.app, "reader@example.com", readerPassword);
    const ownerB = await login(ctx.app, "owner-b@example.com", ownerPassword);
    expect(owner.setCookie.toLowerCase()).toContain("httponly");
    expect(JSON.stringify(owner.json)).not.toContain(owner.cookie.split("=")[1] ?? "missing-token");

    const secret = "ZZ-SECRET-SUPPLIER";
    const uploaded = await upload(
      ctx,
      ownerB.cookie,
      ownerB.csrf,
      `supplier_id,supplier_name,invoice_number,invoice_date,amount,currency,payment_status,document_kind\nSUP-9,${secret},INV-9,2026-01-01,10.00,SAR,unpaid,invoice\n`,
    );
    expect(uploaded.status).toBe(201);
    const created = (await uploaded.json()) as { id: string; suggestedMapping: Record<string, string> };
    const committed = await ctx.app.request(`http://localhost/api/imports/${created.id}/commit`, {
      method: "POST",
      headers: mutationHeaders(ownerB.cookie, ownerB.csrf),
      body: JSON.stringify({ mapping: created.suggestedMapping, amountLocale: "plain", dateFormat: "YYYY-MM-DD" }),
    });
    expect(committed.status).toBe(200);

    const foreignList = await ctx.app.request(`http://localhost/api/imports?workspaceId=${ctx.workspaceB}`, {
      headers: readHeaders(owner.cookie),
    });
    expect(foreignList.status).toBe(200);
    expect(await foreignList.text()).not.toContain(secret);

    const foreignImport = await ctx.app.request(`http://localhost/api/imports/${created.id}`, { headers: readHeaders(owner.cookie) });
    expect(foreignImport.status).toBe(404);
    const foreignErrors = await ctx.app.request(`http://localhost/api/imports/${created.id}/errors.csv`, {
      headers: readHeaders(owner.cookie),
    });
    expect(foreignErrors.status).toBe(404);

    const findings = await ctx.app.request("http://localhost/api/exports/findings.csv", { headers: readHeaders(owner.cookie) });
    expect(findings.status).toBe(200);
    expect(await findings.text()).not.toContain(secret);
    const auditExport = await ctx.app.request("http://localhost/api/exports/audit.csv", { headers: readHeaders(ownerB.cookie) });
    expect(await auditExport.text()).not.toContain("Company A");

    const noHeader = await ctx.app.request("http://localhost/api/imports", {
      method: "POST",
      headers: { cookie: owner.cookie, origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({}),
    });
    expect(noHeader.status).toBe(403);
    const noCsrf = await ctx.app.request("http://localhost/api/settings", {
      method: "PATCH",
      headers: mutationHeaders(owner.cookie),
      body: JSON.stringify({ dateWindowDays: 1, amountToleranceMinor: "0" }),
    });
    expect(noCsrf.status).toBe(403);

    const readerDecision = await ctx.app.request("http://localhost/api/cases/case_missing/decisions", {
      method: "POST",
      headers: mutationHeaders(reader.cookie, reader.csrf),
      body: JSON.stringify({ decision: "false_positive", comment: "Not a duplicate" }),
    });
    expect(readerDecision.status).toBe(403);
    const readerUpload = await upload(ctx, reader.cookie, reader.csrf, "supplier_id,amount\nA,1\n");
    expect(readerUpload.status).toBe(403);
    const reviewerSettings = await ctx.app.request("http://localhost/api/settings", {
      method: "PATCH",
      headers: mutationHeaders(reviewer.cookie, reviewer.csrf),
      body: JSON.stringify({ dateWindowDays: 2, amountToleranceMinor: "0" }),
    });
    expect(reviewerSettings.status).toBe(403);
    const reviewerMembers = await ctx.app.request("http://localhost/api/members", { headers: readHeaders(reviewer.cookie) });
    expect(reviewerMembers.status).toBe(403);

    const badOrigin = await ctx.app.request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { ...mutationHeaders(owner.cookie, owner.csrf), origin: "http://evil.example" },
    });
    expect(badOrigin.status).toBe(403);

    const anonymous = await ctx.app.request("http://localhost/api/exports/findings.csv");
    expect(anonymous.status).toBe(401);
    expect(JSON.stringify(ctx.logs)).not.toContain(secret);
    expect(JSON.stringify(ctx.logs)).not.toContain(ownerPassword);
  });

  it("imports, previews errors, preserves false positives, and protects formula exports", async () => {
    const ctx = seedCompanies();
    const owner = await login(ctx.app, "owner@example.com", ownerPassword, "203.0.113.20");
    const reviewer = await login(ctx.app, "reviewer@example.com", reviewerPassword, "203.0.113.21");
    const csv = [
      "supplier_id,supplier_name,invoice_number,invoice_date,amount,currency,payment_status,document_kind",
      'SUP-1,"=HYPERLINK(""http://evil.example"",""Click"")",INV-1,2026-01-10,100.00,SAR,paid,invoice',
      'SUP-1,"=HYPERLINK(""http://evil.example"",""Click"")",INV-1,2026-01-10,100.00,SAR,unpaid,invoice',
      "SUP-1,Safe Supplier,INV-2,2026-02-31,80.00,SAR,unpaid,invoice",
      "SUP-1,Safe Supplier,INV-3,2026-02-01,1.234,SAR,unpaid,invoice",
      "SUP-2,Other,INV-4,01/02/2026,50.00,XYZ,unpaid,invoice",
      "SUP-3,Near,INV-5,2026-03-01,20.00,SAR,unpaid,invoice",
      "SUP-3,Near,INV-6,2026-03-02,20.00,SAR,paid,invoice",
      "SUP-4,Credit Co,INV-7,2026-03-03,-5.00,SAR,credit,credit",
    ].join("\n");
    const uploaded = await upload(ctx, reviewer.cookie, reviewer.csrf, csv);
    expect(uploaded.status).toBe(201);
    const created = (await uploaded.json()) as { id: string; suggestedMapping: Record<string, string> };
    const preview = await ctx.app.request(`http://localhost/api/imports/${created.id}/preview`, {
      method: "POST",
      headers: mutationHeaders(reviewer.cookie, reviewer.csrf),
      body: JSON.stringify({ mapping: created.suggestedMapping, amountLocale: "plain", dateFormat: "YYYY-MM-DD" }),
    });
    const previewBody = (await preview.json()) as { summary: { invalidCount: number; excludedCount: number; matchableCount: number } };
    expect(previewBody.summary.invalidCount).toBe(3);
    expect(previewBody.summary.excludedCount).toBe(1);
    expect(previewBody.summary.matchableCount).toBe(4);
    const committed = await ctx.app.request(`http://localhost/api/imports/${created.id}/commit`, {
      method: "POST",
      headers: mutationHeaders(reviewer.cookie, reviewer.csrf),
      body: JSON.stringify({ mapping: created.suggestedMapping, amountLocale: "plain", dateFormat: "YYYY-MM-DD" }),
    });
    expect(committed.status).toBe(200);
    const dashboardResponse = await ctx.app.request("http://localhost/api/dashboard", { headers: readHeaders(reviewer.cookie) });
    const dashboardBody = (await dashboardResponse.json()) as {
      exactExposure: Array<{ currency: string; minor: string }>;
      proximityExposure: Array<{ currency: string; minor: string }>;
      realizedRecovery: unknown[];
    };
    expect(dashboardBody.exactExposure).toEqual([{ currency: "SAR", minor: "10000" }]);
    expect(dashboardBody.proximityExposure).toEqual([{ currency: "SAR", minor: "2000" }]);
    expect(dashboardBody.realizedRecovery).toEqual([]);

    const queue = await ctx.app.request("http://localhost/api/cases?matchType=exact", { headers: readHeaders(reviewer.cookie) });
    const queueBody = (await queue.json()) as { cases: Array<{ id: string; exposureMinor: string }> };
    const exact = queueBody.cases[0];
    expect(exact?.exposureMinor).toBe("10000");
    const detail = await ctx.app.request(`http://localhost/api/cases/${exact?.id}`, { headers: readHeaders(owner.cookie) });
    const detailBody = (await detail.json()) as { members: Array<{ supplierName: string; amountRaw: string }>; confidence: string };
    expect(detailBody.members[0]?.supplierName.startsWith("=HYPERLINK")).toBe(true);
    expect(detailBody.confidence).toBe("heuristic_exact_amount");

    const decision = await ctx.app.request(`http://localhost/api/cases/${exact?.id}/decisions`, {
      method: "POST",
      headers: mutationHeaders(reviewer.cookie, reviewer.csrf),
      body: JSON.stringify({ decision: "false_positive", comment: "Installment was already excluded; this pair is a reprint." }),
    });
    expect(decision.status).toBe(200);
    const after = (await (
      await ctx.app.request("http://localhost/api/dashboard", { headers: readHeaders(owner.cookie) })
    ).json()) as { exactExposure: unknown[]; proximityExposure: Array<{ minor: string }> };
    expect(after.exactExposure).toEqual([]);
    expect(after.proximityExposure[0]?.minor).toBe("2000");

    const recovery = await ctx.app.request(`http://localhost/api/cases/${exact?.id}/decisions`, {
      method: "POST",
      headers: mutationHeaders(reviewer.cookie, reviewer.csrf),
      body: JSON.stringify({ decision: "record_recovery", comment: "Should be rejected", recoveredAmount: "10.00" }),
    });
    expect(recovery.status).toBe(409);

    const second = await upload(
      ctx,
      owner.cookie,
      owner.csrf,
      "supplier_id,supplier_name,invoice_number,invoice_date,amount,currency,payment_status,document_kind\nSUP-8,Singleton,INV-8,2026-04-01,9.00,SAR,unpaid,invoice\n",
    );
    const secondBody = (await second.json()) as { id: string; suggestedMapping: Record<string, string> };
    await ctx.app.request(`http://localhost/api/imports/${secondBody.id}/commit`, {
      method: "POST",
      headers: mutationHeaders(owner.cookie, owner.csrf),
      body: JSON.stringify({ mapping: secondBody.suggestedMapping, amountLocale: "plain", dateFormat: "YYYY-MM-DD" }),
    });
    const still = await ctx.app.request(`http://localhost/api/cases/${exact?.id}`, { headers: readHeaders(owner.cookie) });
    expect(((await still.json()) as { status: string }).status).toBe("false_positive");

    const findings = await (await ctx.app.request("http://localhost/api/exports/findings.csv", { headers: readHeaders(owner.cookie) })).text();
    expect(findings).toContain(`'=HYPERLINK`);
    expect(findings).not.toContain("\n=HYPERLINK");
    const ambiguous = await upload(
      ctx,
      owner.cookie,
      owner.csrf,
      "supplier_id,supplier_name,invoice_number,invoice_date,amount,currency,payment_status,document_kind\nSUP-1,Ambiguous,INV-9,2026-05-01,\"1,234\",SAR,unpaid,invoice\n",
    );
    const ambiguousBody = (await ambiguous.json()) as { id: string; suggestedMapping: Record<string, string> };
    const ambiguousPreview = await ctx.app.request(`http://localhost/api/imports/${ambiguousBody.id}/preview`, {
      method: "POST",
      headers: mutationHeaders(owner.cookie, owner.csrf),
      body: JSON.stringify({ mapping: ambiguousBody.suggestedMapping, amountLocale: "en-US", dateFormat: "YYYY-MM-DD" }),
    });
    const ambiguousJson = (await ambiguousPreview.json()) as { previewRows: Array<{ errorCodes: string[] }> };
    expect(ambiguousJson.previewRows[0]?.errorCodes).toContain("ambiguous_amount");

    const tooBig = testContext({ VA_MAX_UPLOAD_BYTES: "1024" });
    const bigOwner = createUser(tooBig.db, {
      email: "big@example.com",
      name: "Big",
      password: ownerPassword,
      now: "2026-01-01T00:00:00.000Z",
    });
    const bigWorkspace = createWorkspace(tooBig.db, { name: "Big", now: "2026-01-01T00:00:00.000Z" });
    addMembership(tooBig.db, { workspaceId: bigWorkspace, userId: bigOwner, role: "owner", now: "2026-01-01T00:00:00.000Z" });
    const bigLogin = await login(tooBig.app, "big@example.com", ownerPassword, "203.0.113.30");
    const huge = await upload(
      { ...tooBig, workspaceA: bigWorkspace, workspaceB: bigWorkspace },
      bigLogin.cookie,
      bigLogin.csrf,
      "a".repeat(2_000),
    );
    expect(huge.status).toBe(413);
    const nul = await upload(ctx, owner.cookie, owner.csrf, `supplier\0,name\nA,B\n`);
    expect(nul.status).toBe(422);
    const exe = await upload(ctx, owner.cookie, owner.csrf, "a,b\n1,2\n", "evil.exe");
    expect(exe.status).toBe(415);

    expect(() => ctx.db.prepare("DELETE FROM audit_events").run()).toThrow(/immutable/i);
    expect(() => ctx.db.prepare("UPDATE audit_events SET action = 'tamper'").run()).toThrow(/immutable/i);
  });

  it("keeps synthetic demo data isolated from a real workspace", async () => {
    const ctx = testContext({ VA_ENABLE_DEMO: "true" });
    ensureDemo(ctx.db, readSyntheticCsv(), "2026-01-01T00:00:00.000Z");
    const now = "2026-01-02T00:00:00.000Z";
    const workspaceId = createWorkspace(ctx.db, { name: "Real Co", now });
    const userId = createUser(ctx.db, { email: "real@example.com", name: "Real Owner", password: ownerPassword, now });
    addMembership(ctx.db, { workspaceId, userId, role: "owner", now });
    const real = await login(ctx.app, "real@example.com", ownerPassword, "203.0.113.40");
    const switched = await ctx.app.request("http://localhost/api/auth/switch", {
      method: "POST",
      headers: mutationHeaders(real.cookie, real.csrf, "203.0.113.40"),
      body: JSON.stringify({ workspaceId: DEMO_WORKSPACE_ID }),
    });
    expect(switched.status).toBe(404);
    expect(() =>
      addMembership(ctx.db, {
        workspaceId,
        userId: "user_demo",
        role: "reviewer",
        now: "2026-01-02T00:00:00.000Z",
      }),
    ).toThrow(/demo_isolation/);

    const demo = await ctx.app.request("http://localhost/api/auth/demo", {
      method: "POST",
      headers: mutationHeaders(undefined, undefined, "203.0.113.41"),
      body: JSON.stringify({ acknowledge: DEMO_ACK, password: DEMO_PASSWORD }),
    });
    expect(demo.status).toBe(200);
    const demoJson = (await demo.json()) as { demo: boolean; csrfToken: string; workspace: { name: string } };
    expect(demoJson.demo).toBe(true);
    expect(demoJson.workspace.name).toContain("Synthetic");
    const demoCookie = (demo.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    const dash = (await (
      await ctx.app.request("http://localhost/api/dashboard", { headers: readHeaders(demoCookie) })
    ).json()) as { exactExposure: Array<{ currency: string; minor: string }> };
    expect(dash.exactExposure).toEqual([
      { currency: "SAR", minor: "290500" },
      { currency: "EUR", minor: "100000" },
    ]);
    const realDash = await (await ctx.app.request("http://localhost/api/dashboard", { headers: readHeaders(real.cookie) })).text();
    expect(realDash).not.toContain("290500");
    const template = await ctx.app.request("http://localhost/api/template.csv", { headers: readHeaders(demoCookie) });
    expect(await template.text()).toContain(readFileSync("samples/template.csv", "utf8").trim());

    const form = new FormData();
    form.set(
      "file",
      new File(
        [
          "supplier_id,supplier_name,invoice_number,invoice_date,amount,currency,payment_status,document_kind\nSUP-R,Real Supplier,INV-R,2026-01-01,15.00,SAR,unpaid,invoice\n",
        ],
        "real.csv",
        { type: "text/csv" },
      ),
    );
    const uploadHeaders = mutationHeaders(real.cookie, real.csrf, "203.0.113.40");
    delete uploadHeaders["content-type"];
    const uploaded = await ctx.app.request("http://localhost/api/imports", { method: "POST", headers: uploadHeaders, body: form });
    expect(uploaded.status).toBe(201);
    const uploadedBody = (await uploaded.json()) as { id: string; suggestedMapping: Record<string, string> };
    const committed = await ctx.app.request(`http://localhost/api/imports/${uploadedBody.id}/commit`, {
      method: "POST",
      headers: mutationHeaders(real.cookie, real.csrf, "203.0.113.40"),
      body: JSON.stringify({ mapping: uploadedBody.suggestedMapping, amountLocale: "plain", dateFormat: "YYYY-MM-DD" }),
    });
    expect(committed.status).toBe(200);

    const reset = await ctx.app.request("http://localhost/api/demo/reset", {
      method: "POST",
      headers: mutationHeaders(demoCookie, demoJson.csrfToken, "203.0.113.41"),
    });
    expect(reset.status).toBe(200);
    const realStill = await (await ctx.app.request("http://localhost/api/imports", { headers: readHeaders(real.cookie) })).text();
    expect(realStill).toContain("real.csv");
    const demoStill = await (await ctx.app.request("http://localhost/api/dashboard", { headers: readHeaders(demoCookie) })).text();
    expect(demoStill).toContain("290500");
    expect(demoStill).not.toContain("Real Supplier");
    expect(() => resetDemo(ctx.db, "someone-else", readSyntheticCsv(), "2026-01-03T00:00:00.000Z")).toThrow(/forbidden/);
  });
});
