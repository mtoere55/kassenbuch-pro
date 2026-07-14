import { NextRequest, NextResponse } from "next/server";
import { verifyCidWithCidentia } from "@/lib/cidentia-server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { cid?: string };
    const session = await verifyCidWithCidentia(body.cid || "");
    return NextResponse.json({ session });
  } catch (cause) {
    return NextResponse.json(
      { error: cause instanceof Error ? cause.message : "CID konnte nicht geprüft werden." },
      { status: 400 },
    );
  }
}
