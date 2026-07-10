export function printHtmlElement(element: HTMLElement | null | undefined, title = "Kassenbuch Pro") {
  if (!element) {
    window.alert("Kein druckbarer Inhalt gefunden. Bitte Fenster schließen und erneut öffnen.");
    return;
  }

  const html = element.outerHTML;
  if (!html.trim()) {
    window.alert("Der Druckbereich ist leer. Bitte Fenster schließen und erneut öffnen.");
    return;
  }

  installPrintStyles();
  const host = createPrintHost(html, title);
  document.body.classList.add("kassenbuch-native-print");

  const cleanup = () => {
    document.body.classList.remove("kassenbuch-native-print");
    host.remove();
  };

  const mediaQuery = window.matchMedia?.("print");
  const mediaListener = (event: MediaQueryListEvent) => {
    if (!event.matches) {
      cleanup();
      mediaQuery?.removeEventListener?.("change", mediaListener);
    }
  };
  mediaQuery?.addEventListener?.("change", mediaListener);
  window.addEventListener("afterprint", cleanup, { once: true });

  window.setTimeout(() => {
    try {
      window.focus();
      window.print();
    } catch {
      window.alert("Druckdialog konnte nicht geöffnet werden. Bitte Strg+P drücken, während die Druckvorschau sichtbar ist.");
    }
  }, 50);

  window.setTimeout(() => {
    if (document.body.classList.contains("kassenbuch-native-print")) cleanup();
  }, 60_000);
}

export function printFirst(selector: string, title = "Kassenbuch Pro") {
  printHtmlElement(document.querySelector<HTMLElement>(selector), title);
}

function createPrintHost(content: string, title: string): HTMLElement {
  const oldHost = document.getElementById("kassenbuch-print-host");
  oldHost?.remove();

  const host = document.createElement("section");
  host.id = "kassenbuch-print-host";
  host.setAttribute("aria-label", title);
  host.innerHTML = `<div class="kassenbuch-print-title">${escapeHtml(title)}</div><div class="kassenbuch-print-content">${content}</div>`;
  document.body.appendChild(host);
  return host;
}

function installPrintStyles() {
  if (document.getElementById("kassenbuch-native-print-style")) return;
  const style = document.createElement("style");
  style.id = "kassenbuch-native-print-style";
  style.textContent = `
    #kassenbuch-print-host {
      display: none;
      background: #fff;
      color: #111;
      font-family: Arial, sans-serif;
    }
    #kassenbuch-print-host .kassenbuch-print-title {
      display: none;
    }
    #kassenbuch-print-host .print-document,
    #kassenbuch-print-host .ledger-print-source,
    #kassenbuch-print-host .ledger-print-document,
    #kassenbuch-print-host .entry-print-card,
    #kassenbuch-print-host .print-only {
      display: block !important;
      visibility: visible !important;
      position: static !important;
      width: 100% !important;
      max-width: none !important;
      min-height: 0 !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      box-shadow: none !important;
      background: #fff !important;
      color: #111 !important;
      padding: 0 !important;
      margin: 0 !important;
    }
    #kassenbuch-print-host .screen-only,
    #kassenbuch-print-host .modal-header,
    #kassenbuch-print-host .modal-footer,
    #kassenbuch-print-host .sidebar,
    #kassenbuch-print-host .mobile-topbar,
    #kassenbuch-print-host .page-header,
    #kassenbuch-print-host .booking-shortcuts,
    #kassenbuch-print-host .toolbar,
    #kassenbuch-print-host button {
      display: none !important;
    }
    @media print {
      @page { size: A4; margin: 8mm; }
      html,
      body.kassenbuch-native-print {
        background: #fff !important;
        color: #111 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      body.kassenbuch-native-print > :not(#kassenbuch-print-host) {
        display: none !important;
      }
      body.kassenbuch-native-print #kassenbuch-print-host {
        display: block !important;
        visibility: visible !important;
        position: static !important;
        inset: auto !important;
        width: 100% !important;
        max-width: none !important;
        min-height: 0 !important;
        height: auto !important;
        overflow: visible !important;
        background: #fff !important;
        color: #111 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      body.kassenbuch-native-print #kassenbuch-print-host,
      body.kassenbuch-native-print #kassenbuch-print-host * {
        visibility: visible !important;
      }
      body.kassenbuch-native-print #kassenbuch-print-host table {
        page-break-inside: auto;
      }
      body.kassenbuch-native-print #kassenbuch-print-host tr {
        page-break-inside: avoid;
        page-break-after: auto;
      }
      body.kassenbuch-native-print #kassenbuch-print-host * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
