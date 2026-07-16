import { parseSparkasseStatement, type BankStatementReport } from "./bank-statement-flexible";

export function isSupportedSparkasseStatementText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ");
  return /Sparkasse\s+an\s+Volme\s+und\s+Ruhr/i.test(normalized) &&
    /Kontoauszug\s+\d+\/\d{4}/i.test(normalized);
}

export function normalizeSparkasseLayoutText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line
      .replace(/\bK\s+onto-Nr\./gi, "Konto-Nr.")
      .replace(/^(\d{2}\.\d{2}\.\d{4})(?=[A-Za-zÄÖÜäöüß])/u, "$1 ")
      .replace(/Gutschrift\s+Überweisung/gi, "GutschriftÜberweisung"))
    .join("\n");
}

export function parseSparkasseLayoutStatement(text: string): BankStatementReport | undefined {
  if (!isSupportedSparkasseStatementText(text)) return undefined;
  return parseSparkasseStatement(normalizeSparkasseLayoutText(text));
}
