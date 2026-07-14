import { Suspense } from "react";
import { CidCallbackClient } from "./CidCallbackClient";

export default function CidCallbackPage() {
  return (
    <Suspense fallback={<CallbackFallback />}>
      <CidCallbackClient />
    </Suspense>
  );
}

function CallbackFallback() {
  return (
    <main className="cid-gateway-screen">
      <section className="cid-gateway-card">
        <div className="cid-logo">CID</div>
        <p className="cid-kicker">Cidentia Callback</p>
        <h1>Kassenbuch Pro</h1>
        <p className="cid-text">Cidentia Rückgabe wird geprüft …</p>
      </section>
    </main>
  );
}
