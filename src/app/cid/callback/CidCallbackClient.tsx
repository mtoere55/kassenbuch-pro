"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const CID_SESSION_KEY = "kassenbuch-pro.cid-session";

export function CidCallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [message, setMessage] = useState("Cidentia Rückgabe wird geprüft …");
  const cid = useMemo(() => normalizeCid(params.get("cid") || params.get("ciden_id") || params.get("cidenId") || params.get("identity") || params.get("sub") || ""), [params]);

  useEffect(() => {
    if (!cid || !isValidCid(cid)) {
      setMessage("Keine gültige CID in der Cidentia Rückgabe gefunden.");
      return;
    }
    const session = { cid, connectedAt: new Date().toISOString() };
    window.localStorage.setItem(CID_SESSION_KEY, JSON.stringify(session));
    setMessage("CID wurde übernommen. Kassenbuch Pro wird geöffnet …");
    const timer = window.setTimeout(() => router.replace("/"), 900);
    return () => window.clearTimeout(timer);
  }, [cid, router]);

  return (
    <main className="cid-gateway-screen">
      <section className="cid-gateway-card">
        <div className="cid-logo">CID</div>
        <p className="cid-kicker">Cidentia Callback</p>
        <h1>Kassenbuch Pro</h1>
        <p className="cid-text">{message}</p>
        {cid ? <div className="cid-note">CID: {cid}</div> : null}
        <Link className="cid-secondary" href="/">Zurück zum Kassenbuch</Link>
      </section>
    </main>
  );
}

function normalizeCid(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function isValidCid(value?: string): value is string {
  if (!value) return false;
  return /^[A-Z0-9._:-]{3,120}$/.test(value);
}
