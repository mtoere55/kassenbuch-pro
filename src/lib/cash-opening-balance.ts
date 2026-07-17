import { entryCashEffect } from "./manual-booking";
import type { AppState } from "./types";

export const APRIL_2026_OPENING_DATE = "2026-04-01";
export const APRIL_2026_OPENING_CASH = 625.04;

export function ensureApril2026OpeningCash(state: AppState): AppState {
  const priorCashEffect = state.ledger
    .filter((entry) => entry.date < APRIL_2026_OPENING_DATE)
    .reduce((sum, entry) => sum + entryCashEffect(entry), 0);
  const requiredBaseOpening = roundMoney(APRIL_2026_OPENING_CASH - priorCashEffect);
  if (roundMoney(state.settings.openingCash) === requiredBaseOpening) return state;
  return {
    ...state,
    settings: {
      ...state.settings,
      openingCash: requiredBaseOpening,
    },
  };
}

export function calculateOpeningCashAtApril2026(state: AppState): number {
  return roundMoney(
    state.settings.openingCash + state.ledger
      .filter((entry) => entry.date < APRIL_2026_OPENING_DATE)
      .reduce((sum, entry) => sum + entryCashEffect(entry), 0),
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
