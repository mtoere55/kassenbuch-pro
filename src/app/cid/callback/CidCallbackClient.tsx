"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CID_SESSION_KEY,
  isVerifiedCidentiaSession,
  type CidentiaSession,
} from "@/lib/cidentia-session";

export function CidCallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const code = useMemo(() => params.get("code") || "", [params]);
  const state = useMemo(() => params.get("state") || "", [params]);
  const [status, setStatus] = useState<"checking" | "success" | "error">("checking");
  const [message, setMessage] = useState("Cidentia Rückgabe wird geprüft …");
  const [session, setSession] = useState<CidentiaSession>();

  useEffect(() => {
    let active = true;
    async function exchange() {
      if (!code.trim()) {
        if (!active) return;
        setStatus("error");
        setMessage("Keine gültige Cidentia Code-Rückgabe gefunden. Direkter CID-Parameter reicht nicht mehr aus.");
        return;
      }
      try {
        const response = await fetch("/api/cidentia/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state }),
        });
        const payload = (await response.json()) as { session?: CidentiaSession; error?: string };
        if (!response.ok || !payload.session || !isVerifiedCidentiaSession(payload.session)) {
          throw new Error(payload.error || "Cidentia konnte die Rückgabe nicht bestätigen.");
        }
        window.localStorage.setItem(CID_SESSION_KEY, JSON.stringify(payload.session));
        if (!active) return;
        setSession(payload.session);
        setStatus("success");
        setMessage("CID wurde durch Cidentia bestätigt. Kassenbuch Pro wird geöffnet …");
        window.setTimeout(() => router.replace("/"), 900);
      } catch (cause) {
        if (!active) return;
        setStatus("error");
        setMessage(cause instanceof Error ? cause.message : "Cidentia Rückgabe konnte nicht geprüft werden.");
      }
    }
    void exchange();
    return () => { active = false; };
  }, [code, router, state]);

  return (
    <main className="cid-gateway-screen">
      <section className="cid-gateway-card">
        <div className="cid-logo">CID</div>
        <p className="cid-kicker">Cidentia Callback</p>
        <h1>Kassenbuch Pro</h1>
        <p className="cid-text">{message}</p>
        {session ? <div className="cid-note">CID: {session.cid}</div> : null}
        {status === "error" ? <Link className="cid-secondary" href="/">Zurück zum Cidentia Zugang</Link> : null}
      </section>
    </main>
  );
}
