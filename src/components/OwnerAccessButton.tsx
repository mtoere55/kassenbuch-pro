"use client";

import { requestServiceAccess } from "@/lib/bookkeeping-rules";
import { Button } from "./ui";

export function OwnerAccessButton() {
  return <Button onClick={() => requestServiceAccess()}>Inhaberbereich öffnen</Button>;
}
