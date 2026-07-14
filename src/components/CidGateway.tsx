"use client";

import { useEffect, useState, type ReactNode } from "react";

export interface CidSession {
  cid: string;
  connectedAt: string;
}

const CID_SESSION_KEY = "kassenbuch-pro.cid-session";
const CIDENTIA_CREATE_URL = "https://cidentiaapp.com";

export function CidGateway({ children }: { children: (session: CidSession, logout: () => void) => ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<CidSession>();
  const [cidInput, setCidInput] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(CID_SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as CidSession;
          if (isValidCid(parsed.cid)) setSession(parsed);
        }
      } catch {
        window.localStorage.removeItem(CID_SESSION_KEY);
      } finally {
        setInitialized(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function login() {
    const cid = normalizeCid(cidInput);
    if (!isValidCid(cid)) {
      setError("Bitte eine gültige CID / Cidentia ID eingeben.");
      return;
    }
    const nextSession = { cid, connectedAt: new Date().toISOString() };
    window.localStorage.setItem(CID_SESSION_KEY, JSON.stringify(nextSession));
    setSession(nextSession);
    setError("");
  }

  function logout() {
    window.localStorage.removeItem(CID_SESSION_KEY);
    setSession(undefined);
    setCidInput("");
  }

  if (!initialized) {
    return <div className="cid-gateway-screen"><div className="cid-gateway-card"><div className="cid-logo">CID</div><p>Cidentia Gateway wird geladen …</p></div></div>;
  }

  if (!session) {
    return (
      <main className="cid-gateway-screen">
        <section className="cid-gateway-card">
          <div className="cid-logo">CID</div>
          <p className="cid-kicker">Cidentia Zugang</p>
          <h1>Kassenbuch Pro öffnen</h1>
          <p className="cid-text">
            Dieses Kassenbuch ist an eine CID gebunden. Gib deine CID ein oder erstelle zuerst eine neue CID über Cidentia.
          </p>
          {error ? <div className="cid-error">{error}</div> : null}
          <label className="cid-field">
            <span>CID / Cidentia ID</span>
            <input
              autoFocus
              value={cidInput}
              onChange={(event) => setCidInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") login(); }}
              placeholder="z.B. CID-..."
              autoComplete="username"
            />
          </label>
          <button className="cid-primary" onClick={login}>Mit CID öffnen</button>
          <a className="cid-secondary" href={CIDENTIA_CREATE_URL} target="_blank" rel="noreferrer">Noch keine CID? Auf cidentiaapp.com erstellen</a>
          <div className="cid-note">
            Aktuell wird die CID lokal im Browser gespeichert. Die echte Online-Verifikation wird später über Cidentia API / Session Token angeschlossen.
          </div>
        </section>
      </main>
    );
  }

  return children(session, logout);
}

function normalizeCid(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function isValidCid(value?: string): value is string {
  if (!value) return false;
  return /^[A-Z0-9._:-]{3,80}$/.test(value);
}
