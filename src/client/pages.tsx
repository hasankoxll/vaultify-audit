import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api, currentCsrf, type DashboardPayload, type SessionPayload } from "./api.js";
import { useI18n, type MessageKey } from "./i18n.js";
import { Empty, ErrorState, Loading, MoneyList, PageTitle, Pill, codeText, errorText, money } from "./ui.js";

const fields = [
  "supplier_id",
  "supplier_name",
  "invoice_number",
  "invoice_date",
  "amount",
  "currency",
  "payment_status",
  "document_kind",
] as const;

export function LoginPage({ onSession }: { onSession: (session: SessionPayload) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api<SessionPayload>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      onSession(session);
      navigate("/app");
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form className="panel stack" aria-label={t("loginForm")} onSubmit={submit}>
        <h2>{t("signIn")}</h2>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <label>
          {t("email")}
          <input data-testid="login-email" autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <label>
          {t("password")}
          <input autoComplete="current-password" type="password" required minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="button primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? t("signingIn") : t("signIn")}
        </button>
        <Link to="/demo">{t("demoLink")}</Link>
      </form>
    </AuthFrame>
  );
}

export function DemoPage({ onSession }: { onSession: (session: SessionPayload) => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const session = await api<SessionPayload>("/api/auth/demo", {
        method: "POST",
        body: JSON.stringify({ acknowledge: "SYNTHETIC DEMO", password: "synthetic-demo-only" }),
      });
      onSession(session);
      navigate("/app");
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame>
      <form className="panel stack" aria-label={t("demoForm")} onSubmit={submit}>
        <h2>{t("demoTitle")}</h2>
        <p>{t("demoBody")}</p>
        <p className="note" data-testid="demo-entry-notice">{t("demoNotAuth")}</p>
        <p>
          <span className="muted">{t("demoPasswordLabel")}</span>
          <br />
          <strong>synthetic-demo-only</strong>
        </p>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="button primary" type="submit" data-testid="demo-enter" disabled={busy} aria-busy={busy}>
          {busy ? t("enteringDemo") : t("enterDemo")}
        </button>
        <Link to="/">{t("backToSignIn")}</Link>
      </form>
    </AuthFrame>
  );
}

function AuthFrame({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <main className="auth-layout">
      <section className="auth-copy">
        <div>
          <p className="kicker">{t("appName")}</p>
          <h1 id="page-title" tabIndex={-1}>{t("tagline")}</h1>
          <p>{t("loginLead")}</p>
        </div>
        <ul>
          <li>{t("loginBoundary1")}</li>
          <li>{t("loginBoundary2")}</li>
          <li>{t("loginBoundary3")}</li>
        </ul>
      </section>
      <section className="auth-panel">{children}</section>
    </main>
  );
}

export function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<DashboardPayload>("/api/dashboard")
      .then((payload) => { if (!cancelled) setData(payload); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [tick]);
  if (error) return <ErrorState onRetry={() => { setError(false); setTick((value) => value + 1); }} />;
  if (!data) return <Loading />;
  return (
    <>
      <PageTitle title={t("overview")}>
        <a className="button" href="/api/template.csv">{t("downloadTemplate")}</a>
        <Link className="button primary" to="/app/imports/new">{t("importCsv")}</Link>
      </PageTitle>
      {data.counts.imports === 0 ? (
        <Empty title={t("emptyImportsTitle")} body={t("emptyImportsBody")} action={<Link className="button primary" to="/app/imports/new">{t("importCsv")}</Link>} />
      ) : (
        <>
          <div className="grid">
            <article className="card">
              <h2>{t("exactTitle")}</h2>
              <MoneyList items={data.exactExposure} testId="exact-exposure" empty={t("none")} />
              <p className="hint">{t("exactHint")}</p>
            </article>
            <article className="card">
              <h2>{t("proximityTitle")}</h2>
              <MoneyList items={data.proximityExposure} testId="proximity-exposure" empty={t("none")} />
              <p className="hint">{t("proximityHint")}</p>
            </article>
            <article className="card">
              <h2>{t("realizedTitle")}</h2>
              <MoneyList items={data.realizedRecovery} testId="realized-recovery" empty={t("noRecovery")} />
              <p className="hint">{t("realizedHint")}</p>
            </article>
          </div>
          <section className="card" style={{ marginTop: "0.8rem" }}>
            <h2>{t("countsTitle")}</h2>
            <div className="counts">
              <Count label={t("openCases")} value={data.counts.openCases} />
              <Count label={t("confirmedCases")} value={data.counts.confirmedCases} />
              <Count label={t("falsePositiveCases")} value={data.counts.falsePositiveCases} />
              <Count label={t("exactCases")} value={data.counts.exactCases} />
              <Count label={t("proximityCases")} value={data.counts.proximityCases} />
              <Count label={t("matchableRows")} value={data.counts.matchableRows} />
              <Count label={t("excludedRows")} value={data.counts.excludedRows} />
              <Count label={t("invalidRows")} value={data.counts.invalidRows} />
            </div>
          </section>
          <p className="hint">{t("dashboardFootnote")}</p>
        </>
      )}
    </>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <div className="count"><span className="muted">{label}</span><strong>{value}</strong></div>;
}

interface ImportSummary {
  id: string;
  filename: string;
  status: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  excludedCount: number;
  createdAt: string;
}

export function ImportsPage() {
  const { t } = useI18n();
  const [rows, setRows] = useState<ImportSummary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<{ imports: ImportSummary[] }>("/api/imports").then((payload) => setRows(payload.imports)).catch(() => setError(true));
  }, []);
  if (error) return <ErrorState onRetry={() => window.location.reload()} />;
  if (!rows) return <Loading />;
  return (
    <>
      <PageTitle title={t("imports")}>
        <a className="button" href="/api/template.csv">{t("downloadTemplate")}</a>
        <Link className="button primary" to="/app/imports/new">{t("newImport")}</Link>
      </PageTitle>
      {rows.length === 0 ? <Empty title={t("noImports")} body={t("emptyImportsBody")} /> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("imports")}</caption>
            <thead>
              <tr>
                <th>{t("filename")}</th><th>{t("status")}</th><th>{t("rows")}</th><th>{t("errors")}</th><th>{t("exclusions")}</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.filename}</td>
                  <td>{label(t, `importStatus.${row.status}`)}</td>
                  <td>{row.rowCount}</td>
                  <td>{row.invalidCount}</td>
                  <td>{row.excludedCount}</td>
                  <td><Link to={`/app/imports/${row.id}`}>{t("importDetail")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface UploadResult {
  id: string;
  headers: string[];
  sample: Array<{ header: string; values: string[] }>;
  suggestedMapping: Record<string, string>;
  dataRows: number;
}

interface PreviewResult {
  summary: { dataRows: number; invalidCount: number; excludedCount: number; matchableCount: number };
  previewRows: Array<Record<string, unknown>>;
  issues: Array<{ rowNumber: number; errorCodes: string[]; exclusionCodes: string[]; supplierName: string; invoiceNumber: string }>;
}

export function ImportNewPage({ canWrite }: { canWrite: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [amountLocale, setAmountLocale] = useState("plain");
  const [dateFormat, setDateFormat] = useState("YYYY-MM-DD");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!canWrite) return <p className="note">{t("readOnlyNote")}</p>;

  async function sendFile(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const result = await api<UploadResult>("/api/imports", { method: "POST", body });
      setUpload(result);
      setMapping(result.suggestedMapping);
      setPreview(null);
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function runPreview() {
    if (!upload) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<PreviewResult>(`/api/imports/${upload.id}/preview`, {
        method: "POST",
        body: JSON.stringify({ mapping, amountLocale, dateFormat }),
      });
      setPreview(result);
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!upload) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/imports/${upload.id}/commit`, { method: "POST", body: JSON.stringify({ mapping, amountLocale, dateFormat }) });
      navigate(`/app/imports/${upload.id}`);
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
      setBusy(false);
    }
  }

  return (
    <>
      <PageTitle title={t("newImport")} />
      <form className="card stack" onSubmit={sendFile}>
        <label>
          {t("fileLabel")}
          <input data-testid="csv-file" type="file" accept=".csv,text/csv" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        </label>
        {error ? <p className="error" role="alert">{error}</p> : null}
        <button className="button primary" data-testid="upload-csv" disabled={busy || !file} aria-busy={busy} type="submit">
          {busy && !upload ? t("uploading") : t("upload")}
        </button>
      </form>
      {upload ? (
        <section className="card stack" style={{ marginTop: "0.8rem" }}>
          <h2>{t("fieldMapping")}</h2>
          <p className="hint">{t("mappingHint")}</p>
          {fields.map((field) => (
            <label key={field}>
              {label(t, fieldLabel(field))}
              <select value={mapping[field] ?? ""} onChange={(event) => setMapping({ ...mapping, [field]: event.target.value })}>
                <option value="">{t("ignoreColumn")}</option>
                {upload.headers.map((header) => <option key={header} value={header}>{header}</option>)}
              </select>
            </label>
          ))}
          <label>
            {t("amountLocale")}
            <select value={amountLocale} onChange={(event) => setAmountLocale(event.target.value)}>
              <option value="plain">{t("locale.plain")}</option>
              <option value="en-US">{t("locale.en-US")}</option>
              <option value="eu">{t("locale.eu")}</option>
            </select>
          </label>
          <label>
            {t("dateFormat")}
            <select value={dateFormat} onChange={(event) => setDateFormat(event.target.value)}>
              <option value="YYYY-MM-DD">{t("format.YYYY-MM-DD")}</option>
              <option value="DD/MM/YYYY">{t("format.DD/MM/YYYY")}</option>
              <option value="MM/DD/YYYY">{t("format.MM/DD/YYYY")}</option>
              <option value="DD-MM-YYYY">{t("format.DD-MM-YYYY")}</option>
            </select>
          </label>
          <div className="table-wrap">
            <table>
              <caption>{t("sampleValues")}</caption>
              <tbody>
                {upload.sample.map((column) => (
                  <tr key={column.header}><th>{column.header}</th><td>{column.values.join(" · ")}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="button-row">
            <button className="button" type="button" data-testid="preview-import" disabled={busy} onClick={runPreview}>{busy ? t("previewing") : t("preview")}</button>
            <button className="button primary" type="button" data-testid="commit-import" disabled={busy || !preview} onClick={commit}>{busy ? t("committing") : t("commit")}</button>
          </div>
          <p className="hint">{t("commitHint")}</p>
        </section>
      ) : null}
      {preview ? (
        <section className="card" style={{ marginTop: "0.8rem" }}>
          <h2>{t("previewSummary")}</h2>
          <div className="counts">
            <Count label={t("rows")} value={preview.summary.dataRows} />
            <Count label={t("errors")} value={preview.summary.invalidCount} />
            <Count label={t("exclusions")} value={preview.summary.excludedCount} />
            <Count label={t("matchable")} value={preview.summary.matchableCount} />
          </div>
          <IssueTable issues={preview.issues} />
        </section>
      ) : null}
    </>
  );
}

function fieldLabel(field: string): MessageKey {
  const map: Record<string, MessageKey> = {
    supplier_id: "supplierId",
    supplier_name: "supplier",
    invoice_number: "invoice",
    invoice_date: "date",
    amount: "amount",
    currency: "currency",
    payment_status: "paymentStatus",
    document_kind: "documentKind",
  };
  return map[field] ?? "mappedColumn";
}

function IssueTable({ issues }: { issues: Array<{ rowNumber: number; errorCodes: string[]; exclusionCodes: string[]; supplierName: string; invoiceNumber: string }> }) {
  const { t } = useI18n();
  if (issues.length === 0) return <p>{t("noIssues")}</p>;
  return (
    <div className="table-wrap">
      <table>
        <caption>{t("errors")}</caption>
        <thead><tr><th>{t("row")}</th><th>{t("supplier")}</th><th>{t("invoice")}</th><th>{t("errors")}</th><th>{t("exclusions")}</th></tr></thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.rowNumber}>
              <td>{issue.rowNumber}</td>
              <td>{issue.supplierName}</td>
              <td>{issue.invoiceNumber}</td>
              <td>{issue.errorCodes.map((code) => codeText(t, code)).join(", ")}</td>
              <td>{issue.exclusionCodes.map((code) => codeText(t, code)).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportDetailPage() {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<Record<string, unknown>>(`/api/imports/${id}`).then(setRow).catch(() => setError(true));
  }, [id]);
  if (error) return <ErrorState onRetry={() => window.location.reload()} />;
  if (!row) return <Loading />;
  const issues = Array.isArray(row.issues) ? row.issues as PreviewResult["issues"] : [];
  return (
    <>
      <PageTitle title={t("importDetail")}>
        <Link to="/app/imports">{t("backToImports")}</Link>
        <a className="button" href={`/api/imports/${id}/errors.csv`}>{t("downloadErrors")}</a>
      </PageTitle>
      <div className="card stack">
        <p><strong>{t("filename")}:</strong> {String(row.filename)}</p>
        <p><strong>{t("status")}:</strong> {label(t, `importStatus.${String(row.status)}`)}</p>
        <div className="counts">
          <Count label={t("rows")} value={Number(row.rowCount)} />
          <Count label={t("errors")} value={Number(row.invalidCount)} />
          <Count label={t("exclusions")} value={Number(row.excludedCount)} />
        </div>
        <IssueTable issues={issues} />
      </div>
    </>
  );
}

interface CaseSummary {
  id: string;
  matchType: string;
  currency: string;
  exposureMinor: string;
  recoveredMinor: string;
  confidence: string;
  status: string;
  displaySupplier: string;
  displayInvoice: string;
  memberCount: number;
  updatedAt: string;
}

export function QueuePage() {
  const { t } = useI18n();
  const [status, setStatus] = useState("");
  const [matchType, setMatchType] = useState("");
  const [currency, setCurrency] = useState("");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState({ status: "", matchType: "", currency: "", q: "" });
  const [rows, setRows] = useState<CaseSummary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams();
    if (applied.status) params.set("status", applied.status);
    if (applied.matchType) params.set("matchType", applied.matchType);
    if (applied.currency) params.set("currency", applied.currency);
    if (applied.q) params.set("q", applied.q);
    setRows(null);
    api<{ cases: CaseSummary[] }>(`/api/cases?${params.toString()}`)
      .then((payload) => setRows(payload.cases))
      .catch(() => setError(true));
  }, [applied]);
  if (error) return <ErrorState onRetry={() => setApplied({ ...applied }) } />;
  return (
    <>
      <PageTitle title={t("queue")} />
      <p className="hint">{t("queueHint")}</p>
      <form className="filters" aria-label={t("filterQueue")} onSubmit={(event) => { event.preventDefault(); setApplied({ status, matchType, currency, q }); }}>
        <label>{t("search")}<input data-testid="queue-search" value={q} onChange={(event) => setQ(event.target.value)} /></label>
        <label>{t("status")}
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">{t("all")}</option>
            <option value="open">{t("status.open")}</option>
            <option value="confirmed_for_review">{t("status.confirmed_for_review")}</option>
            <option value="false_positive">{t("status.false_positive")}</option>
          </select>
        </label>
        <label>{t("matchType")}
          <select value={matchType} onChange={(event) => setMatchType(event.target.value)}>
            <option value="">{t("all")}</option>
            <option value="exact">{t("groupType.exact")}</option>
            <option value="proximity">{t("groupType.proximity")}</option>
          </select>
        </label>
        <label>{t("currency")}<input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label>
        <button className="button primary" type="submit">{t("apply")}</button>
      </form>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty title={t("noCases")} body={t("queueHint")} /> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("queue")}</caption>
            <thead>
              <tr><th>{t("supplier")}</th><th>{t("invoice")}</th><th>{t("matchType")}</th><th>{t("exposure")}</th><th>{t("confidence")}</th><th>{t("status")}</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.displaySupplier}</td>
                  <td>{row.displayInvoice}</td>
                  <td>{label(t, `groupType.${row.matchType}`)}</td>
                  <td>{money(row.exposureMinor, row.currency)}</td>
                  <td>{label(t, `confidence.${row.confidence}`)}</td>
                  <td><Pill value={row.status} /></td>
                  <td><Link to={`/app/cases/${row.id}`}>{t("openCase")}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

interface CaseDetail extends CaseSummary {
  reasons: string[];
  members: Array<Record<string, unknown>>;
  decisions: Array<{ id: string; decision: string; comment: string; createdAt: string; actorName: string; recoveredMinor: string | null }>;
}

export function CasePage({ canWrite }: { canWrite: boolean }) {
  const { id = "" } = useParams();
  const { t } = useI18n();
  const [row, setRow] = useState<CaseDetail | null>(null);
  const [error, setError] = useState(false);
  const [comment, setComment] = useState("");
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<CaseDetail>(`/api/cases/${id}`)
      .then((payload) => { if (!cancelled) setRow(payload); })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [id, tick]);

  async function decide(decision: string) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/cases/${id}/decisions`, {
        method: "POST",
        body: JSON.stringify({ decision, comment, recoveredAmount: amount }),
      });
      setComment("");
      setAmount("");
      setMessage(t("saved"));
      setTick((value) => value + 1);
    } catch (caught) {
      setMessage(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <ErrorState onRetry={() => { setError(false); setTick((value) => value + 1); }} />;
  if (!row) return <Loading />;
  return (
    <>
      <PageTitle title={row.displaySupplier || t("openCase")} />
      <p className="note" data-testid="case-notice">{t("caseNotice")}</p>
      <div className="two" style={{ marginTop: "0.8rem" }}>
        <section className="card stack">
          <p><strong>{t("invoice")}:</strong> {row.displayInvoice}</p>
          <p><strong>{t("matchType")}:</strong> {label(t, `groupType.${row.matchType}`)}</p>
          <p><strong>{t("currentStatus")}:</strong> <Pill value={row.status} /></p>
          <p data-testid="case-exposure"><strong>{t("exposure")}:</strong> {money(row.exposureMinor, row.currency)}</p>
          <p><strong>{t("recovery")}:</strong> {row.recoveredMinor === "0" ? t("noRecovery") : money(row.recoveredMinor, row.currency)}</p>
          <p><span className="pill">{label(t, `confidence.${row.confidence}`)}</span> <span className="muted">{t("notFraud")}</span></p>
          <h2>{t("evidence")}</h2>
          <ul>{row.reasons.map((reason) => <li key={reason}>{label(t, `reason.${reason}`)}</li>)}</ul>
        </section>
        <section className="card stack">
          <h2>{t("actions")}</h2>
          {!canWrite ? <p>{t("readOnlyNote")}</p> : (
            <>
              <label>
                {t("comment")}
                <textarea data-testid="decision-comment" value={comment} onChange={(event) => setComment(event.target.value)} required minLength={3} />
              </label>
              <p className="hint">{t("commentHint")}</p>
              <div className="button-row">
                <button className="button" type="button" disabled={busy} onClick={() => decide("confirm_for_review")}>{t("confirmReview")}</button>
                <button className="button" type="button" data-testid="false-positive" disabled={busy} onClick={() => decide("false_positive")}>{t("markFalsePositive")}</button>
                <button className="button" type="button" disabled={busy} onClick={() => decide("reopen")}>{t("reopen")}</button>
              </div>
              {row.matchType === "exact" && row.status !== "false_positive" ? (
                <>
                  <label>
                    {t("recoveryAmount")}
                    <input data-testid="recovery-amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
                  </label>
                  <p className="hint">{t("recoveryHint")}</p>
                  <div className="button-row">
                    <button className="button" type="button" disabled={busy} onClick={() => decide("record_recovery")}>{t("recordRecovery")}</button>
                    <button className="button" type="button" disabled={busy} onClick={() => decide("clear_recovery")}>{t("clearRecovery")}</button>
                  </div>
                </>
              ) : null}
            </>
          )}
          {message ? <p role="status">{message}</p> : null}
          <h2>{t("latestDecisions")}</h2>
          {row.decisions.length === 0 ? <p>{t("noDecisions")}</p> : (
            <ul>{row.decisions.map((decision) => <li key={decision.id}><strong>{decision.actorName}</strong> — {decision.decision}<br />{decision.comment}</li>)}</ul>
          )}
        </section>
      </div>
      <section className="card" style={{ marginTop: "0.8rem" }}>
        <h2>{t("sourceRowsTitle")}</h2>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("sourceRowsTitle")}</caption>
            <thead>
              <tr>
                <th>{t("rowNumber")}</th><th>{t("actions")}</th><th>{t("supplierId")}</th><th>{t("supplier")}</th><th>{t("invoice")}</th>
                <th>{t("originalDate")}</th><th>{t("interpretedDate")}</th><th>{t("originalAmount")}</th><th>{t("currency")}</th><th>{t("paymentStatus")}</th><th>{t("documentKind")}</th>
              </tr>
            </thead>
            <tbody>
              {row.members.map((member) => (
                <tr key={String(member.sourceRowId)}>
                  <td>{String(member.rowNumber)}</td>
                  <td>{member.role === "primary" ? t("primary") : t("extra")}</td>
                  <td>{String(member.supplierId)}</td>
                  <td>{String(member.supplierName)}</td>
                  <td>{String(member.invoiceNumber)}</td>
                  <td>{String(member.invoiceDateRaw)}</td>
                  <td>{String(member.invoiceDate ?? "")}</td>
                  <td>{String(member.amountRaw)}</td>
                  <td>{String(member.currency ?? "")}</td>
                  <td>{String(member.paymentStatus)}</td>
                  <td>{String(member.documentKind)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function AuditPage() {
  const { t } = useI18n();
  const [events, setEvents] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    api<{ events: Array<Record<string, unknown>> }>("/api/audit").then((payload) => setEvents(payload.events)).catch(() => setError(true));
  }, []);
  if (error) return <ErrorState onRetry={() => window.location.reload()} />;
  if (!events) return <Loading />;
  return (
    <>
      <PageTitle title={t("audit")}>
        <a className="button" href="/api/exports/audit.csv">{t("exportAudit")}</a>
      </PageTitle>
      <p className="hint">{t("auditIntro")}</p>
      {events.length === 0 ? <Empty title={t("emptyAudit")} body={t("auditIntro")} /> : (
        <div className="table-wrap">
          <table>
            <caption className="sr-only">{t("audit")}</caption>
            <thead><tr><th>{t("when")}</th><th>{t("action")}</th><th>{t("entity")}</th><th>{t("actor")}</th></tr></thead>
            <tbody>
              {events.map((event) => (
                <tr key={String(event.id)}>
                  <td>{String(event.createdAt)}</td>
                  <td>{label(t, `action.${String(event.action)}`)}</td>
                  <td>{String(event.entityType)}</td>
                  <td>{event.actorUserId ? String(event.actorUserId) : t("none")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function SettingsPage({ session }: { session: SessionPayload }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<{ dateWindowDays: number; amountToleranceMinor: string; maxUploadBytes: number; maxImportRows: number } | null>(null);
  const [members, setMembers] = useState<Array<{ id: string; email: string; name: string; role: string }>>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [windowDays, setWindowDays] = useState(3);
  const [tolerance, setTolerance] = useState("0");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("reviewer");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ dateWindowDays: number; amountToleranceMinor: string; maxUploadBytes: number; maxImportRows: number }>("/api/settings")
      .then((payload) => {
        setSettings(payload);
        setWindowDays(payload.dateWindowDays);
        setTolerance(payload.amountToleranceMinor);
      })
      .catch(() => setError(t("loadError")));
    if (session.role === "owner") {
      api<{ members: Array<{ id: string; email: string; name: string; role: string }> }>("/api/members")
        .then((payload) => setMembers(payload.members))
        .catch(() => undefined);
    }
  }, [session.role, t]);

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/settings", { method: "PATCH", body: JSON.stringify({ dateWindowDays: windowDays, amountToleranceMinor: tolerance }) });
      setMessage(t("saved"));
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function createMember(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/members", { method: "POST", body: JSON.stringify({ name, email, password, role }) });
      setMessage(t("created"));
      setName("");
      setEmail("");
      setPassword("");
      const payload = await api<{ members: typeof members }>("/api/members");
      setMembers(payload.members);
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function resetDemo() {
    setBusy(true);
    try {
      await api("/api/demo/reset", { method: "POST" });
      setMessage(t("demoResetDone"));
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteData(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/workspace/invoice-data/delete", { method: "POST", body: JSON.stringify({ confirm }) });
      setMessage(t("dataDeleted"));
      setConfirm("");
    } catch (caught) {
      setError(errorText(t, caught instanceof ApiError ? caught.code : "request_failed"));
    } finally {
      setBusy(false);
    }
  }

  if (!settings && !error) return <Loading />;
  return (
    <>
      <PageTitle title={t("settings")} />
      <p className="hint">{t("settingsIntro")}</p>
      {error ? <p className="error" role="alert">{error}</p> : null}
      {message ? <p role="status" className="note">{message}</p> : null}
      {settings ? (
        <section className="card">
          <h2>{t("limits")}</h2>
          <p>{t("maxUpload")}: {settings.maxUploadBytes} {t("bytes")}</p>
          <p>{t("maxRows")}: {settings.maxImportRows} {t("rows")}</p>
        </section>
      ) : null}
      {session.demo && session.role !== "read_only" ? (
        <section className="card stack" style={{ marginTop: "0.8rem" }}>
          <h2>{t("resetDemo")}</h2>
          <p>{t("resetDemoHint")}</p>
          <button className="button" type="button" data-testid="reset-demo" disabled={busy} onClick={resetDemo}>{busy ? t("resetting") : t("resetDemo")}</button>
        </section>
      ) : null}
      {session.role === "owner" && !session.demo ? (
        <>
          <form className="card stack" style={{ marginTop: "0.8rem" }} onSubmit={saveSettings}>
            <h2>{t("saveSettings")}</h2>
            <label>{t("dateWindow")}<input type="number" min={0} max={31} value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))} /></label>
            <label>{t("tolerance")}<input value={tolerance} onChange={(event) => setTolerance(event.target.value)} inputMode="numeric" /></label>
            <p className="hint">{t("toleranceHint")}</p>
            <button className="button primary" disabled={busy} type="submit">{t("saveSettings")}</button>
          </form>
          <section className="card" style={{ marginTop: "0.8rem" }}>
            <h2>{t("addMember")}</h2>
            <div className="table-wrap">
              <table>
                <caption className="sr-only">{t("members")}</caption>
                <thead><tr><th>{t("name")}</th><th>{t("email")}</th><th>{t("memberRole")}</th></tr></thead>
                <tbody>{members.map((member) => <tr key={member.id}><td>{member.name}</td><td>{member.email}</td><td>{label(t, `role.${member.role}`)}</td></tr>)}</tbody>
              </table>
            </div>
            <form className="stack" onSubmit={createMember}>
              <label>{t("name")}<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
              <label>{t("email")}<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
              <label>{t("password")}<input required type="password" minLength={12} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
              <p className="hint">{t("passwordRules")}</p>
              <label>{t("memberRole")}
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="reviewer">{t("role.reviewer")}</option>
                  <option value="read_only">{t("role.read_only")}</option>
                  <option value="owner">{t("role.owner")}</option>
                </select>
              </label>
              <button className="button" disabled={busy} type="submit">{t("createMember")}</button>
            </form>
          </section>
          <form className="card stack" style={{ marginTop: "0.8rem" }} onSubmit={deleteData}>
            <h2>{t("deleteData")}</h2>
            <p>{t("deleteHint")}</p>
            <label>{t("deleteConfirm")}<input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" /></label>
            <button className="button danger" disabled={busy} type="submit">{t("deleteButton")}</button>
          </form>
        </>
      ) : null}
    </>
  );
}

export function NotFound() {
  const { t } = useI18n();
  return (
    <Empty title={t("pageNotFound")} body={t("loadError")} action={<Link className="button" to="/app">{t("goOverview")}</Link>} />
  );
}

export function sessionMarker(session: SessionPayload) {
  return <span data-testid="session" data-csrf={currentCsrf() || session.csrfToken} hidden />;
}

function label(t: (key: MessageKey) => string, key: string): string {
  return t(key as MessageKey);
}
