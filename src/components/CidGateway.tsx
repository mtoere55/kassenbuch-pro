"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  activateCidStorageScope,
  clearCidStorageScope,
} from "@/lib/browser-persistence";
import {
  CID_SESSION_KEY,
  isVerifiedCidentiaSession,
  type CidentiaSession,
} from "@/lib/cidentia-session";

const CIDENTIA_CREATE_URL = "https://cidentiaapp.com";

type LoginStep = "email" | "code";

type ApiPayload = {
  error?: string;
  message?: string;
  session?: CidentiaSession;
};

export function CidGateway({ children }: { children: (session: CidentiaSession, logout: () => void) => ReactNode }) {
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<CidentiaSession>();
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    try {
      window.localStorage.removeItem(CID_SESSION_KEY);
    } catch {
      // Browser storage may be unavailable; the HttpOnly cookie session still works.
    }

    async function restoreSession() {
      try {
        const response = await fetch("/api/cidentia/session", {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) return;
        const payload = (await response.json()) as ApiPayload;
        if (!cancelled && payload.session && isVerifiedCidentiaSession(payload.session)) {
          const activation = activateCidStorageScope(payload.session.cid);
          if (activation.changed) {
            window.location.replace("/");
            return;
          }
          setSession(payload.session);
        }
      } catch {
        // A missing session is a normal logged-out state.
      } finally {
        if (!cancelled) setInitialized(true);
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendCode() {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/cidentia/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok) throw new Error(payload.error || "Bestätigungscode konnte nicht gesendet werden.");
      setStep("code");
      setCode("");
      setMessage(payload.message || "Cidentia hat einen Bestätigungscode gesendet.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Bestätigungscode konnte nicht gesendet werden.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/cidentia/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const payload = (await response.json()) as ApiPayload;
      if (!response.ok || !payload.session || !isVerifiedCidentiaSession(payload.session)) {
        throw new Error(payload.error || "Cidentia Anmeldung ist fehlgeschlagen.");
      }
      activateCidStorageScope(payload.session.cid);
      window.location.replace("/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cidentia Anmeldung ist fehlgeschlagen.");
      setLoading(false);
    }
  }

  function useAnotherEmail() {
    setStep("email");
    setCode("");
    setError("");
    setMessage("");
  }

  function logout() {
    setLoading(true);
    void fetch("/api/cidentia/session", { method: "DELETE" }).finally(() => {
      clearCidStorageScope();
      window.location.replace("/");
    });
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
            Melden Sie sich mit Ihrer Cidentia E-Mail-Adresse an. Cidentia sendet einen einmaligen Bestätigungscode.
          </p>

          {error ? <div className="cid-error">{error}</div> : null}
          {message ? <div className="cid-success">{message}</div> : null}

          <label className="cid-field">
            <span>E-Mail-Adresse</span>
            <input
              autoFocus={step === "email"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && step === "email") void sendCode(); }}
              placeholder="name@beispiel.de"
              type="email"
              autoComplete="email"
              readOnly={step === "code"}
            />
          </label>

          {step === "email" ? (
            <button className="cid-primary" type="button" disabled={loading} onClick={() => void sendCode()}>
              {loading ? "Code wird gesendet …" : "Bestätigungscode senden"}
            </button>
          ) : (
            <>
              <label className="cid-field cid-code-field">
                <span>Bestätigungscode</span>
                <input
                  autoFocus
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  onKeyDown={(event) => { if (event.key === "Enter") void verifyCode(); }}
                  placeholder="6-stelliger Code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                />
              </label>
              <button className="cid-primary" type="button" disabled={loading} onClick={() => void verifyCode()}>
                {loading ? "Anmeldung wird geprüft …" : "Mit Cidentia anmelden"}
              </button>
              <button className="cid-secondary" type="button" disabled={loading} onClick={useAnotherEmail}>
                Andere E-Mail-Adresse verwenden
              </button>
            </>
          )}

          <a className="cid-secondary" href={CIDENTIA_CREATE_URL} target="_blank" rel="noreferrer">
            Noch keine CID? Auf cidentiaapp.com erstellen
          </a>
          <div className="cid-note">
            Die Anmeldung wird direkt von Cidentia bestätigt. Manuelle CID-Eingabe, API-Key und OAuth Client Secret sind für diesen Zugang nicht erforderlich.
          </div>
        </section>
      </main>
    );
  }

  return children(session, logout);
}
