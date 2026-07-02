"use client";

import { useRef, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { parseTransactionsCsv } from "@/lib/csv";
import { useKassenStore } from "@/lib/store";
import type { ImportedTransaction } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, PageHeader } from "../ui";

export function AccountsPage() {
  const { state, importTransactions, reconcileImportedTransactions } = useKassenStore();
  const [message, setMessage] = useState("");
  const bankInput = useRef<HTMLInputElement>(null);
  const paypalInput = useRef<HTMLInputElement>(null);

  async function handleFile(file: File | undefined, type: "bank" | "paypal") {
    if (!file) return;
    const text = await file.text();
    const transactions = parseTransactionsCsv(text, type);
    const added = importTransactions(transactions);
    setMessage(`${added} neue ${type === "bank" ? "Bank" : "PayPal"}-Umsätze importiert.`);
  }

  function reconcile() {
    const count = reconcileImportedTransactions();
    setMessage(`${count} Umsätze automatisch mit Dokumenten abgeglichen.`);
  }

  const bankCount = state.importedTransactions.filter((item) => item.accountType === "bank").length;
  const paypalCount = state.importedTransactions.filter((item) => item.accountType === "paypal").length;

  return <div>
    <PageHeader title="Bank & PayPal" subtitle="Kontobewegungen importieren, automatisch mit Rechnungen abgleichen und Doppelbuchungen verhindern." actions={<Button onClick={reconcile}>Automatisch abgleichen</Button>} />
    {message ? <div className="alert alert-success">{message}</div> : null}
    <div className="account-cards">
      <Card className="account-card"><div className="account-logo bank"><Icon name="accounts" width={25} height={25} /></div><div><h2>Geschäftskonto</h2><p>PSD2-Adapter ist architektonisch vorbereitet. Bis zur Anbieterfreigabe funktioniert der sichere CSV-Import.</p><div className="account-meta"><Badge tone="info">{bankCount} Umsätze</Badge><Badge tone="warning">API noch nicht verbunden</Badge></div></div><Button variant="secondary" icon="upload" onClick={() => bankInput.current?.click()}>Bank-CSV importieren</Button><input ref={bankInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void handleFile(event.target.files?.[0], "bank")} /></Card>
      <Card className="account-card"><div className="account-logo paypal">P</div><div><h2>PayPal Business</h2><p>Transaktionen, Gebühren und Auszahlungen können nach API-Freigabe direkt synchronisiert werden. CSV funktioniert bereits.</p><div className="account-meta"><Badge tone="info">{paypalCount} Umsätze</Badge><Badge tone="warning">API noch nicht verbunden</Badge></div></div><Button variant="secondary" icon="upload" onClick={() => paypalInput.current?.click()}>PayPal-CSV importieren</Button><input ref={paypalInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => void handleFile(event.target.files?.[0], "paypal")} /></Card>
    </div>
    <Card>
      <div className="card-heading"><div><h2>Kontobewegungen</h2><p>Automatisch zugeordnete und noch zu prüfende Umsätze.</p></div></div>
      {state.importedTransactions.length === 0 ? <EmptyState icon="accounts" title="Noch keine Kontobewegungen" text="Exportiere bei deiner Bank oder PayPal eine CSV-Datei und importiere sie hier." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Konto</th><th>Beschreibung</th><th>Status</th><th>Treffer</th><th className="align-right">Betrag</th></tr></thead><tbody>{state.importedTransactions.map((item) => <TransactionRow key={item.id} item={item} />)}</tbody></table></div>}
    </Card>
    <div className="alert alert-info">Bank- und PayPal-API-Zugangsdaten werden niemals im Quellcode gespeichert. Für eine verkaufbare SaaS-Version werden lizenzierte Open-Banking- und PayPal-Partnerzugänge als getrennte Connectoren angeschlossen.</div>
  </div>;
}

function TransactionRow({ item }: { item: ImportedTransaction }) {
  return <tr><td>{formatDate(item.date)}</td><td><Badge tone={item.accountType === "paypal" ? "info" : "neutral"}>{item.accountType === "paypal" ? "PayPal" : "Bank"}</Badge></td><td><strong>{item.description}</strong><small>{item.externalId || "Keine externe Referenz"}</small></td><td><Badge tone={item.status === "matched" ? "success" : item.status === "needsReview" ? "warning" : "neutral"}>{item.status === "matched" ? "Zugeordnet" : item.status === "needsReview" ? "Prüfen" : item.status === "ignored" ? "Ignoriert" : "Neu"}</Badge></td><td>{item.matchConfidence}%</td><td className={`align-right ${item.amount >= 0 ? "money-positive" : "money-negative"}`}><strong>{item.amount >= 0 ? "+" : "−"}{formatCurrency(Math.abs(item.amount))}</strong></td></tr>;
}
