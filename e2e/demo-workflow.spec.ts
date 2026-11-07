import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const artifacts = "/opt/cursor/artifacts";

test("finance reviewer completes the synthetic duplicate review", async ({ page }) => {
  mkdirSync(artifacts, { recursive: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Invoice duplicate review for finance teams" })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/01-login-light.png`, fullPage: true });

  await page.goto("/demo");
  await expect(page.getByTestId("demo-entry-notice")).toContainText("not production authentication");
  await page.getByTestId("demo-enter").click();
  await expect(page.getByTestId("demo-banner")).toContainText("not production authentication");

  const csrf = await page.getByTestId("session").getAttribute("data-csrf");
  expect(csrf).toBeTruthy();
  const reset = await page.request.post("/api/demo/reset", {
    headers: {
      "x-csrf-token": csrf ?? "",
      "x-vaultify-request": "1",
      origin: "http://127.0.0.1:8787",
      "content-type": "application/json",
    },
    data: {},
  });
  expect(reset.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("exact-exposure")).toContainText("SAR 2,905.00");
  await expect(page.getByTestId("exact-exposure")).toContainText("EUR 1,000.00");
  await expect(page.getByTestId("proximity-exposure")).toContainText("SAR 2,640.00");
  await expect(page.getByTestId("realized-recovery")).toContainText("No recorded recovery.");
  await page.screenshot({ path: `${artifacts}/02-demo-dashboard.png`, fullPage: true });

  const template = await page.request.get("/api/template.csv");
  expect(template.ok()).toBeTruthy();
  expect(await template.text()).toContain("supplier_id,supplier_name,invoice_number");

  await page.getByRole("link", { name: "Import CSV" }).click();
  await page.getByTestId("csv-file").setInputFiles("e2e/fixtures/reviewer-import.csv");
  await page.getByTestId("upload-csv").click();
  await expect(page.getByRole("heading", { name: "Field mapping" })).toBeVisible();
  await page.getByTestId("preview-import").click();
  await expect(page.getByRole("heading", { name: "Preview summary" })).toBeVisible();
  await expect(page.getByText("Date does not match the selected format or calendar")).toBeVisible();
  await page.screenshot({ path: `${artifacts}/03-import-preview.png`, fullPage: true });
  await page.getByTestId("commit-import").click();
  await expect(page.getByRole("heading", { name: "Import detail" })).toBeVisible();

  await page.getByTestId("nav-queue").click();
  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("queue-search").fill("Acme Trading");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByRole("cell", { name: "Acme Trading" })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/04-queue-dark.png`, fullPage: true });
  await page.getByRole("link", { name: "Open case" }).click();
  await expect(page.getByTestId("case-notice")).toContainText("not a fraud finding");
  await expect(page.getByTestId("case-exposure")).toContainText("SAR 2,000.00");
  await expect(page.getByRole("cell", { name: "INV-100" }).first()).toBeVisible();
  await page.screenshot({ path: `${artifacts}/05-case-evidence.png`, fullPage: true });

  await page.getByTestId("decision-comment").fill("Reprint of the same supplier invoice; keep one copy.");
  await page.getByTestId("false-positive").click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await expect(page.getByText("False positive", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByTestId("exact-exposure")).toContainText("SAR 905.00");
  await expect(page.getByTestId("exact-exposure")).toContainText("EUR 1,000.00");
  await expect(page.getByTestId("proximity-exposure")).toContainText("SAR 2,640.00");
  await expect(page.getByTestId("realized-recovery")).toContainText("No recorded recovery.");

  const findings = await page.request.get("/api/exports/findings.csv");
  expect(findings.ok()).toBeTruthy();
  const csv = await findings.text();
  expect(csv).toContain("false_positive");
  expect(csv).toContain("Heuristic review signal only");

  await page.getByTestId("theme-toggle").click();
  await page.getByTestId("lang-toggle").click();
  await expect(page.getByTestId("demo-banner")).toContainText("ليست مصادقة إنتاجية");
  await expect(page.getByRole("heading", { name: "التعرض المحتمل للتكرار" })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/06-dashboard-arabic-rtl.png`, fullPage: true });
});
