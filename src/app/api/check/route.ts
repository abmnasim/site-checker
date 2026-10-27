import { NextResponse } from "next/server";
import { runChecks } from "@/lib/monitor";

export async function POST(req: Request) {
  const { id } = await req.json().catch(() => ({}));
  await runChecks(id);
  return NextResponse.json({ ok: true });
}
