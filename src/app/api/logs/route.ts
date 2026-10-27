import { NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";

export async function GET() {
  const db = await readDB();
  const names = new Map(db.sites.map((s) => [s.id, s]));
  const logs = db.checks
    .filter((c) => (!c.ok || c.warning) && names.has(c.siteId))
    .slice(-500)
    .reverse()
    .map((c) => ({
      ...c,
      name: names.get(c.siteId)!.name,
      url: names.get(c.siteId)!.url,
    }));
  return NextResponse.json(logs);
}

/**
 * DELETE /api/logs                    erase every log (errors and successful checks) for all websites
 * DELETE /api/logs?siteId=..          erase every log of one website
 * DELETE /api/logs?siteId=..&ts=..    erase a single entry
 */
export async function DELETE(req: Request) {
  const q = new URL(req.url).searchParams;
  const siteId = q.get("siteId"),
    ts = Number(q.get("ts"));
  const db = await readDB();
  const before = db.checks.length;
  if (siteId && ts)
    db.checks = db.checks.filter((c) => !(c.siteId === siteId && c.ts === ts));
  else if (siteId) db.checks = db.checks.filter((c) => c.siteId !== siteId);
  else db.checks = [];
  await writeDB(db);
  return NextResponse.json({ removed: before - db.checks.length });
}
