"use client";

import { useMemo, useState } from "react";
import { formatCurrency, formatDate } from "@/lib/accounting";
import { useKassenStore } from "@/lib/store";
import type { Device, DeviceStatus } from "@/lib/types";
import { Icon } from "../Icon";
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Select } from "../ui";

export function DevicesPage() {
  const { state, updateDevice } = useKassenStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | DeviceStatus>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const selected = state.devices.find((device) => device.id === selectedId);
  const filtered = useMemo(() => {
    const needle = query.toLowerCase().trim();
    return state.devices.filter((device) => {
      const statusMatches = status === "all" || device.status === status;
      const textMatches = !needle || [device.stockNumber, device.brand, device.model, device.imei1, device.imei2, device.serialNumber].filter(Boolean).join(" ").toLowerCase().includes(needle);
      return statusMatches && textMatches;
    });
  }, [query, state.devices, status]);

  return (
    <div>
      <PageHeader title="Gerätebestand" subtitle="IMEI-basierter Bestand vom Ankauf bis zum Verkauf." />
      <div className="stat-grid compact">
        <Card className="mini-stat"><span>Auf Lager</span><strong>{state.devices.filter((device) => device.status === "inStock").length}</strong></Card>
        <Card className="mini-stat"><span>In Reparatur</span><strong>{state.devices.filter((device) => device.status === "inRepair").length}</strong></Card>
        <Card className="mini-stat"><span>Verkauft</span><strong>{state.devices.filter((device) => device.status === "sold").length}</strong></Card>
        <Card className="mini-stat"><span>Lagerwert</span><strong>{formatCurrency(state.devices.filter((device) => device.status === "inStock").reduce((sum, device) => sum + device.purchasePrice + device.repairCosts, 0))}</strong></Card>
      </div>
      <Card>
        <div className="toolbar">
          <div className="search-box"><Icon name="search" width={18} height={18} /><Input placeholder="IMEI, Modell oder Lagernummer" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
          <Select value={status} onChange={(event) => setStatus(event.target.value as "all" | DeviceStatus)}>
            <option value="all">Alle Status</option><option value="inStock">Auf Lager</option><option value="reserved">Reserviert</option><option value="inRepair">In Reparatur</option><option value="sold">Verkauft</option><option value="returned">Rückgabe</option><option value="defective">Defekt</option>
          </Select>
        </div>
        {filtered.length === 0 ? <EmptyState icon="devices" title="Keine Geräte gefunden" text="Passe Suche oder Statusfilter an." /> : (
          <div className="table-wrap"><table className="data-table"><thead><tr><th>Gerät</th><th>IMEI</th><th>Ankauf</th><th>Preis</th><th>Status</th><th /></tr></thead><tbody>
            {filtered.map((device) => <tr key={device.id}>
              <td><strong>{device.brand} {device.model}</strong><small>{device.stockNumber} · {device.storage || "–"} · {device.color || "–"}</small></td>
              <td><span className="mono">{device.imei1}</span><small>{device.serialNumber || "Keine Seriennummer"}</small></td>
              <td><span>{formatDate(device.purchaseDate)}</span><small>{device.taxMode === "differential" ? "§25a Differenz" : device.taxMode === "standard19" ? "19 % MwSt." : "Steuerfrei"}</small></td>
              <td><strong>{formatCurrency(device.purchasePrice)}</strong><small>VK {formatCurrency(device.salePrice ?? device.askingPrice ?? 0)}</small></td>
              <td><Badge tone={statusTone(device.status)}>{statusLabel(device.status)}</Badge></td>
              <td className="align-right"><Button variant="secondary" onClick={() => setSelectedId(device.id)}>Bearbeiten</Button></td>
            </tr>)}
          </tbody></table></div>
        )}
      </Card>
      {selected ? <DeviceModal device={selected} onClose={() => setSelectedId(undefined)} onSave={(patch) => { updateDevice(selected.id, patch); setSelectedId(undefined); }} /> : null}
    </div>
  );
}

function statusLabel(status: DeviceStatus) { return ({ inStock: "Auf Lager", reserved: "Reserviert", inRepair: "In Reparatur", sold: "Verkauft", returned: "Rückgabe", defective: "Defekt" } as const)[status]; }
function statusTone(status: DeviceStatus): "neutral" | "success" | "warning" | "danger" | "info" { return status === "sold" ? "success" : status === "defective" || status === "returned" ? "danger" : status === "inRepair" || status === "reserved" ? "warning" : "info"; }

function DeviceModal({ device, onClose, onSave }: { device: Device; onClose: () => void; onSave: (patch: Partial<Device>) => void }) {
  const [status, setStatus] = useState(device.status);
  const [repairCosts, setRepairCosts] = useState(String(device.repairCosts));
  const [askingPrice, setAskingPrice] = useState(String(device.askingPrice ?? ""));
  return <Modal open title={`${device.brand} ${device.model}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Abbrechen</Button><Button onClick={() => onSave({ status, repairCosts: Number(repairCosts.replace(",", ".")) || 0, askingPrice: Number(askingPrice.replace(",", ".")) || undefined })}>Speichern</Button></>}>
    <div className="device-summary"><div><strong>{device.stockNumber}</strong><span>IMEI {device.imei1}</span></div><dl><div><dt>Ankauf</dt><dd>{formatCurrency(device.purchasePrice)}</dd></div><div><dt>Datum</dt><dd>{formatDate(device.purchaseDate)}</dd></div></dl></div>
    <div className="form-stack"><Field label="Status"><Select value={status} onChange={(event) => setStatus(event.target.value as DeviceStatus)}><option value="inStock">Auf Lager</option><option value="reserved">Reserviert</option><option value="inRepair">In Reparatur</option><option value="sold">Verkauft</option><option value="returned">Rückgabe</option><option value="defective">Defekt</option></Select></Field><Field label="Reparaturkosten"><Input type="number" step="0.01" value={repairCosts} onChange={(event) => setRepairCosts(event.target.value)} /></Field><Field label="Verkaufspreis"><Input type="number" step="0.01" value={askingPrice} onChange={(event) => setAskingPrice(event.target.value)} /></Field></div>
  </Modal>;
}
