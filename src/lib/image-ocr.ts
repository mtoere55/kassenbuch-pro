export interface PreparedImageOcr {
  sources: Blob[];
  width: number;
  height: number;
  longReceipt: boolean;
  message: string;
}

const TARGET_WIDTH = 1800;
const MAX_SCALE = 3;
const TILE_HEIGHT = 1900;
const TILE_OVERLAP = 180;
const ARCHIVE_MAX_SIDE = 1800;

export async function prepareImageForOcr(file: File): Promise<PreparedImageOcr> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(MAX_SCALE, Math.max(1, TARGET_WIDTH / Math.max(bitmap.width, 1)));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) throw new Error("Das Bild konnte nicht vorbereitet werden.");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    enhanceReceiptContrast(context, width, height);

    const longReceipt = height / width > 2.1 || height > TILE_HEIGHT * 1.35;
    const sources = longReceipt
      ? await splitCanvas(canvas, TILE_HEIGHT, TILE_OVERLAP)
      : [await canvasToBlob(canvas)];

    return {
      sources,
      width,
      height,
      longReceipt,
      message: longReceipt
        ? `Langer Beleg erkannt: Das Bild wurde vergrößert und in ${sources.length} überlappende Abschnitte geteilt.`
        : "Das Belegbild wurde vergrößert sowie für Thermodruck und schwachen Kontrast optimiert.",
    };
  } finally {
    bitmap.close();
  }
}

export async function createArchiveImageDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, ARCHIVE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Das Belegbild konnte nicht archiviert werden.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    bitmap.close();
  }
}

function enhanceReceiptContrast(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  const histogram = new Uint32Array(256);

  for (let index = 0; index < data.length; index += 4) {
    const gray = Math.round(data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114);
    histogram[gray] += 1;
  }

  const pixelCount = width * height;
  const lowTarget = pixelCount * 0.01;
  const highTarget = pixelCount * 0.985;
  let cumulative = 0;
  let low = 0;
  let high = 255;

  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= lowTarget) {
      low = value;
      break;
    }
  }

  cumulative = 0;
  for (let value = 0; value < 256; value += 1) {
    cumulative += histogram[value];
    if (cumulative >= highTarget) {
      high = value;
      break;
    }
  }

  const range = Math.max(24, high - low);
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
    let normalized = ((gray - low) / range) * 255;
    normalized = Math.max(0, Math.min(255, normalized));
    normalized = normalized < 210 ? normalized * 0.82 : 255 - (255 - normalized) * 0.45;
    const value = Math.max(0, Math.min(255, Math.round(normalized)));
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }

  context.putImageData(image, 0, 0);
}

async function splitCanvas(
  source: HTMLCanvasElement,
  tileHeight: number,
  overlap: number,
): Promise<Blob[]> {
  const blobs: Blob[] = [];
  const step = Math.max(1, tileHeight - overlap);

  for (let top = 0; top < source.height; top += step) {
    const height = Math.min(tileHeight, source.height - top);
    const tile = document.createElement("canvas");
    tile.width = source.width;
    tile.height = height;
    const context = tile.getContext("2d", { alpha: false });
    if (!context) continue;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, tile.width, tile.height);
    context.drawImage(source, 0, top, source.width, height, 0, 0, source.width, height);
    blobs.push(await canvasToBlob(tile));
    if (top + height >= source.height) break;
  }

  return blobs;
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Das optimierte Bild konnte nicht erzeugt werden."))),
      "image/jpeg",
      0.94,
    );
  });
}
