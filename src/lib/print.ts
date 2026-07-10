export function printHtmlElement(element: HTMLElement | null | undefined, title = "Kassenbuch Pro") {
  if (!element) {
    window.alert("Kein druckbarer Inhalt gefunden. Bitte Fenster schließen und erneut öffnen.");
    return;
  }

  const styles = collectPageStyles();
  const html = buildPrintHtml(element.outerHTML, title, styles);
  const popup = window.open("", "_blank", "width=980,height=1200,noopener,noreferrer");

  if (popup?.document) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    runPrintWhenReady(popup);
    return;
  }

  printWithIframe(html);
}

export function printFirst(selector: string, title = "Kassenbuch Pro") {
  printHtmlElement(document.querySelector<HTMLElement>(selector), title);
}

function collectPageStyles(): string {
  const nodes = Array.from(document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>('link[rel="stylesheet"], style'));
  return nodes.map((node) => node.outerHTML).join("\n");
}

function buildPrintHtml(content: string, title: string, styles: string): string {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
${styles}
<style>
  @page { margin: 8mm; }
  html, body { background: #fff !important; color: #111 !important; margin: 0 !important; min-height: auto !important; }
  body { padding: 0 !important; font-family: Arial, sans-serif; }
  .print-shell { width: 100%; background: #fff; color: #111; }
  .print-document, .ledger-print-source, .ledger-print-document, .entry-print-card, .print-only {
    display: block !important;
    visibility: visible !important;
    position: static !important;
    width: 100% !important;
    max-width: none !important;
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
    box-shadow: none !important;
  }
  .screen-only, .modal-header, .modal-footer, .sidebar, .mobile-topbar, .page-header, .booking-shortcuts, .toolbar, button {
    display: none !important;
  }
  .print-document { min-height: 0 !important; padding: 0 !important; }
  .ledger-print-source { padding: 0 !important; margin: 0 !important; }
  .ledger-print-document { padding: 0 !important; margin: 0 !important; }
  .entry-print-card { padding: 0 !important; margin: 0 !important; }
  table { page-break-inside: auto; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
</style>
</head>
<body>
<div class="print-shell">${content}</div>
<script>
  window.addEventListener('load', function () {
    setTimeout(function () {
      window.focus();
      window.print();
      setTimeout(function () { window.close(); }, 500);
    }, 150);
  });
</script>
</body>
</html>`;
}

function runPrintWhenReady(target: Window) {
  const start = () => {
    try {
      target.focus();
      target.print();
      window.setTimeout(() => target.close(), 700);
    } catch {
      // If the browser blocks automatic close/print, the generated tab still contains the printable document.
    }
  };
  target.setTimeout(start, 220);
}

function printWithIframe(html: string) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.border = "0";
  frame.style.opacity = "0";
  document.body.appendChild(frame);
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument || frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    frame.remove();
    window.print();
    return;
  }
  frameDocument.open();
  frameDocument.write(html);
  frameDocument.close();
  frameWindow.setTimeout(() => {
    frameWindow.focus();
    frameWindow.print();
    window.setTimeout(() => frame.remove(), 1000);
  }, 250);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
