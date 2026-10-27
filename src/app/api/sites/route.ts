import { NextResponse } from "next/server";
import { readDB, writeDB, type Site } from "@/lib/db";
import { runChecks } from "@/lib/monitor";

export async function GET() {
  const db = await readDB();
  const since = Date.now() - 24 * 3600_000;
  const sites = db.sites.map((s) => {
    const all = db.checks.filter((c) => c.siteId === s.id);
    const day = all.filter((c) => c.ts >= since);
    const up = day.filter((c) => c.ok);
    return {
      ...s,
      uptime: day.length ? (up.length / day.length) * 100 : null,
      avgMs: up.length
        ? Math.round(up.reduce((a, c) => a + c.ms, 0) / up.length)
        : null,
      total: all.length,
      failures: all.filter((c) => !c.ok).length,
      history: all.slice(-30).map((c) => c.ok),
      last10: all
        .filter((c) => c.ts >= Date.now() - 600_000)
        .map((c) => ({ ts: c.ts, ok: c.ok, ms: c.ms })),
    };
  });
  return NextResponse.json(sites);
}

export async function POST(req: Request) {
  const { name, url, status, okCodes, ignoreCert } = await req.json();
  if (okCodes && !/^[\d\s,-]+$/.test(okCodes))
    return NextResponse.json(
      { error: "OK status codes look like 200-399,500" },
      { status: 400 },
    );
  try {
    new URL(url);
  } catch {
    return NextResponse.json(
      { error: "Enter a valid URL, e.g. https://example.com" },
      { status: 400 },
    );
  }
  if (!name?.trim())
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const site: Site = {
    id: crypto.randomUUID(),
    name: name.trim(),
    url,
    status: status ?? "active",
    health: "unknown",
    okCodes: okCodes?.trim() || undefined,
    ignoreCert: !!ignoreCert,
    createdAt: Date.now(),
  };
  const db = await readDB();
  db.sites.push(site);
  await writeDB(db);
  if (site.status !== "disabled") await runChecks(site.id);
  return NextResponse.json(site, { status: 201 });
}
