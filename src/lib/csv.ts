import { makeId } from "./accounting";
import type { ImportedTransaction } from "./types";

function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseAmount(value: string): number {
  const cleaned = value.replace(/[^0-9,.-]/g, "").trim();
  if (cleaned.includes(",") && cleaned.includes(".")) {
    return Number(cleaned.replace(/\./g, "").replace(",", "."));
  }
  if (cleaned.includes(",")) return Number(cleaned.replace(",", "."));
  return Number(cleaned);
}

function parseDate(value: string): string {
  const de = value.match(/(\d{2})[.\/-](\d{2})[.\/-](\d{4})/);
  if (de) return `${de[3]}-${de[2]}-${de[1]}`;
  const iso = value.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  return iso ?? new Date().toISOString().slice(0, 10);
}

export function parseTransactionsCsv(
  csvText: string,
  accountType: "bank" | "paypal",
): ImportedTransaction[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delimiter).map((header) => header.toLowerCase());
  const findIndex = (names: string[]) =>
    headers.findIndex((header) => names.some((name) => header.includes(name)));
  const dateIndex = findIndex(["datum", "date", "buchungstag"]);
  const amountIndex = findIndex(["betrag", "amount", "brutto"]);
  const descriptionIndex = findIndex([
    "verwendungszweck",
    "beschreibung",
    "name",
    "description",
    "betreff",
  ]);
  const idIndex = findIndex(["transaktionscode", "transaction id", "referenz", "id"]);

  return lines.slice(1).flatMap((line) => {
    const values = splitCsvLine(line, delimiter);
    const amount = parseAmount(values[amountIndex] ?? "");
    if (!Number.isFinite(amount) || amount === 0) return [];
    return [
      {
        id: makeId("import"),
        accountType,
        date: parseDate(values[dateIndex] ?? ""),
        amount,
        description: values[descriptionIndex] || "Importierter Umsatz",
        externalId: values[idIndex] || undefined,
        matchConfidence: 0,
        status: "new" as const,
        createdAt: new Date().toISOString(),
      },
    ];
  });
}
