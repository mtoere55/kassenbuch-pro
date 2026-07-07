"use client";

import { useRef, useState } from "react";
import {
  closeServiceAccess,
  requestServiceAccess,
  useServiceAccess,
} from "@/lib/bookkeeping-rules";
import { pageLabel } from "@/lib/i18n";
import { useKassenStore } from "@/lib/store";
import type { PageKey } from "@/lib/types";
import { Icon, type IconName } from "./Icon";
import { AccountsPage } from "./pages/AccountsPage";
import { CustomersPage } from "./pages/CustomersPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { LedgerImportPage } from "./pages/LedgerImportPage";
import { PurchasePage } from "./pages/PurchasePage";
import { SalePage } from "./pages/SalePage";
import { ScannerPage } from "./pages/ScannerPage";
import { SettingsPage } from "./pages/SettingsPage";

const mainNav: Array<{ key: PageKey; icon: IconName }> = [
  { key: "dashboard", icon: "home" },
  { key: "sale", icon: "sale" },
  { key: "purchase", icon: "purchase" },
  { key: "scan", icon: "scan" },
  { key: "customers", icon: "customers" },
  { key: "devices", icon: "devices" },
  { key: "documents", icon: "documents" },
  { key: "ledger", icon: "ledger" },
  { key: "accounts", icon: "accounts" },
];

export function AppShell() {
  const { state, hydrated } = useKassenStore();
  const { open: serviceOpen } = useServiceAccess();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const secretClicks = useRef({ count: 0, lastAt: 0 });
  const language = state.settings.language;

  function navigate(next: PageKey) {
    setPage(next);
    setMobileOpen(false);
  }

  function handleSecretAccess() {
    const now = Date.now();
    if (now - secretClicks.current.lastAt > 2500) secretClicks.current.count = 0;
    secretClicks.current.lastAt = now;
    secretClicks.current.count += 1;
    if (secretClicks.current.count < 5) return;
    secretClicks.current.count = 0;
    if (serviceOpen) {
      closeServiceAccess();
      return;
    }
    if (requestServiceAccess()) setPage("settings");
  }

  if (!hydrated) return <div className="loading-screen"><div className="brand-mark">K</div><p>Kassenbuch Pro wird geladen …</p></div>;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
        <div className="brand">
          <button className="brand-mark" type="button" onClick={handleSecretAccess} aria-label="Kassenbuch Pro">K</button>
          <div><strong>Kassenbuch Pro</strong><span>Handel & Buchhaltung</span></div>
        </div>
        <nav>
          {mainNav.map((item) => <button key={item.key} className={page === item.key ? "active" : ""} onClick={() => navigate(item.key)}><Icon name={item.icon} width={20} height={20} /><span>{pageLabel(language, item.key)}</span></button>)}
        </nav>
        <div className="sidebar-bottom"><button className={page === "settings" ? "active" : ""} onClick={() => navigate("settings")}><Icon name="settings" width={20} height={20} /><span>{pageLabel(language, "settings")}</span></button><div className="business-chip"><div>{state.settings.businessName.slice(0, 1).toUpperCase()}</div><span><strong>{state.settings.businessName}</strong><small>{serviceOpen ? "Servicezugang offen" : "Lokale Prototyp-Version"}</small></span></div></div>
      </aside>
      {mobileOpen ? <button className="sidebar-overlay" aria-label="Menü schließen" onClick={() => setMobileOpen(false)} /> : null}
      <main className="main-area">
        <div className="mobile-topbar"><button className="icon-button" onClick={() => setMobileOpen(true)}><Icon name="menu" width={22} height={22} /></button><strong>Kassenbuch Pro</strong><span /></div>
        <div className="content">{renderPage(page, navigate)}</div>
      </main>
    </div>
  );
}

function renderPage(page: PageKey, navigate: (page: PageKey) => void) {
  switch (page) {
    case "dashboard": return <DashboardPage onNavigate={navigate} />;
    case "sale": return <SalePage />;
    case "purchase": return <PurchasePage />;
    case "scan": return <ScannerPage />;
    case "customers": return <CustomersPage />;
    case "devices": return <DevicesPage />;
    case "documents": return <DocumentsPage />;
    case "ledger": return <LedgerImportPage />;
    case "accounts": return <AccountsPage />;
    case "settings": return <SettingsPage />;
  }
}
