"use client";

import Link from "next/link";

export function CidCallbackClient() {
  return (
    <main className="cid-gateway-screen">
      <section className="cid-gateway-card">
        <div className="cid-logo">CID</div>
        <p className="cid-kicker">Cidentia Zugang</p>
        <h1>Kassenbuch Pro</h1>
        <p className="cid-text">
          Der frühere OAuth-Callback wird nicht mehr für die Anmeldung verwendet. Bitte melden Sie sich auf der Startseite mit Ihrer E-Mail-Adresse und dem Cidentia Bestätigungscode an.
        </p>
        <Link className="cid-primary" href="/">Zur Cidentia Anmeldung</Link>
      </section>
    </main>
  );
}
