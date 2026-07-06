export interface PdfReadResult {
  embeddedText: string;
  pageImages: Blob[];
  pageCount: number;
  processedPages: number;
}

export interface PdfLayoutReadResult {
  pageTexts: string[];
  text: string;
  pageCount: number;
  processedPages: number;
}

const MAX_PDF_PAGES = 10;
const MIN_EMBEDDED_TEXT_LENGTH = 80;

export async function readPdfForOcr(file: File): Promise<PdfReadResult> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const processedPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const textParts: string[] = [];

  for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .trim();
    if (pageText) textParts.push(pageText);
  }

  const embeddedText = textParts.join("\n").trim();
  if (embeddedText.length >= MIN_EMBEDDED_TEXT_LENGTH) {
    return {
      embeddedText,
      pageImages: [],
      pageCount: pdf.numPages,
      processedPages,
    };
  }

  const pageImages: Blob[] = [];
  for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.8 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) continue;

    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (blob) pageImages.push(blob);
  }

  return {
    embeddedText,
    pageImages,
    pageCount: pdf.numPages,
    processedPages,
  };
}

export async function readPdfWithLayout(file: File): Promise<PdfLayoutReadResult> {
  const pdfjs = await loadPdfJs();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const processedPages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const pageTexts: string[] = [];

  for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const positioned = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } =>
        "str" in item && "transform" in item && Boolean(item.str.trim()),
      )
      .map((item) => ({
        text: item.str.trim(),
        x: Number(item.transform[4] || 0),
        y: Number(item.transform[5] || 0),
      }))
      .sort((left, right) => right.y - left.y || left.x - right.x);

    const rows: Array<{ y: number; items: Array<{ text: string; x: number }> }> = [];
    for (const item of positioned) {
      const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= 1.75);
      if (row) {
        row.items.push({ text: item.text, x: item.x });
      } else {
        rows.push({ y: item.y, items: [{ text: item.text, x: item.x }] });
      }
    }

    const pageText = rows
      .sort((left, right) => right.y - left.y)
      .map((row) => row.items.sort((left, right) => left.x - right.x).map((item) => item.text).join(" "))
      .join("\n")
      .trim();
    pageTexts.push(pageText);
  }

  return {
    pageTexts,
    text: pageTexts.join("\n\f\n"),
    pageCount: pdf.numPages,
    processedPages,
  };
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}
