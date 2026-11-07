import { Link } from "react-router-dom";
import { currencyDigits } from "../domain/currencies.js";
import { formatMinor } from "../domain/money.js";
import type { MoneyTotal } from "./api.js";
import { useI18n, type MessageKey } from "./i18n.js";

export function money(minor: string, currency: string): string {
  const digits = currencyDigits(currency) ?? 2;
  return `${currency} ${formatMinor(BigInt(minor), digits)}`;
}

export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1 id="page-title" tabIndex={-1}>
        {title}
      </h1>
      {children ? <div className="button-row">{children}</div> : null}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return (
    <p role="status" aria-live="polite">
      {t("loading")}
    </p>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="error" role="alert">
      <p>{t("loadError")}</p>
      <button className="button" type="button" onClick={onRetry}>
        {t("retry")}
      </button>
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="card stack">
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      {action}
    </div>
  );
}

export function MoneyList({ items, testId, empty }: { items: MoneyTotal[]; testId: string; empty: string }) {
  if (items.length === 0) return <p data-testid={testId}>{empty}</p>;
  return (
    <ul className="list" data-testid={testId}>
      {items.map((item) => (
        <li key={item.currency}>{money(item.minor, item.currency)}</li>
      ))}
    </ul>
  );
}

export function Pill({ value }: { value: string }) {
  const { t } = useI18n();
  const key = `status.${value}` as MessageKey;
  const label = t(key) === key ? value : t(key);
  const tone = value === "false_positive" ? "ok" : value === "confirmed_for_review" ? "warn" : "";
  return <span className={`pill ${tone}`}>{label}</span>;
}

export function codeText(t: (key: MessageKey) => string, code: string): string {
  const exact = `code.${code}` as MessageKey;
  if (t(exact) !== exact) return t(exact);
  const prefix = `code.${code.split(":")[0]}` as MessageKey;
  if (t(prefix) !== prefix) return t(prefix);
  return code;
}

export function errorText(t: (key: MessageKey) => string, code: string): string {
  const key = `error.${code}` as MessageKey;
  return t(key) === key ? t("error.request_failed") : t(key);
}

export function TextLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link className="button" to={to}>
      {children}
    </Link>
  );
}
