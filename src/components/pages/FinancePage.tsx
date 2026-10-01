"use client";

import { useMemo, useState } from "react";
import { formatCurrency } from "@/lib/accounting";
import { buildFinanceForecast } from "@/lib/finance-tax";
import { useKassenStore } from "@/lib/store";
import { Badge, Button, Card, Field, Input, PageHeader, Select, StatCard } from "../ui";

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
  const financeOfficeOpen = forecast.remainingVat + forecast.remainingIncomeTax;
  const confidenceTone = forecast.quality.score >= 90 ? "success" : forecast.quality.score >= 70 ? "warning" : "danger";

  function saveTaxSettings() {
    updateSettings(previewState.settings);
    setMessage("Steuer-Prognosewerte gespeichert.");
  }

  return <div>
    <PageHeader title="Finanzen & Steuerprognose" subtitle="Betriebsergebnis, Umsatzsteuer und vereinfachte Steuer-Hochrechnung aus allen Buchhaltungsquellen." actions={<Button onClick={saveTaxSettings}>Prognosewerte speichern</Button>} />
    {message ? <div className="alert alert-success">{message}</div> : null}

    <div className="form-grid two">
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

    <Card>
      <div className="card-heading"><div><h2>Vorauszahlungen & Ergänzungen</h2><p>Bereits bezahlte Beträge und weitere steuerpflichtige Einkünfte.</p></div></div>
      <div className="form-grid two">
        <Field label="Weitere steuerpflichtige Einkünfte"><Input type="number" step="0.01" value={otherTaxableIncome} onChange={(event) => setOtherTaxableIncome(event.target.value)} /></Field>
        <Field label="USt-Vorauszahlungen bereits gezahlt"><Input type="number" step="0.01" value={vatPrepayments} onChange={(event) => setVatPrepayments(event.target.value)} /></Field>
        <Field label="ESt-Vorauszahlungen bereits gezahlt"><Input type="number" step="0.01" value={incomeTaxPrepayments} onChange={(event) => setIncomeTaxPrepayments(event.target.value)} /></Field>
        <Field label="Gewerbesteuer-Vorauszahlungen bereits gezahlt"><Input type="number" step="0.01" value={tradeTaxPrepayments} onChange={(event) => setTradeTaxPrepayments(event.target.value)} /></Field>
      </div>
    </Card>

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

    <Card>
      <div className="card-heading"><div><h2>Monatsübersicht {year}</h2><p>Erlöse, Ausgaben, Gewinn und Umsatzsteuer je Monat.</p></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Monat</th><th className="align-right">Erlöse netto</th><th className="align-right">Ausgaben netto</th><th className="align-right">Gewinn</th><th className="align-right">USt</th><th className="align-right">Vorsteuer</th><th className="align-right">Zahllast</th><th className="align-right">Buchungen</th></tr></thead><tbody>
        {forecast.months.map((month, index) => <tr key={month.month}><td><strong>{MONTHS[index]}</strong><small>{month.month}</small></td><td className="align-right">{formatCurrency(month.revenueNet)}</td><td className="align-right">{formatCurrency(month.expenseNet)}</td><td className={"align-right " + (month.profit >= 0 ? "money-positive" : "money-negative")}><strong>{formatCurrency(month.profit)}</strong></td><td className="align-right">{formatCurrency(month.outputVat)}</td><td className="align-right">{formatCurrency(month.inputVat)}</td><td className="align-right">{formatCurrency(month.vatLiability)}</td><td className="align-right">{month.bookingCount}</td></tr>)}
      </tbody></table></div>
    </Card>
  </div>;
}

function number(value: string, fallback = 0): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}
