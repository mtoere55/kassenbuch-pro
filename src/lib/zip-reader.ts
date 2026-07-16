const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRIES = 500;
const MAX_TOTAL_UNCOMPRESSED = 40 * 1024 * 1024;

export async function readZipTextFiles(input: ArrayBuffer): Promise<Map<string, string>> {
  const bytes = new Uint8Array(input);
  const view = new DataView(input);
  const eocd = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entryCount > MAX_ENTRIES) throw new Error("Das ZIP enthält zu viele Dateien.");
  if (centralOffset >= bytes.byteLength) throw new Error("Das ZIP-Verzeichnis ist beschädigt.");

  const decoder = new TextDecoder("utf-8");
  const files = new Map<string, string>();
  let cursor = centralOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(bytes, cursor, 46);
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) {
      throw new Error("Das ZIP-Zentralverzeichnis ist beschädigt.");
    }

    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    ensureRange(bytes, cursor + 46, nameLength + extraLength + commentLength);

    if (flags & 0x1) throw new Error("Verschlüsselte ZIP-Dateien werden nicht unterstützt.");
    const rawName = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const name = normalizeName(rawName);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (!name || name.endsWith("/")) continue;
    if (method !== 0 && method !== 8) {
      throw new Error(`ZIP-Kompressionsmethode ${method} wird für ${name} nicht unterstützt.`);
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      throw new Error("Der entpackte ZIP-Inhalt ist größer als 40 MB.");
    }

    ensureRange(bytes, localOffset, 30);
    if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`Der lokale ZIP-Eintrag ${name} ist beschädigt.`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    ensureRange(bytes, dataOffset, compressedSize);
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : await inflateRaw(compressed);

    if (content.byteLength !== uncompressedSize) {
      throw new Error(`Die entpackte Größe von ${name} stimmt nicht.`);
    }
    if (crc32(content) !== crc) throw new Error(`Die Prüfsumme von ${name} stimmt nicht.`);
    files.set(name, decoder.decode(content));
  }

  if (!files.size) throw new Error("Im ZIP wurden keine lesbaren Dateien gefunden.");
  return files;
}

function findEndOfCentralDirectory(view: DataView): number {
  const minimum = Math.max(0, view.byteLength - 65_557);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("Die Datei ist kein gültiges ZIP-Archiv.");
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Dieser Browser kann ZIP-Dateien nicht lokal entpacken. Bitte einen aktuellen Edge- oder Chrome-Browser verwenden.");
  }
  const copy = new Uint8Array(compressed.byteLength);
  copy.set(compressed);
  const stream = new Blob([copy.buffer]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function normalizeName(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.split("/").some((part) => part === "..")) {
    throw new Error("Das ZIP enthält einen unsicheren Dateipfad.");
  }
  return normalized.split("/").at(-1) || "";
}

function ensureRange(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error("Das ZIP ist unvollständig oder beschädigt.");
  }
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
