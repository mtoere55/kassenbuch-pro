"use client";

import { formatCurrency, formatDate, todayIso } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { PageKey } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, PageHeader, StatCard } from "../ui";

export function DashboardPage({ onNavigate }: { onNavigate: (page: PageKey) => void }) {
  const { state } = useKassenStore();
  const today = todayIso();
  const todayEntries = state.ledger.filter((entry) => entry.date === today);
  const income = todayEntries
    .filter((entry) => entry.direction === "income")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = todayEntries
    .filter((entry) => entry.direction === "expense")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const cash = todayEntries
    .filter((entry) => entry.direction === "income" && entry.paymentMethod === "cash")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const card = todayEntries
    .filter((entry) => entry.direction === "income" && entry.paymentMethod === "card")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const paypal = todayEntries
    .filter((entry) => entry.direction === "income" && entry.paymentMethod === "paypal")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const inStock = state.devices.filter((device) => device.status === "inStock");
  const reviewTransactions = state.importedTransactions.filter(
    (item) => item.status === "needsReview" || item.status === "new",
  );
  const suspiciousZReports = state.documents.filter(
    (document) =>
      document.type === "zReport" &&
      typeof document.metadata?.difference === "number" &&
      Number(document.metadata.difference) !== 0,
  );

  const quickActions: Array<{ page: PageKey; icon: Parameters<typeof Icon>[0]["name"]; title: string; text: string }> = [
    { page: "sale", icon: "sale", title: "Verkauf", text: "Gerät auswählen und verkaufen" },
    { page: "purchase", icon: "purchase", title: "Gerät ankaufen", text: "IMEI erfassen und Bestand anlegen" },
    { page: "scan", icon: "scan", title: "Beleg scannen", text: "Foto aufnehmen und automatisch auslesen" },
    { page: "customers", icon: "customers", title: "Kunde suchen", text: "Kundenakte und Vorgänge öffnen" },
  ];

  return (
    <div>
      <PageHeader
        title="Guten Tag, Murat"
        subtitle={`${formatDate(today)} · ${state.settings.businessName}`}
      />

      <div className="stat-grid">
        <StatCard label="Umsatz heute" value={formatCurrency(income)} detail={`${todayEntries.filter((entry) => entry.direction === "income").length} Einnahmen`} tone="positive" />
        <StatCard label="Ausgaben heute" value={formatCurrency(expenses)} detail={`${todayEntries.filter((entry) => entry.direction === "expense").length} Ausgaben`} tone="negative" />
        <StatCard label="Ergebnis heute" value={formatCurrency(income - expenses)} detail="Vor weiteren Kosten" tone="blue" />
        <StatCard label="Geräte auf Lager" value={String(inStock.length)} detail={formatCurrency(inStock.reduce((sum, item) => sum + item.purchasePrice, 0)) + " Einkaufswert"} />
      </div>

      <div className="dashboard-columns">
        <Card>
          <div className="card-heading">
            <div>
              <h2>Schnell starten</h2>
              <p>Die häufigsten Vorgänge mit einem Klick.</p>
            </div>
          </div>
          <div className="quick-grid">
            {quickActions.map((action) => (
              <button key={action.page} className="quick-action" onClick={() => onNavigate(action.page)}>
                <span className="quick-icon"><Icon name={action.icon} width={24} height={24} /></span>
                <span><strong>{action.title}</strong><small>{action.text}</small></span>
                <Icon name="arrowRight" width={18} height={18} />
              </button>
            ))}
          </div>
        </Card>

        <Card>
          <div className="card-heading">
            <div>
              <h2>Zahlungsübersicht</h2>
              <p>Heute eingegangene Zahlungen.</p>
            </div>
          </div>
          <div className="payment-list">
            <div><span><i className="payment-dot cash-dot" />Bar</span><strong>{formatCurrency(cash)}</strong></div>
            <div><span><i className="payment-dot card-dot" />Karte</span><strong>{formatCurrency(card)}</strong></div>
            <div><span><i className="payment-dot paypal-dot" />PayPal</span><strong>{formatCurrency(paypal)}</strong></div>
            <div><span><i className="payment-dot bank-dot" />Bank</span><strong>{formatCurrency(Math.max(0, income - cash - card - paypal))}</strong></div>
          </div>
          <Button variant="secondary" onClick={() => onNavigate("ledger")}>Kassenbuch öffnen</Button>
        </Card>
      </div>

      <div className="dashboard-columns lower">
        <Card>
          <div className="card-heading">
            <div>
              <h2>Aufgaben</h2>
              <p>Nur Vorgänge, die deine Aufmerksamkeit brauchen.</p>
            </div>
          </div>
          <div className="task-list">
            {reviewTransactions.length === 0 && suspiciousZReports.length === 0 ? (
              <div className="task-success"><Icon name="check" width={20} height={20} /><span>Alles erledigt. Keine offenen Prüfungen.</span></div>
            ) : null}
            {reviewTransactions.length > 0 ? (
              <button onClick={() => onNavigate("accounts")}>
                <span className="task-icon warning"><Icon name="warning" width={18} height={18} /></span>
                <span><strong>{reviewTransactions.length} Konto-Umsätze prüfen</strong><small>Bank- oder PayPal-Bewegungen ohne sichere Zuordnung.</small></span>
                <Badge tone="warning">Offen</Badge>
              </button>
            ) : null}
            {suspiciousZReports.length > 0 ? (
              <button onClick={() => onNavigate("documents")}>
                <span className="task-icon danger"><Icon name="warning" width={18} height={18} /></span>
                <span><strong>{suspiciousZReports.length} Kassenabweichung prüfen</strong><small>Mindestens ein Tagesabschluss enthält eine Differenz.</small></span>
                <Badge tone="danger">Prüfen</Badge>
              </button>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="card-heading">
            <div>
              <h2>Letzte Vorgänge</h2>
              <p>Aktuelle Buchungen und Belege.</p>
            </div>
          </div>
          <div className="compact-list">
            {state.ledger.slice(0, 5).map((entry) => (
              <div key={entry.id}>
                <span className={`direction-icon ${entry.direction}`}>
                  {entry.direction === "income" ? "+" : entry.direction === "expense" ? "−" : "↔"}
                </span>
                <span><strong>{entry.description}</strong><small>{formatDate(entry.date)} · {entry.paymentMethod}</small></span>
                <strong className={entry.direction === "income" ? "money-positive" : "money-negative"}>
                  {entry.direction === "income" ? "+" : "−"}{formatCurrency(entry.amount)}
                </strong>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
