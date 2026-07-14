"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  CID_SESSION_KEY,
  isValidCid,
  isVerifiedCidentiaSession,
  normalizeCid,
  type CidentiaSession,
} from "@/lib/cidentia-session";

const CIDENTIA_CREATE_URL = "https://cidentiaapp.com";

export function CidGateway({ children }: { children: (session: CidentiaSession, logout: () => void) => ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<CidentiaSession>();
  const [cidInput, setCidInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(CID_SESSION_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as unknown;
          if (isVerifiedCidentiaSession(parsed)) {
            setSession(parsed);
          } else {
            window.localStorage.removeItem(CID_SESSION_KEY);
          }
        }
      } catch {
        window.localStorage.removeItem(CID_SESSION_KEY);
      } finally {
        setInitialized(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function login() {
    const cid = normalizeCid(cidInput);
    if (!isValidCid(cid)) {
      setError("Bitte eine gültige CID / Cidentia ID eingeben.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/cidentia/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cid }),
      });
      const payload = (await response.json()) as { session?: CidentiaSession; error?: string };
      if (!response.ok || !payload.session || !isVerifiedCidentiaSession(payload.session)) {
        throw new Error(payload.error || "CidenDB hat diese CID nicht bestätigt.");
      }
      window.localStorage.setItem(CID_SESSION_KEY, JSON.stringify(payload.session));
      setSession(payload.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "CID konnte nicht über CidenDB geprüft werden.");
    } finally {
      setLoading(false);
    }
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
            Dieses Kassenbuch öffnet nur mit bestätigter CID. Die CID wird zuerst über CidenDB geprüft.
          </p>
          {error ? <div className="cid-error">{error}</div> : null}
          <label className="cid-field">
            <span>CID / Cidentia ID</span>
            <input
              autoFocus
              value={cidInput}
              onChange={(event) => setCidInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void login(); }}
              placeholder="z.B. CID-..."
              autoComplete="username"
            />
          </label>
          <button className="cid-primary" disabled={loading} onClick={() => void login()}>
            {loading ? "CID wird über CidenDB geprüft …" : "CID prüfen und öffnen"}
          </button>
          <a className="cid-secondary" href="/api/cidentia/authorize">Mit Cidentia anmelden</a>
          <a className="cid-secondary" href={CIDENTIA_CREATE_URL} target="_blank" rel="noreferrer">Noch keine CID? Auf cidentiaapp.com erstellen</a>
          <div className="cid-note">
            Direkter Zugang ohne CidenDB-Prüfung ist deaktiviert. Für Quick Verify muss der Server CIDENTIA_API_KEY haben; für OAuth braucht er Client ID und Client Secret.
          </div>
        </section>
      </main>
    );
  }

  return children(session, logout);
}
