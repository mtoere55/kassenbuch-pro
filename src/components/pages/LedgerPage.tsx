"use client";

import { useMemo, useState } from "react";
import { getBookingCategory } from "@/lib/accounts";
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
import { LedgerEntryEditModal } from "./LedgerEntryEditModal";
import { ManualBookingModal } from "./ManualBookingModal";

const currentMonth = todayIso().slice(0, 7);

type PrintMode = "normal" | "receipts";

export function LedgerPage() {
  const { state } = useKassenStore();
  const [month, setMonth] = useState(currentMonth);
  const [query, setQuery] = useState("");
  const [payment, setPayment] = useState<"all" | PaymentMethod>("cash");
  const [direction, setDirection] = useState<"all" | LedgerDirection>("all");
  const [view, setView] = useState<"book" | "accounts">("book");
  const [open, setOpen] = useState(false);
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const [selectedEntryId, setSelectedEntryId] = useState<string>();
  const [draft, setDraft] = useState<BookingDraft>(() => createBookingDraft());
  const [notice, setNotice] = useState("");
  const [printMode, setPrintMode] = useState<PrintMode>("normal");

  const selectedEntry = state.ledger.find((entry) => entry.id === selectedEntryId);
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
    const text = `${entry.description} ${entry.category} ${entry.accountCode || ""} ${entry.counterAccountCode || ""} ${entry.documentNumber || ""}`.toLowerCase();
    return (
      (payment === "all" || entry.paymentMethod === payment) &&
      (direction === "all" || entry.direction === direction) &&
      (!unresolvedOnly || isUnresolvedKasEntry(entry)) &&
      (!query || text.includes(query.toLowerCase()))
    );
  });
  const visibleEntries = rows.map((row) => row.entry);
  const cashIncome = roundMoney(visibleEntries.reduce((sum, entry) => sum + Math.max(0, entryCashEffect(entry)), 0));
  const cashExpense = roundMoney(visibleEntries.reduce((sum, entry) => sum + Math.max(0, -entryCashEffect(entry)), 0));
  const tradeIncome = total(visibleEntries, "income");
  const tradeExpense = total(visibleEntries, "expense");
  const outputTax = visibleEntries.filter((entry) => entry.direction === "income").reduce((sum, entry) => sum + entry.taxAmount, 0);
  const inputTax = visibleEntries.filter((entry) => entry.direction === "expense").reduce((sum, entry) => sum + entry.taxAmount, 0);
  const ending = opening + monthRows.reduce((sum, row) => sum + entryCashEffect(row.entry), 0);

  function startBooking(kind: ManualBookingKind) {
    setDraft(createBookingDraft(kind));
    setNotice("");
    setOpen(true);
  }

  function printReport(mode: PrintMode) {
    setPrintMode(mode);
    document.body.classList.add("ledger-printing");
    const cleanup = () => document.body.classList.remove("ledger-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => window.print(), 80);
    window.setTimeout(cleanup, 1500);
  }

  function exportCsv() {
    const header = ["Datum", "Beleg", "Einnahmen", "Ausgaben", "MwSt", "USt", "VSt", "Ein Netto", "Aus Netto", "Saldo", "Konto", "Text"];
    const csvRows = [header, ...rows.map(({ entry, balance }) => {
      const effect = entryCashEffect(entry);
      const isIncome = entry.direction === "income";
      const isExpense = entry.direction === "expense";
      return [
        entry.date,
        entry.documentNumber || "",
        effect > 0 ? euroNumber(effect) : "",
        effect < 0 ? euroNumber(Math.abs(effect)) : "",
        entry.taxRate ? `${entry.taxRate} %` : "",
        isIncome && entry.taxAmount ? euroNumber(entry.taxAmount) : "",
        isExpense && entry.taxAmount ? euroNumber(entry.taxAmount) : "",
        isIncome ? euroNumber(entry.netAmount ?? entry.amount - entry.taxAmount) : "",
        isExpense ? euroNumber(entry.netAmount ?? entry.amount - entry.taxAmount) : "",
        euroNumber(balance),
        displayAccountCode(entry),
        entry.description,
      ];
    })];
    const csv = csvRows.map((line) => line.map(quoteCsv).join(";")).join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `Kassenbuch_${month}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <div>
    <PageHeader
      title="Kassenbuch"
      subtitle="Monatliches Kassenkonto mit laufendem Saldo, sauberem Druck, CSV-Ausgabe und anklickbarer Buchungskarte."
      actions={<div className="cashbook-actions"><Button icon="plus" onClick={() => startBooking("income")}>Neue Buchung</Button><Button variant="secondary" icon="print" onClick={() => printReport("normal")}>Drucken</Button><Button variant="secondary" icon="print" onClick={() => printReport("receipts")}>Drucken mit Belegen</Button><Button variant="secondary" icon="download" onClick={exportCsv}>CSV-Datei</Button></div>}
    />
    {notice ? <div className="alert alert-success">{notice}</div> : null}
    {unresolvedCount ? <div className="alert alert-warning">{unresolvedCount} importierte KAS-Buchung(en) haben noch Konto 0000. Zur Kontrolle die Zeile anklicken und im Bearbeiten-Fenster korrigieren.</div> : null}
    <div className="view-tabs"><button className={view === "book" ? "active" : ""} onClick={() => setView("book")}>Kassenbuch</button><button className={view === "accounts" ? "active" : ""} onClick={() => setView("accounts")}>Kontenplan</button></div>
    {view === "accounts" ? <AccountPlan ledger={state.ledger} /> : <>
      <div className="stat-grid"><StatCard label="Anfangsbestand" value={formatCurrency(opening)} detail={monthLabel(month)} /><StatCard label="Kasseneinnahmen" value={formatCurrency(cashIncome)} tone="positive" /><StatCard label="Kassenausgaben" value={formatCurrency(cashExpense)} tone="negative" /><StatCard label="Kassenendbestand" value={formatCurrency(ending)} tone="blue" detail={`USt ${formatCurrency(outputTax)} · VSt ${formatCurrency(inputTax)}`} /></div>
      <Card>
        <div className="booking-shortcuts"><Button variant="secondary" onClick={() => startBooking("income")}>+ Einnahme</Button><Button variant="secondary" onClick={() => startBooking("expense")}>- Ausgabe</Button><Button variant="secondary" onClick={() => startBooking("transfer")}>Umbuchung</Button><Button variant="secondary" onClick={() => startBooking("private")}>Privat</Button>{unresolvedCount ? <Button variant={unresolvedOnly ? "primary" : "secondary"} onClick={() => setUnresolvedOnly((value) => !value)}>{unresolvedOnly ? "Alle anzeigen" : `Nur ungeklart (${unresolvedCount})`}</Button> : null}</div>
        <div className="toolbar ledger-toolbar"><Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /><div className="search-box"><Icon name="search" width={18} height={18} /><Input placeholder="Text, Konto oder Beleg" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={direction} onChange={(event) => setDirection(event.target.value as typeof direction)}><option value="all">Alle Vorgange</option><option value="income">Einnahmen</option><option value="expense">Ausgaben</option><option value="transfer">Umbuchung / Fremdgeld</option></Select><Select value={payment} onChange={(event) => setPayment(event.target.value as typeof payment)}><option value="cash">Kasse / Bar</option><option value="all">Alle Zahlungsarten</option><option value="card">Karte</option><option value="bank">Bank</option><option value="paypal">PayPal</option></Select></div>
        {rows.length ? <div className="table-wrap"><table className="data-table cashbook-table"><thead><tr><th>Datum</th><th>Beleg</th><th>Einnahmen</th><th>Ausgaben</th><th>MwSt.</th><th>USt</th><th>VSt</th><th>Ein. Netto</th><th>Aus. Netto</th><th>Saldo</th><th>Konto</th><th>Text</th></tr></thead><tbody>{rows.map(({ entry, balance }) => {
          const isIncome = entry.direction === "income";
          const isExpense = entry.direction === "expense";
          const effect = entryCashEffect(entry);
          const unresolved = isUnresolvedKasEntry(entry);
          return <tr key={entry.id} className="cashbook-row" tabIndex={0} onClick={() => setSelectedEntryId(entry.id)} onKeyDown={(event) => { if (event.key === "Enter") setSelectedEntryId(entry.id); }}><td>{formatDate(entry.date)}</td><td><strong>{entry.documentNumber || "-"}</strong>{entry.attachmentDataUrl ? <small>Beleg gespeichert</small> : null}</td><td className="money-positive">{effect > 0 ? formatCurrency(effect) : ""}</td><td className="money-negative">{effect < 0 ? formatCurrency(Math.abs(effect)) : ""}</td><td>{entry.taxMode === "differential" ? "25a" : entry.taxRate ? `${entry.taxRate} %` : "-"}</td><td>{isIncome && entry.taxAmount ? formatCurrency(entry.taxAmount) : ""}</td><td>{isExpense && entry.taxAmount ? formatCurrency(entry.taxAmount) : ""}</td><td>{isIncome ? formatCurrency(entry.netAmount ?? entry.amount - entry.taxAmount) : ""}</td><td>{isExpense ? formatCurrency(entry.netAmount ?? entry.amount - entry.taxAmount) : ""}</td><td><strong>{formatCurrency(balance)}</strong></td><td><strong>{displayAccountCode(entry)}</strong><small>{displayAccountLabel(entry)}</small></td><td><strong>{entry.description}</strong><small>{entry.direction === "transfer" ? transferLabel(entry) : `${paymentLabel(entry.paymentMethod)} · ${ledgerSourceLabel(entry)}`}</small>{isKasImportEntry(entry) ? <span className="document-actions"><Badge tone={unresolved ? "warning" : "success"}>{unresolved ? "Offen" : "OK"}</Badge></span> : null}</td></tr>;
        })}</tbody><tfoot><tr><td colSpan={2}><strong>Gesamt {monthLabel(month)}</strong></td><td>{formatCurrency(cashIncome)}</td><td>{formatCurrency(cashExpense)}</td><td /><td>{formatCurrency(outputTax)}</td><td>{formatCurrency(inputTax)}</td><td>{formatCurrency(tradeIncome - outputTax)}</td><td>{formatCurrency(tradeExpense - inputTax)}</td><td><strong>{formatCurrency(ending)}</strong></td><td colSpan={2} /></tr></tfoot></table></div> : <EmptyState icon="ledger" title="Keine Buchungen gefunden" text="Automatische, importierte und manuelle Kassenvorgange erscheinen hier." action={<Button onClick={() => startBooking("income")}>Buchung erfassen</Button>} />}
      </Card>
    </>}
    <LedgerPrintDocument rows={rows} month={month} opening={opening} ending={ending} cashIncome={cashIncome} cashExpense={cashExpense} outputTax={outputTax} inputTax={inputTax} settings={state.settings} includeReceipts={printMode === "receipts"} />
    <ManualBookingModal open={open} draft={draft} setDraft={setDraft} onClose={() => setOpen(false)} onSaved={setNotice} />
    <LedgerEntryEditModal entry={selectedEntry} onClose={() => setSelectedEntryId(undefined)} onSaved={setNotice} />
  </div>;
}

function LedgerPrintDocument({ rows, month, opening, ending, cashIncome, cashExpense, outputTax, inputTax, settings, includeReceipts }: { rows: Array<{ entry: LedgerEntry; balance: number }>; month: string; opening: number; ending: number; cashIncome: number; cashExpense: number; outputTax: number; inputTax: number; settings: { businessName: string; ownerName: string; street: string; postalCode: string; city: string; taxNumber: string }; includeReceipts: boolean }) {
  return <div className="ledger-print-source"><div className="ledger-print-document"><header className="ledger-print-head"><div><h1>Kassenbuch</h1><p>{monthLabel(month)}</p></div><div><strong>{settings.businessName}</strong><span>{settings.ownerName}</span><span>{settings.street}</span><span>{settings.postalCode} {settings.city}</span>{settings.taxNumber ? <span>Steuernr. {settings.taxNumber}</span> : null}</div></header><section className="ledger-print-summary"><div><span>Anfangsbestand</span><strong>{formatCurrency(opening)}</strong></div><div><span>Kasseneinnahmen</span><strong>{formatCurrency(cashIncome)}</strong></div><div><span>Kassenausgaben</span><strong>{formatCurrency(cashExpense)}</strong></div><div><span>Kassenendbestand</span><strong>{formatCurrency(ending)}</strong></div><div><span>USt</span><strong>{formatCurrency(outputTax)}</strong></div><div><span>VSt</span><strong>{formatCurrency(inputTax)}</strong></div></section><table className="ledger-print-table"><thead><tr><th>Datum</th><th>Beleg</th><th>Einnahmen</th><th>Ausgaben</th><th>MwSt.</th><th>USt</th><th>VSt</th><th>Saldo</th><th>Konto</th><th>Text</th></tr></thead><tbody>{rows.map(({ entry, balance }) => { const effect = entryCashEffect(entry); const isIncome = entry.direction === "income"; const isExpense = entry.direction === "expense"; return <tr key={entry.id}><td>{formatDate(entry.date)}</td><td>{entry.documentNumber || "-"}{includeReceipts && entry.attachmentFileName ? <small>{entry.attachmentFileName}</small> : null}</td><td>{effect > 0 ? formatCurrency(effect) : ""}</td><td>{effect < 0 ? formatCurrency(Math.abs(effect)) : ""}</td><td>{entry.taxMode === "differential" ? "25a" : entry.taxRate ? `${entry.taxRate} %` : "-"}</td><td>{isIncome && entry.taxAmount ? formatCurrency(entry.taxAmount) : ""}</td><td>{isExpense && entry.taxAmount ? formatCurrency(entry.taxAmount) : ""}</td><td>{formatCurrency(balance)}</td><td>{displayAccountCode(entry)}<small>{displayAccountLabel(entry)}</small></td><td>{entry.description}<small>{includeReceipts ? entry.note || "" : ""}</small></td></tr>; })}</tbody></table></div></div>;
}

function AccountPlan({ ledger }: { ledger: LedgerEntry[] }) { const accounts = buildReviewAccountOptions(ledger); return <Card><div className="card-heading"><div><h2>Kontenplan</h2><p>Voreingestellte und aus KAS-Backups uebernommene Konten.</p></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Nummer</th><th>Bezeichnung</th><th>Typ</th><th>MwSt.</th></tr></thead><tbody>{accounts.map((item) => <tr key={item.code}><td><strong>{item.code}</strong></td><td>{item.label}</td><td><Badge>{item.side === "in" ? "Einnahmen" : item.side === "out" ? "Ausgaben" : "Neutral"}</Badge></td><td>{item.vat ? `${item.vat} %` : "-"}</td></tr>)}</tbody></table></div></Card>; }
function total(entries: Array<{ direction: LedgerDirection; amount: number }>, direction: LedgerDirection) { return entries.filter((entry) => entry.direction === direction).reduce((sum, entry) => sum + entry.amount, 0); }
function paymentLabel(method: PaymentMethod) { return ({ cash: "Bar", card: "Karte", bank: "Bank", paypal: "PayPal" } as const)[method]; }
function transferLabel(entry: LedgerEntry) { if (entry.source === "unitelImport" && entry.sourceId?.startsWith("unitel-sales:")) return `UniTel Fremdgeld · ${paymentLabel(entry.paymentMethod)}`; if (entry.source === "prifotoImport" && entry.sourceId?.startsWith("prifoto-sales:")) return `Prifoto Clearing · ${paymentLabel(entry.paymentMethod)}`; return entry.manualKind === "private" ? entry.cashChange && entry.cashChange > 0 ? "Privateinlage" : "Privatentnahme" : entry.cashChange && entry.cashChange > 0 ? "Bank an Kasse" : "Kasse an Bank"; }
function monthLabel(month: string) { const [year, number] = month.split("-").map(Number); return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(year, number - 1, 1)); }
function roundMoney(value: number) { return Math.round((value + Number.EPSILON) * 100) / 100; }
function displayAccountCode(entry: LedgerEntry): string { if ((entry.direction === "transfer" || entry.sourceId?.startsWith("unitel-sales:") || entry.sourceId?.startsWith("prifoto-sales:")) && entry.counterAccountCode) return entry.counterAccountCode; return entry.accountCode || entry.category.match(/^(\d{4})/)?.[1] || "-"; }
function displayAccountLabel(entry: LedgerEntry): string { const code = displayAccountCode(entry); return getBookingCategory(code)?.label || entry.category.split("·").slice(1).join("·").trim() || entry.category; }
function euroNumber(value: number): string { return new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value); }
function quoteCsv(value: string | number): string { const text = String(value); return /[";\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
