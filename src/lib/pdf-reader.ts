export interface PdfReadResult {
  embeddedText: string;
  pageImages: Blob[];
  pageCount: number;
  processedPages: number;
}

const MAX_PDF_PAGES = 10;
const MIN_EMBEDDED_TEXT_LENGTH = 80;

export async function readPdfForOcr(file: File): Promise<PdfReadResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

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
