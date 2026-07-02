"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { Customer } from "@/lib/types";
import { CustomerModal } from "../CustomerModal";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "../ui";

export function CustomersPage() {
  const { state } = useKassenStore();
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [newCustomer, setNewCustomer] = useState(false);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    if (!needle) return state.customers;
    return state.customers.filter((customer) =>
      [customer.customerNumber, customer.firstName, customer.lastName, customer.company, customer.phone, customer.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [query, state.customers]);
  const selected = state.customers.find((customer) => customer.id === selectedId);

  return (
    <div>
      <PageHeader
        title="Kunden"
        subtitle="Kunden, Verkäufer und vollständige Gerätehistorie an einem Ort."
        actions={<Button icon="plus" onClick={() => setNewCustomer(true)}>Neuer Kunde</Button>}
      />
      <Card>
        <div className="toolbar">
          <div className="search-box"><Icon name="search" width={18} height={18} /><Input placeholder="Name, Telefon, E-Mail oder Kundennummer" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <Badge tone="info">{filtered.length} Kunden</Badge>
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="customers" title="Keine Kunden gefunden" text="Passe die Suche an oder lege einen neuen Kunden an." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Kunde</th><th>Kontakt</th><th>Rollen</th><th>Vorgänge</th><th /></tr></thead>
              <tbody>
                {filtered.map((customer) => {
                  const devicesBought = state.devices.filter((device) => device.soldToCustomerId === customer.id).length;
                  const devicesSold = state.devices.filter((device) => device.purchasedFromCustomerId === customer.id).length;
                  return (
                    <tr key={customer.id}>
                      <td><strong>{displayName(customer)}</strong><small>{customer.customerNumber} · {customer.type === "business" ? "Geschäft" : "Privat"}</small></td>
                      <td><span>{customer.phone || "–"}</span><small>{customer.email || `${customer.postalCode ?? ""} ${customer.city ?? ""}`.trim() || "Keine Kontaktdaten"}</small></td>
                      <td><div className="badge-row">{customer.roles.map((role) => <Badge key={role}>{roleLabel(role)}</Badge>)}</div></td>
                      <td><span>{devicesBought} gekauft</span><small>{devicesSold} an uns verkauft</small></td>
                      <td className="align-right"><Button variant="secondary" onClick={() => setSelectedId(customer.id)}>Öffnen</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected ? <CustomerDetail customer={selected} onClose={() => setSelectedId(undefined)} /> : null}
      <CustomerModal open={newCustomer} onClose={() => setNewCustomer(false)} />
    </div>
  );
}

function displayName(customer: Customer) {
  return customer.company || `${customer.firstName} ${customer.lastName}`.trim();
}

function roleLabel(role: Customer["roles"][number]) {
  return role === "customer" ? "Kunde" : role === "supplier" ? "Verkäufer" : "Reparatur";
}

function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const { state } = useKassenStore();
  const purchasedFrom = state.devices.filter((device) => device.purchasedFromCustomerId === customer.id);
  const soldTo = state.devices.filter((device) => device.soldToCustomerId === customer.id);
  const documents = state.documents.filter((document) => document.customerId === customer.id);
  const ledger = state.ledger.filter((entry) => entry.customerId === customer.id);
  const balance = ledger.reduce((sum, entry) => sum + (entry.direction === "income" ? entry.amount : -entry.amount), 0);

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <div className="drawer-header">
          <div><small>{customer.customerNumber}</small><h2>{displayName(customer)}</h2><p>{customer.street || ""} {customer.postalCode || ""} {customer.city || ""}</p></div>
          <button className="icon-button" onClick={onClose}><Icon name="close" width={20} height={20} /></button>
        </div>
        <div className="drawer-stats">
          <div><span>An uns verkauft</span><strong>{purchasedFrom.length}</strong></div>
          <div><span>Bei uns gekauft</span><strong>{soldTo.length}</strong></div>
          <div><span>Dokumente</span><strong>{documents.length}</strong></div>
          <div><span>Saldo</span><strong>{formatCurrency(balance)}</strong></div>
        </div>
        <section className="drawer-section"><h3>Kontakt</h3><dl className="detail-list"><div><dt>Telefon</dt><dd>{customer.phone || "–"}</dd></div><div><dt>E-Mail</dt><dd>{customer.email || "–"}</dd></div><div><dt>Typ</dt><dd>{customer.type === "business" ? "Geschäftskunde" : "Privatkunde"}</dd></div>{customer.vatId ? <div><dt>USt-IdNr.</dt><dd>{customer.vatId}</dd></div> : null}</dl></section>
        <section className="drawer-section"><h3>Gerätehistorie</h3><div className="compact-list">
          {[...purchasedFrom, ...soldTo].map((device) => (
            <div key={`${device.id}-${device.purchasedFromCustomerId === customer.id ? "in" : "out"}`}>
              <span className={`direction-icon ${device.purchasedFromCustomerId === customer.id ? "expense" : "income"}`}>{device.purchasedFromCustomerId === customer.id ? "↓" : "↑"}</span>
              <span><strong>{device.brand} {device.model}</strong><small>IMEI {device.imei1} · {formatDate(device.purchasedFromCustomerId === customer.id ? device.purchaseDate : device.saleDate || device.purchaseDate)}</small></span>
              <strong>{formatCurrency(device.purchasedFromCustomerId === customer.id ? device.purchasePrice : device.salePrice || 0)}</strong>
            </div>
          ))}
          {purchasedFrom.length + soldTo.length === 0 ? <p className="muted">Noch keine Gerätebewegung.</p> : null}
        </div></section>
      </aside>
    </div>
  );
}
