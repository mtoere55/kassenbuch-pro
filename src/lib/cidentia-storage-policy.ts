import { isValidCid, normalizeCid } from "./cidentia-session";

export interface CidentiaStoragePolicy {
  legacyOwnerCid?: string;
}

export function cidentiaStoragePolicy(): CidentiaStoragePolicy {
  const configured = process.env.KASSENBUCH_LEGACY_OWNER_CID;
  if (!configured?.trim()) return {};

  const legacyOwnerCid = normalizeCid(configured);
  if (!isValidCid(legacyOwnerCid)) {
    console.error("KASSENBUCH_LEGACY_OWNER_CID ist ungültig und wird ignoriert.");
    return {};
  }

  return { legacyOwnerCid };
}
