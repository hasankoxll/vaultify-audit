import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, loadSession, type SessionPayload } from "./api.js";
import { useI18n, type MessageKey } from "./i18n.js";
import {
  AuditPage,
  CasePage,
  DashboardPage,
  DemoPage,
  ImportDetailPage,
  ImportNewPage,
  ImportsPage,
  LoginPage,
  NotFound,
  QueuePage,
  SettingsPage,
  sessionMarker,
} from "./pages.js";

export function App() {
  const { t } = useI18n();
  const [session, setSession] = useState<SessionPayload | null | undefined>(undefined);

  useEffect(() => {
    loadSession().then(setSession).catch(() => setSession(null));
  }, []);

  if (session === undefined) return <p role="status">{t("loading")}</p>;

  return (
    <Routes>
      <Route path="/" element={session ? <Navigate to="/app" replace /> : <LoginPage onSession={setSession} />} />
      <Route path="/demo" element={session?.demo ? <Navigate to="/app" replace /> : <DemoPage onSession={setSession} />} />
      <Route path="/app/*" element={session ? <Shell session={session} onSession={setSession} /> : <Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Shell({ session, onSession }: { session: SessionPayload; onSession: (session: SessionPayload | null) => void }) {
  const { t, theme, toggleTheme, setLocale, locale } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const canWrite = session.role !== "read_only";

  useEffect(() => {
    document.getElementById("page-title")?.focus();
  }, [location.pathname]);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onSession(null);
    navigate("/");
  }

  return (
    <>
      <a className="skip" href="#content">{t("skip")}</a>
      {session.demo ? (
        <div className="banner" data-testid="demo-banner" role="status">
          <strong>{t("demoBanner")}</strong> {t("demoBannerDetail")}
        </div>
      ) : null}
      {sessionMarker(session)}
      <div className="shell">
        <nav className="sidenav" aria-label={t("navLabel")}>
          <NavLink className="brand" to="/app">{t("appName")}</NavLink>
          <NavLink className="navlink" to="/app" end>{t("overview")}</NavLink>
          <NavLink className="navlink" to="/app/imports">{t("imports")}</NavLink>
          <NavLink className="navlink" data-testid="nav-queue" to="/app/queue">{t("queue")}</NavLink>
          <NavLink className="navlink" to="/app/audit">{t("audit")}</NavLink>
          <NavLink className="navlink" to="/app/settings">{t("settings")}</NavLink>
          <div className="nav-spacer" />
          <div className="userbox">
            <div className="muted">{t("workspaceLabel")}</div>
            <strong>{session.workspace.name}</strong>
            <div>{t("signedInAs")} {session.user.name}</div>
            <div className="muted">{t(`role.${session.role}` as MessageKey)}</div>
          </div>
          <button className="button" type="button" data-testid="theme-toggle" aria-pressed={theme === "dark"} onClick={toggleTheme}>
            {theme === "dark" ? t("themeToLight") : t("themeToDark")}
          </button>
          <button className="button" type="button" data-testid="lang-toggle" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
            {locale === "ar" ? t("languageToEnglish") : t("languageToArabic")}
          </button>
          <button className="button" type="button" onClick={logout}>{t("signOut")}</button>
        </nav>
        <main id="content" className="main" aria-busy="false">
          <Routes>
            <Route index element={<DashboardPage />} />
            <Route path="imports" element={<ImportsPage />} />
            <Route path="imports/new" element={<ImportNewPage canWrite={canWrite} />} />
            <Route path="imports/:id" element={<ImportDetailPage />} />
            <Route path="queue" element={<QueuePage />} />
            <Route path="cases/:id" element={<CasePage canWrite={canWrite} />} />
            <Route path="audit" element={<AuditPage />} />
            <Route path="settings" element={<SettingsPage session={session} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
    </>
  );
}
