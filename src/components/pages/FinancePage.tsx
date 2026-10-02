"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/accounting";
import { buildFinanceForecast } from "@/lib/finance-tax";
import { buildMonthlyAudits, type MonthlyAudit, type MonthlyAuditStatus } from "@/lib/monthly-audit";
import { useKassenStore } from "@/lib/store";
import { Badge, Button, Card, Field, Input, Modal, PageHeader, Select, StatCard } from "../ui";

const MONTHS = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];

export function FinancePage() {
  const { state, updateSettings } = useKassenStore();
  const years = useMemo(() => {
    const values = new Set<number>([new Date().getFullYear()]);
    state.ledger.forEach((entry) => {
      const value = Number(entry.date.slice(0, 4));
      if (Number.isFinite(value)) values.add(value);
    });
    return [...values].sort((a, b) => b - a);
  }, [state.ledger]);

  const [year, setYear] = useState(years[0] || 2026);
  const [tradeTaxMultiplier, setTradeTaxMultiplier] = useState(String(state.settings.tradeTaxMultiplier ?? 520));
  const [otherTaxableIncome, setOtherTaxableIncome] = useState(String(state.settings.otherTaxableIncome ?? 0));
  const [vatPrepayments, setVatPrepayments] = useState(String(state.settings.vatPrepayments ?? 0));
  const [incomeTaxPrepayments, setIncomeTaxPrepayments] = useState(String(state.settings.incomeTaxPrepayments ?? 0));
  const [tradeTaxPrepayments, setTradeTaxPrepayments] = useState(String(state.settings.tradeTaxPrepayments ?? 0));
  const [message, setMessage] = useState("");
  const [auditMonth, setAuditMonth] = useState<string>();

  const previewState = useMemo(() => ({
    ...state,
    settings: {
      ...state.settings,
      tradeTaxMultiplier: number(tradeTaxMultiplier, 520),
      otherTaxableIncome: number(otherTaxableIncome),
      vatPrepayments: number(vatPrepayments),
      incomeTaxPrepayments: number(incomeTaxPrepayments),
      tradeTaxPrepayments: number(tradeTaxPrepayments),
    },
  }), [state, tradeTaxMultiplier, otherTaxableIncome, vatPrepayments, incomeTaxPrepayments, tradeTaxPrepayments]);

  const forecast = useMemo(() => buildFinanceForecast(previewState, year), [previewState, year]);
  const monthlyAudits = useMemo(() => buildMonthlyAudits(state, year), [state, year]);
  const selectedAudit = monthlyAudits.find((audit) => audit.month === auditMonth);
  const financeOfficeOpen = forecast.remainingVat + forecast.remainingIncomeTax;
  const confidenceTone = forecast.quality.score >= 90 ? "success" : forecast.quality.score >= 70 ? "warning" : "danger";

  function saveTaxSettings() {
    updateSettings(previewState.settings);
    setMessage("Steuer-Prognosewerte gespeichert.");
  }

  function saveAsPdf() {
    const previousTitle = document.title;
    const pdfTitle = `Finanzen-Steuerprognose-${year}-${state.settings.businessName || "Kassenbuch"}`
      .replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, "-");
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    document.title = pdfTitle;
    window.addEventListener("afterprint", restoreTitle);
    window.print();
    window.setTimeout(restoreTitle, 1500);
  }

  return <div className="finance-print-root">
    <PageHeader
      title="Finanzen & Steuerprognose"
      subtitle="Betriebsergebnis, Umsatzsteuer und vereinfachte Steuer-Hochrechnung aus allen Buchhaltungsquellen."
      actions={<>
        <Button variant="secondary" onClick={saveAsPdf}>PDF speichern / Drucken</Button>
        <Button onClick={saveTaxSettings}>Prognosewerte speichern</Button>
      </>}
    />
    <div className="finance-print-header">
      <div>
        <strong>{state.settings.businessName || "Kassenbuch Pro"}</strong>
        <span>{[state.settings.street, [state.settings.postalCode, state.settings.city].filter(Boolean).join(" ")].filter(Boolean).join(" · ")}</span>
      </div>
      <div>
        <h1>Finanzen & Steuerprognose {year}</h1>
        <p>Erstellt am {new Intl.DateTimeFormat("de-DE").format(new Date())}</p>
      </div>
    </div>
    {message ? <div className="alert alert-success">{message}</div> : null}

    <div className="form-grid two finance-screen-controls">
      <Field label="Steuerjahr"><Select value={String(year)} onChange={(event) => setYear(Number(event.target.value))}>{years.map((item) => <option key={item} value={item}>{item}</option>)}</Select></Field>
      <Field label="Gewerbesteuer-Hebesatz (%)" hint="Hagen 2026: 520 %."><Input type="number" min="200" max="900" value={tradeTaxMultiplier} onChange={(event) => setTradeTaxMultiplier(event.target.value)} /></Field>
    </div>

    <div className="stat-grid">
      <StatCard label="Betriebserlöse netto" value={formatCurrency(forecast.revenueNet)} detail={"Brutto " + formatCurrency(forecast.revenueGross)} tone="positive" />
      <StatCard label="Betriebsausgaben netto" value={formatCurrency(forecast.expenseNet)} detail={"Brutto " + formatCurrency(forecast.expenseGross)} tone="negative" />
      <StatCard label="Gebuchter Gewinn" value={formatCurrency(forecast.profit)} detail={forecast.monthsWithActivity + " Monat(e) mit Buchungen"} tone="blue" />
      <StatCard label="Empfohlene Steuerrücklage" value={formatCurrency(forecast.recommendedReserve)} detail="USt + ESt + GewSt nach Vorauszahlungen" />
    </div>

    <div className="dashboard-columns">
      <Card>
        <div className="card-heading"><div><h2>Umsatzsteuer</h2><p>Nur tatsächlich gebuchte Steuerbeträge.</p></div><Badge tone={forecast.vatLiability >= 0 ? "warning" : "success"}>{forecast.vatLiability >= 0 ? "Zahllast" : "Guthaben"}</Badge></div>
        <div className="calculation-box">
          <div><span>Umsatzsteuer aus Erlösen</span><strong>{formatCurrency(forecast.outputVat)}</strong></div>
          <div><span>Abziehbare Vorsteuer</span><strong>− {formatCurrency(forecast.inputVat)}</strong></div>
          <div><span>Gebuchte USt-Zahllast</span><strong>{formatCurrency(forecast.vatLiability)}</strong></div>
          <div><span>Jahreshochrechnung</span><strong>{formatCurrency(forecast.projectedVatLiability)}</strong></div>
          <div><span>Bereits vorausgezahlt</span><strong>− {formatCurrency(forecast.vatPrepayments)}</strong></div>
          <div><span>Noch zurücklegen</span><strong>{formatCurrency(forecast.remainingVat)}</strong></div>
        </div>
      </Card>

      <Card>
        <div className="card-heading"><div><h2>Gewinn & Hochrechnung</h2><p>Umbuchungen und Privatbewegungen sind ausgeschlossen.</p></div></div>
        <div className="calculation-box">
          <div><span>Gebuchter Gewinn</span><strong>{formatCurrency(forecast.profit)}</strong></div>
          <div><span>Hochrechnungsfaktor</span><strong>{forecast.projectionFactor.toFixed(2)} ×</strong></div>
          <div><span>Hochgerechneter Jahresgewinn</span><strong>{formatCurrency(forecast.projectedProfit)}</strong></div>
          <div><span>Weitere steuerpflichtige Einkünfte</span><strong>{formatCurrency(number(otherTaxableIncome))}</strong></div>
          <div><span>Vereinfachtes zvE</span><strong>{formatCurrency(forecast.taxableIncomeApprox)}</strong></div>
        </div>
        <div className="alert alert-info">Die Einkommensteuer-Hochrechnung enthält keine automatisch ermittelten privaten Sonderausgaben, Krankenversicherung, Splitting-Effekte oder außergewöhnlichen Belastungen.</div>
      </Card>
    </div>

    <div className="dashboard-columns lower">
      <Card>
        <div className="card-heading"><div><h2>Voraussichtliche Steuern</h2><p>2026-Tarif und Gewerbesteuer-Schätzung für Einzelunternehmen.</p></div></div>
        {forecast.unsupportedIncomeTaxYear ? <div className="alert alert-warning">Für {year} wird keine Einkommensteuer-Tarifschätzung berechnet; die hinterlegte Tarifformel gilt für 2026.</div> : null}
        <div className="calculation-box">
          <div><span>Einkommensteuer vor GewSt-Anrechnung</span><strong>{formatCurrency(forecast.incomeTaxBeforeTradeCredit)}</strong></div>
          <div><span>§35-GewSt-Anrechnung ca.</span><strong>− {formatCurrency(forecast.tradeTaxCredit)}</strong></div>
          <div><span>Einkommensteuer nach Anrechnung ca.</span><strong>{formatCurrency(forecast.incomeTaxAfterTradeCredit)}</strong></div>
          <div><span>Gewerbesteuer-Messbetrag</span><strong>{formatCurrency(forecast.tradeTaxMeasure)}</strong></div>
          <div><span>Gewerbesteuer ca.</span><strong>{formatCurrency(forecast.tradeTax)}</strong></div>
        </div>
        <div className="alert alert-warning"><strong>Prognose:</strong> Hinzurechnungen, Kürzungen und persönliche Steuerdaten können den tatsächlichen Bescheid verändern.</div>
      </Card>

      <Card>
        <div className="card-heading"><div><h2>Voraussichtlich noch offen</h2><p>Nach den eingetragenen Vorauszahlungen.</p></div></div>
        <div className="calculation-box">
          <div><span>Finanzamt · Umsatzsteuer</span><strong>{formatCurrency(forecast.remainingVat)}</strong></div>
          <div><span>Finanzamt · Einkommensteuer</span><strong>{formatCurrency(forecast.remainingIncomeTax)}</strong></div>
          <div><span>Finanzamt gesamt ca.</span><strong>{formatCurrency(financeOfficeOpen)}</strong></div>
          <div><span>Stadt · Gewerbesteuer</span><strong>{formatCurrency(forecast.remainingTradeTax)}</strong></div>
          <div><span>Gesamte Rücklage</span><strong>{formatCurrency(forecast.recommendedReserve)}</strong></div>
        </div>
      </Card>
    </div>

    <div className="finance-screen-controls"><Card>
      <div className="card-heading"><div><h2>Vorauszahlungen & Ergänzungen</h2><p>Bereits bezahlte Beträge und weitere steuerpflichtige Einkünfte.</p></div></div>
      <div className="form-grid two">
        <Field label="Weitere steuerpflichtige Einkünfte"><Input type="number" step="0.01" value={otherTaxableIncome} onChange={(event) => setOtherTaxableIncome(event.target.value)} /></Field>
        <Field label="USt-Vorauszahlungen bereits gezahlt"><Input type="number" step="0.01" value={vatPrepayments} onChange={(event) => setVatPrepayments(event.target.value)} /></Field>
        <Field label="ESt-Vorauszahlungen bereits gezahlt"><Input type="number" step="0.01" value={incomeTaxPrepayments} onChange={(event) => setIncomeTaxPrepayments(event.target.value)} /></Field>
        <Field label="Gewerbesteuer-Vorauszahlungen bereits gezahlt"><Input type="number" step="0.01" value={tradeTaxPrepayments} onChange={(event) => setTradeTaxPrepayments(event.target.value)} /></Field>
      </div>
    </Card></div>

    <div className="finance-print-assumptions">
      <strong>Grundlagen der Prognose</strong>
      <span>Gewerbesteuer-Hebesatz: {number(tradeTaxMultiplier, 520).toFixed(0)} %</span>
      <span>Weitere steuerpflichtige Einkünfte: {formatCurrency(number(otherTaxableIncome))}</span>
      <span>USt-Vorauszahlungen: {formatCurrency(number(vatPrepayments))}</span>
      <span>ESt-Vorauszahlungen: {formatCurrency(number(incomeTaxPrepayments))}</span>
      <span>GewSt-Vorauszahlungen: {formatCurrency(number(tradeTaxPrepayments))}</span>
    </div>

    <Card>
      <div className="card-heading"><div><h2>Datenqualität</h2><p>Wie belastbar die Prognose aus den vorhandenen Buchungen ist.</p></div><Badge tone={confidenceTone}>{forecast.quality.score} %</Badge></div>
      <div className="stat-grid">
        <StatCard label="Sichere Buchungen" value={String(forecast.quality.secureEntries)} detail="Kontiert und abgeglichen" tone="positive" />
        <StatCard label="Zu prüfen" value={String(forecast.quality.reviewEntries)} detail="Konto 0000 / nicht abgeglichen" />
        <StatCard label="Beleg / Vorsteuer offen" value={String(forecast.quality.missingReceiptEntries)} detail="z. B. PayPal ohne Rechnung" />
        <StatCard label="Offene Bank/PayPal-Umsätze" value={String(forecast.quality.openTransactions)} detail="Noch nicht endgültig gebucht" />
      </div>
      {forecast.quality.score < 90 ? <div className="alert alert-warning">Offene Zuordnungen oder fehlende Belege machen die Prognose unsicherer. Fehlende Vorsteuer führt typischerweise zu einer eher zu hohen USt-Zahllast.</div> : <div className="alert alert-success">Die vorhandenen Buchungen sind weitgehend abgeglichen.</div>}
    </Card>

    <Card className="finance-monthly-card">
      <div className="card-heading"><div><h2>Monatsübersicht {year}</h2><p>Erlöse, Ausgaben, Gewinn, Umsatzsteuer und automatische Kontrollhinweise je Monat.</p></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Monat</th><th className="align-right">Erlöse netto</th><th className="align-right">Ausgaben netto</th><th className="align-right">Gewinn</th><th className="align-right">USt</th><th className="align-right">Vorsteuer</th><th className="align-right">Zahllast</th><th className="align-right">Buchungen</th><th>Kontrolle</th></tr></thead><tbody>
        {forecast.months.map((month, index) => {
          const audit = monthlyAudits[index];
          return <tr key={month.month}>
            <td><strong>{MONTHS[index]}</strong><small>{month.month}</small></td>
            <td className="align-right">{formatCurrency(month.revenueNet)}</td>
            <td className="align-right">{formatCurrency(month.expenseNet)}</td>
            <td className={"align-right " + (month.profit >= 0 ? "money-positive" : "money-negative")}><strong>{formatCurrency(month.profit)}</strong></td>
            <td className="align-right">{formatCurrency(month.outputVat)}</td>
            <td className="align-right">{formatCurrency(month.inputVat)}</td>
            <td className="align-right">{formatCurrency(month.vatLiability)}</td>
            <td className="align-right">{month.bookingCount}</td>
            <td>
              <div className="monthly-audit-action">
                <Badge tone={auditTone(audit.status)}>{auditLabel(audit)}</Badge>
                <Button variant="secondary" onClick={() => setAuditMonth(audit.month)} disabled={audit.status === "empty"}>Analyse</Button>
              </div>
            </td>
          </tr>;
        })}
      </tbody></table></div>
    </Card>

    <div className="finance-print-footer">
      <p><strong>Hinweis:</strong> Diese Auswertung ist eine betriebliche Prognose auf Basis der im Kassenbuch gespeicherten Daten und ersetzt weder Steuererklärung noch Steuerbescheid oder steuerliche Beratung.</p>
    </div>

    <Modal
      open={Boolean(selectedAudit)}
      onClose={() => setAuditMonth(undefined)}
      title={selectedAudit ? `Monatsanalyse · ${monthLabel(selectedAudit.month)}` : "Monatsanalyse"}
      wide
      footer={<Button variant="secondary" onClick={() => setAuditMonth(undefined)}>Schließen</Button>}
    >
      {selectedAudit ? <MonthlyAuditView audit={selectedAudit} /> : null}
    </Modal>
  </div>;
}

function MonthlyAuditView({ audit }: { audit: MonthlyAudit }) {
  return <div className="monthly-audit">
    <div className="stat-grid compact">
      <StatCard label="Erlöse netto" value={formatCurrency(audit.revenueNet)} tone="positive" />
      <StatCard label="Ausgaben netto" value={formatCurrency(audit.expenseNet)} tone="negative" />
      <StatCard label="Monatsergebnis" value={formatCurrency(audit.profitNet)} tone={audit.profitNet >= 0 ? "positive" : "negative"} />
      <StatCard label="Kontrollstatus" value={auditStatusText(audit.status)} detail={audit.issueCount ? `${audit.issueCount} Hinweis(e)` : "Keine Auffälligkeit"} />
    </div>

    <div className="dashboard-columns lower">
      <Card>
        <div className="card-heading"><div><h2>Geschäftsaufteilung</h2><p>Woher Einnahmen und Ausgaben dieses Monats kommen.</p></div></div>
        <div className="calculation-box">
          <div><span>Geräteankäufe brutto</span><strong>{formatCurrency(audit.devicePurchaseGross)}</strong></div>
          <div><span>Geräteverkäufe brutto</span><strong>{formatCurrency(audit.deviceSaleGross)}</strong></div>
          <div><span>Reparaturerlöse brutto</span><strong>{formatCurrency(audit.repairIncomeGross)}</strong></div>
          <div><span>Umbuchungen / Clearing</span><strong>{formatCurrency(audit.transferVolume)}</strong></div>
          {audit.misclassifiedBankStatementCount ? <div><span>Kontoauszug-Fehlbuchung ausgeschlossen</span><strong>− {formatCurrency(audit.excludedBankStatementGross)}</strong></div> : null}
          <div><span>USt</span><strong>{formatCurrency(audit.outputVat)}</strong></div>
          <div><span>Vorsteuer</span><strong>{formatCurrency(audit.inputVat)}</strong></div>
          <div className="calculation-total"><span>USt-Zahllast</span><strong>{formatCurrency(audit.vatLiability)}</strong></div>
        </div>
      </Card>

      <Card>
        <div className="card-heading"><div><h2>Zahlungswege</h2><p>Bruttovolumen der betrieblichen Buchungen.</p></div></div>
        <div className="calculation-box">
          <div><span>Bar</span><strong>{formatCurrency(audit.paymentTotals.cash)}</strong></div>
          <div><span>Karte</span><strong>{formatCurrency(audit.paymentTotals.card)}</strong></div>
          <div><span>Bank</span><strong>{formatCurrency(audit.paymentTotals.bank)}</strong></div>
          <div><span>PayPal</span><strong>{formatCurrency(audit.paymentTotals.paypal)}</strong></div>
        </div>
      </Card>
    </div>

    <Card>
      <div className="card-heading"><div><h2>Automatische Kontrolle</h2><p>Doppelbuchungen, ungeklärte Konten, Kassenprobleme, Belege und ungewöhnliche Beträge.</p></div><Badge tone={auditTone(audit.status)}>{auditLabel(audit)}</Badge></div>
      {audit.issues.length ? <div className="monthly-audit-issues">
        {audit.issues.map((issue) => <div key={issue.code} className={`monthly-audit-issue monthly-audit-${issue.severity}`}>
          <Badge tone={issueTone(issue.severity)}>{issue.severity === "danger" ? "Prüfen" : issue.severity === "warning" ? "Hinweis" : "Info"}</Badge>
          <div><strong>{issue.title}</strong><p>{issue.detail}</p></div>
        </div>)}
      </div> : <div className="alert alert-success">Für diesen Monat wurden keine Auffälligkeiten gefunden.</div>}
    </Card>

    <div className="dashboard-columns lower">
      <Card>
        <div className="card-heading"><div><h2>Ausgaben nach Konto / Kategorie</h2><p>Größte Kostenblöcke des Monats.</p></div></div>
        {audit.expenseGroups.length ? <div className="compact-list">
          {audit.expenseGroups.map((group) => <div key={group.label}><span><strong>{group.label}</strong><small>{group.count} Buchung(en)</small></span><strong>{formatCurrency(group.amount)}</strong></div>)}
        </div> : <p className="muted">Keine betrieblichen Ausgaben in diesem Monat.</p>}
      </Card>

      <Card>
        <div className="card-heading"><div><h2>Größte Einzel-Ausgaben</h2><p>Die fünf höchsten betrieblichen Ausgaben.</p></div></div>
        {audit.topExpenses.length ? <div className="compact-list">
          {audit.topExpenses.map((entry) => <div key={entry.id}><span><strong>{entry.description}</strong><small>{formatShortDate(entry.date)} · {entry.accountCode || "–"} · {entry.paymentMethod}</small></span><strong>{formatCurrency(entry.amount)}</strong></div>)}
        </div> : <p className="muted">Keine betrieblichen Ausgaben in diesem Monat.</p>}
      </Card>
    </div>

    <Card>
      <div className="card-heading"><div><h2>Größte Einzel-Einnahmen</h2><p>Die fünf höchsten betrieblichen Einnahmen.</p></div></div>
      {audit.topIncome.length ? <div className="compact-list">
        {audit.topIncome.map((entry) => <div key={entry.id}><span><strong>{entry.description}</strong><small>{formatShortDate(entry.date)} · {entry.accountCode || "–"} · {entry.paymentMethod}</small></span><strong>{formatCurrency(entry.amount)}</strong></div>)}
      </div> : <p className="muted">Keine betrieblichen Einnahmen in diesem Monat.</p>}
    </Card>
  </div>;
}

function auditTone(status: MonthlyAuditStatus): "neutral" | "success" | "warning" | "danger" | "info" {
  if (status === "danger") return "danger";
  if (status === "warning") return "warning";
  if (status === "info") return "info";
  if (status === "ok") return "success";
  return "neutral";
}

function auditStatusText(status: MonthlyAuditStatus): string {
  return ({ empty: "Keine Daten", ok: "Geprüft", info: "Hinweise", warning: "Prüfen", danger: "Kritisch" } as const)[status];
}

function auditLabel(audit: MonthlyAudit): string {
  if (audit.status === "empty") return "Keine Daten";
  if (audit.status === "ok") return "Geprüft";
  return `${audit.issueCount} Hinweis(e)`;
}

function issueTone(severity: "info" | "warning" | "danger"): "info" | "warning" | "danger" {
  return severity;
}

function monthLabel(month: string): string {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(year, number - 1, 1));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("de-DE").format(new Date(`${value}T12:00:00`));
}

function number(value: string, fallback = 0): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
