import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import { App } from "./App.js";
import { I18nProvider } from "./i18n.js";
import "./styles.css";

const savedTheme = localStorage.getItem("vaultify-theme");
if (savedTheme === "light" || savedTheme === "dark") document.documentElement.dataset.theme = savedTheme;
else if (window.matchMedia("(prefers-color-scheme: dark)").matches) document.documentElement.dataset.theme = "dark";
if (localStorage.getItem("vaultify-locale") === "ar") {
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
);
