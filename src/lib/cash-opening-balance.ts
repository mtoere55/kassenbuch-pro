import { entryCashEffect } from "./manual-booking";
import type { AppState, BusinessSettings, LedgerEntry } from "./types";

export const APRIL_2026_OPENING_MONTH = "2026-04";
export const APRIL_2026_OPENING_CASH = 625.04;

export function ensureApril2026OpeningCash(state: AppState): AppState {
  const current = state.settings.cashOpeningBalances?.[APRIL_2026_OPENING_MONTH];
  if (current === APRIL_2026_OPENING_CASH) return state;
  return {
    ...state,
    settings: {
      ...state.settings,
      cashOpeningBalances: {
        ...(state.settings.cashOpeningBalances || {}),
        [APRIL_2026_OPENING_MONTH]: APRIL_2026_OPENING_CASH,
      },
    },
  };
}

export function resolveCashOpeningBalance(
  settings: BusinessSettings,
  ledger: LedgerEntry[],
  month: string,
): number {
  const start = `${month}-01`;
  const anchors = Object.entries(settings.cashOpeningBalances || {})
    .filter(([anchorMonth, amount]) => /^\d{4}-\d{2}$/.test(anchorMonth) && Number.isFinite(amount) && anchorMonth <= month)
    .sort(([left], [right]) => left.localeCompare(right));
  const anchor = anchors.at(-1);

  if (!anchor) {
    return roundMoney(
      settings.openingCash + ledger
        .filter((entry) => entry.date < start)
        .reduce((sum, entry) => sum + entryCashEffect(entry), 0),
    );
  }

  const [anchorMonth, anchorAmount] = anchor;
  const anchorStart = `${anchorMonth}-01`;
  return roundMoney(
    anchorAmount + ledger
      .filter((entry) => entry.date >= anchorStart && entry.date < start)
      .reduce((sum, entry) => sum + entryCashEffect(entry), 0),
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
