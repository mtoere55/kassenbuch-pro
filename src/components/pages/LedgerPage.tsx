"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate, todayIso } from "@/lib/accounting";
import {
  buildReviewAccountOptions,
  isKasImportEntry,
  isUnresolvedKasEntry,
  ledgerSourceLabel,
} from "@/lib/kas-review";
import {
  createBookingDraft,
  entryCashEffect,
  type BookingDraft,
  type ManualBookingKind,
} from "@/lib/manual-booking";
import { useKassenStore } from "@/lib/store";
import type { LedgerDirection, LedgerEntry, PaymentMethod } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Select, StatCard } from "../ui";
import { KasEntryReviewModal } from "./KasEntryReviewModal";
import { ManualBookingModal } from "./ManualBookingModal";

const currentMonth = todayIso().slice(0, 7);

export function LedgerPage() {
  const { state } = useKassenStore();
  const [month, setMonth] = useState(currentMonth);
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<"all" | PaymentMethod>("cash");
  const [direction, setDirection] = useState<"all" | LedgerDirection>("all");
  const [view, setView] = useState<"book" | "accounts">("book");
  const [open, setOpen] = useState(false);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selectedKasId, setSelectedKasId] = useState<string>();
  const [draft, setDraft] = useState<BookingDraft>(() => createBookingDraft());
  const [notice, setNotice] = useState("");
  const selectedKasEntry = state.ledger.find((entry) => entry.id === selectedKasId);
  const unresolvedCount = state.ledger.filter(isUnresolvedKasEntry).length;
  const start = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const end = new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
  const sorted = useMemo(
    () => [...state.ledger].sort((a, b) => `${a.date}|${a.createdAt}`.localeCompare(`${b.date}|${b.createdAt}`)),
    [state.ledger],
  );
  const opening = state.settings.openingCash + sorted
    .filter((entry) => entry.date < start)
    .reduce((sum, entry) => sum + entryCashEffect(entry), 0);
  const monthRows = sorted
    .filter((entry) => entry.date >= start && entry.date < end)
    .reduce<Array<{ entry: LedgerEntry; balance: number }>>((rows, entry) => {
      const previous = rows.length ? rows[rows.length - 1].balance : opening;
      rows.push({ entry, balance: previous + entryCashEffect(entry) });
      return rows;
    }, []);
  const rows = monthRows.filter(({ entry }) => {
    const text = `${entry.description} ${entry.category} ${entry.accountCode || ""} ${entry.documentNumber || ""}`.toLowerCase();
    return (
      (payment === "all" || entry.paymentMethod === payment) &&
      (direction === "all" || entry.direction === direction) &&
      (!unresolvedOnly || isUnresolvedKasEntry(entry)) &&
      (!query || text.includes(query.toLowerCase()))
    );
  });
  const visibleEntries = rows.map((row) => row.entry);
  const income = total(visibleEntries, "income");
  const expense = total(visibleEntries, "expense");
  const outputTax = visibleEntries.filter((entry) => entry.direction === "income").reduce((sum, entry) => sum + entry.taxAmount, 0);
  const inputTax = visibleEntries.filter((entry) => entry.direction === "expense").reduce((sum, entry) => sum + entry.taxAmount, 0);
  const ending = opening + monthRows.reduce((sum, row) => sum + entryCashEffect(row.entry), 0);

  function startBooking(kind: ManualBookingKind) {
    setDraft(createBookingDraft(kind));
    setNotice("");
    setOpen(true);
  }

  return <div>
    <PageHeader title="Kassenbuch" subtitle="Monatliches Kassenkonto mit laufendem Saldo, Quittung, Split, Privatvorgang und Umbuchung." actions={<Button icon="plus" onClick={() => startBooking("income")}>Neue Buchung</Button>} />
    {notice ? <div className="alert alert-success">{notice}</div> : null}
    {unresolvedCount ? <div className="alert alert-warning">{unresolvedCount} importierte KAS-Buchung(en) haben noch Konto 0000. Sie wirken bereits auf den Kassenbestand, muessen aber vor dem Steuerabschluss geprueft werden.</div> : null}
    <div className="view-tabs"><button className={view === "book" ? "active" : ""} onClick={() => setView("book")}>Kassenbuch</button><button className={view === "accounts" ? "active" : ""} onClick={() => setView("accounts")}>Kontenplan</button></div>
    {view === "accounts" ? <AccountPlan ledger={state.ledger} /> : <>
      <div className="stat-grid"><StatCard label="Anfangsbestand" value={formatCurrency(opening)} detail={monthLabel(month)} /><StatCard label="Einnahmen" value={formatCurrency(income)} tone="positive" /><StatCard label="Ausgaben" value={formatCurrency(expense)} tone="negative" /><StatCard label="Kassenendbestand" value={formatCurrency(ending)} tone="blue" detail={`USt ${formatCurrency(outputTax)} · VSt ${formatCurrency(inputTax)}`} /></div>
      <Card>
        <div className="booking-shortcuts"><Button variant="secondary" onClick={() => startBooking("income")}>+ Einnahme</Button><Button variant="secondary" onClick={() => startBooking("expense")}>- Ausgabe</Button><Button variant="secondary" onClick={() => startBooking("transfer")}>Umbuchung</Button><Button variant="secondary" onClick={() => startBooking("private")}>Privat</Button>{unresolvedCount ? <Button variant={unresolvedOnly ? "primary" : "secondary"} onClick={() => setUnresolvedOnly((value) => !value)}>{unresolvedOnly ? "Alle anzeigen" : `Nur ungeklart (${unresolvedCount})`}</Button> : null}</div>
        <div className="toolbar ledger-toolbar"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><div className="search-box"><Icon name="search" width={18} height={18} /><Input placeholder="Text, Konto oder Beleg" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="all">Alle Vorgange</option><option value="income">Einnahmen</option><option value="expense">Ausgaben</option><option value="transfer">Umbuchung / Privat</option></Select><Select value={payment} onChange={(event) => setPayment(event.target.value as typeof payment)}><option value="cash">Kasse / Bar</option><option value="all">Alle Zahlungsarten</option><option value="card">Karte</option><option value="bank">Bank</option><option value="paypal">PayPal</option></Select></div>
        {rows.length ? <div className="table-wrap"><table className="data-table cashbook-table"><thead><tr><th>Datum</th><th>Beleg</th><th>Einnahmen</th><th>Ausgaben</th><th>MwSt.</th><th>USt</th><th>VSt</th><th>Ein. Netto</th><th>Aus. Netto</th><th>Saldo</th><th>Konto</th><th>Text</th></tr></thead><tbody>{rows.map(({ entry, balance }) => { const isIncome = entry.direction === "income"; const isExpense = entry.direction === "expense"; const effect = entryCashEffect(entry); const unresolved = isUnresolvedKasEntry(entry); return <tr key={entry.id}><td>{formatDate(entry.date)}</td><td><strong>{entry.documentNumber || "-"}</strong>{entry.attachmentDataUrl ? <small>Beleg gespeichert</small> : null}</td><td className="money-positive">{isIncome ? formatCurrency(entry.amount) : ""}</td><td className="money-negative">{isExpense ? formatCurrency(entry.amount) : entry.direction === "transfer" && effect < 0 ? formatCurrency(Math.abs(effect)) : ""}</td><td>{entry.taxMode === "differential" ? "25a" : entry.taxRate ? `${entry.taxRate} %` : "-"}</td><td>{isIncome && entry.taxAmount ? formatCurrency(entry.taxAmount) : ""}</td><td>{isExpense && entry.taxAmount ? formatCurrency(entry.taxAmount) : ""}</td><td>{isIncome ? formatCurrency(entry.netAmount ?? entry.amount - entry.taxAmount) : ""}</td><td>{isExpense ? formatCurrency(entry.netAmount ?? entry.amount - entry.taxAmount) : ""}</td><td><strong>{formatCurrency(balance)}</strong></td><td><strong>{entry.accountCode || "-"}</strong><small>{entry.category.split("·").slice(1).join("·").trim() || entry.category}</small></td><td><strong>{entry.description}</strong><small>{entry.direction === "transfer" ? transferLabel(entry) : `${paymentLabel(entry.paymentMethod)} · ${ledgerSourceLabel(entry)}`}</small>{isKasImportEntry(entry) ? <span className="document-actions"><Badge tone={unresolved ? "warning" : "success"}>{unresolved ? "Ungeklart" : "Gepruft"}</Badge><Button variant="secondary" onClick={() => setSelectedKasId(entry.id)}>Prufen</Button></span> : null}</td></tr>; })}</tbody><tfoot><tr><td colSpan={2}><strong>Gesamt {monthLabel(month)}</strong></td><td>{formatCurrency(income)}</td><td>{formatCurrency(expense)}</td><td /><td>{formatCurrency(outputTax)}</td><td>{formatCurrency(inputTax)}</td><td>{formatCurrency(income - outputTax)}</td><td>{formatCurrency(expense - inputTax)}</td><td><strong>{formatCurrency(ending)}</strong></td><td colSpan={2} /></tr></tfoot></table></div> : <EmptyState icon="ledger" title="Keine Buchungen gefunden" text="Automatische, importierte und manuelle Kassenvorgange erscheinen hier." action={<Button onClick={() => startBooking("income")}>Buchung erfassen</Button>} />}
      </Card>
    </>}
    <ManualBookingModal open={open} draft={draft} setDraft={setDraft} onClose={() => setOpen(false)} onSaved={setNotice} />
    <KasEntryReviewModal entry={selectedKasEntry} onClose={() => setSelectedKasId(undefined)} onSaved={setNotice} />
  </div>;
}

function AccountPlan({ ledger }: { ledger: LedgerEntry[] }) { const accounts = buildReviewAccountOptions(ledger); return <Card><div className="card-heading"><div><h2>Kontenplan</h2><p>Voreingestellte und aus KAS-Backups uebernommene Konten.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Nummer</th><th>Bezeichnung</th><th>Typ</th><th>MwSt.</th></tr></thead><tbody>{accounts.map((item) => <tr key={item.code}><td><strong>{item.code}</strong></td><td>{item.label}</td><td><Badge>{item.side === "in" ? "Einnahmen" : item.side === "out" ? "Ausgaben" : "Neutral"}</Badge></td><td>{item.vat ? `${item.vat} %` : "-"}</td></tr>)}</tbody></table></div></Card>; }
function total(entries: Array<{ direction: LedgerDirection; amount: number }>, direction: LedgerDirection) { return entries.filter((entry) => entry.direction === direction).reduce((sum, entry) => sum + entry.amount, 0); }
function paymentLabel(method: PaymentMethod) { return ({ cash: "Bar", card: "Karte", bank: "Bank", paypal: "PayPal" } as const)[method]; }
function transferLabel(entry: { manualKind?: ManualBookingKind; cashChange?: number }) { return entry.manualKind === "private" ? entry.cashChange && entry.cashChange > 0 ? "Privateinlage" : "Privatentnahme" : entry.cashChange && entry.cashChange > 0 ? "Bank an Kasse" : "Kasse an Bank"; }
function monthLabel(month: string) { const [year, number] = month.split("-").map(Number); return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(year, number - 1, 1)); }
