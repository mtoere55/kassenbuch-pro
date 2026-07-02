"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { LedgerDirection, PaymentMethod } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Card, EmptyState, Input, PageHeader, Select, StatCard } from "../ui";

export function LedgerPage() {
  const { state } = useKassenStore();
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<"all" | LedgerDirection>("all");
  const [payment, setPayment] = useState<"all" | PaymentMethod>("all");
  const filtered = useMemo(() => state.ledger.filter((entry) => {
    const text = `${entry.description} ${entry.category}`.toLowerCase();
    return (direction === "all" || entry.direction === direction) && (payment === "all" || entry.paymentMethod === payment) && (!query.trim() || text.includes(query.toLowerCase()));
  }), [direction, payment, query, state.ledger]);
  const income = filtered.filter((entry) => entry.direction === "income").reduce((sum, entry) => sum + entry.amount, 0);
  const expenses = filtered.filter((entry) => entry.direction === "expense").reduce((sum, entry) => sum + entry.amount, 0);
  const vat = filtered.reduce((sum, entry) => sum + entry.taxAmount, 0);
  const cashBalance = state.settings.openingCash + state.ledger.filter((entry) => entry.paymentMethod === "cash").reduce((sum, entry) => sum + (entry.direction === "income" ? entry.amount : entry.direction === "expense" ? -entry.amount : 0), 0);

  return <div>
    <PageHeader title="Kassenbuch" subtitle="Einnahmen und Ausgaben aus allen Modulen – ohne doppelte Erfassung." />
    <div className="stat-grid"><StatCard label="Einnahmen" value={formatCurrency(income)} tone="positive" /><StatCard label="Ausgaben" value={formatCurrency(expenses)} tone="negative" /><StatCard label="Saldo" value={formatCurrency(income - expenses)} tone="blue" /><StatCard label="Rechnerischer Kassenbestand" value={formatCurrency(cashBalance)} detail={`Startbestand ${formatCurrency(state.settings.openingCash)}`} /></div>
    <Card>
      <div className="toolbar"><div className="search-box"><Icon name="search" width={18} height={18} /><Input placeholder="Beschreibung oder Kategorie" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={direction} onChange={(event) => setDirection(event.target.value as "all" | LedgerDirection)}><option value="all">Alle Buchungen</option><option value="income">Einnahmen</option><option value="expense">Ausgaben</option><option value="transfer">Umbuchungen</option></Select><Select value={payment} onChange={(event) => setPayment(event.target.value as "all" | PaymentMethod)}><option value="all">Alle Zahlungsarten</option><option value="cash">Bar</option><option value="card">Karte</option><option value="bank">Bank</option><option value="paypal">PayPal</option></Select></div>
      {filtered.length === 0 ? <EmptyState icon="ledger" title="Keine Buchungen gefunden" text="Verkäufe, Ankäufe und gescannte Rechnungen erscheinen automatisch hier." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Datum</th><th>Vorgang</th><th>Zahlung</th><th>Steuer</th><th>Status</th><th className="align-right">Betrag</th></tr></thead><tbody>{filtered.map((entry) => <tr key={entry.id}><td>{formatDate(entry.date)}</td><td><strong>{entry.description}</strong><small>{entry.category} · Quelle: {entry.source}</small></td><td><Badge>{paymentLabel(entry.paymentMethod)}</Badge></td><td><span>{formatCurrency(entry.taxAmount)}</span><small>{entry.taxMode === "differential" ? "§25a" : `${entry.taxRate} %`}</small></td><td><Badge tone={entry.reconciled ? "success" : "warning"}>{entry.reconciled ? "Abgeglichen" : "Offen"}</Badge></td><td className={`align-right ${entry.direction === "income" ? "money-positive" : entry.direction === "expense" ? "money-negative" : ""}`}><strong>{entry.direction === "income" ? "+" : entry.direction === "expense" ? "−" : ""}{formatCurrency(entry.amount)}</strong></td></tr>)}</tbody><tfoot><tr><td colSpan={3}><strong>Gefilterte Summe</strong></td><td>{formatCurrency(vat)} Steuer</td><td /><td className="align-right"><strong>{formatCurrency(income - expenses)}</strong></td></tr></tfoot></table></div>}
    </Card>
  </div>;
}

function paymentLabel(method: PaymentMethod) { return ({ cash: "Bar", card: "Karte", bank: "Bank", paypal: "PayPal" } as const)[method]; }
