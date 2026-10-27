import { NextResponse } from "next/server";
import { readDB, writeDB } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  const db = await readDB();
  const s = db.sites.find((x) => x.id === id);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (body.url) {
    try {
      new URL(body.url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }
    s.url = body.url;
  }
  if (body.okCodes !== undefined) {
    if (body.okCodes && !/^[\d\s,-]+$/.test(body.okCodes))
      return NextResponse.json(
        { error: "OK status codes look like 200-399,500" },
        { status: 400 },
      );
    s.okCodes = body.okCodes.trim() || undefined;
  }
  if (body.name) s.name = body.name.trim();
  if (body.status) {
    s.status = body.status;
    if (body.status === "disabled") {
      s.health = "unknown";
      s.downSince = undefined;
    }
  }
  await writeDB(db);
  return NextResponse.json(s);
}

export async function DELETE(_: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await readDB();
  db.sites = db.sites.filter((s) => s.id !== id);
  db.checks = db.checks.filter((c) => c.siteId !== id);
  await writeDB(db);
  return NextResponse.json({ ok: true });
}

export async function GET(_: Request, { params }: Ctx) {
  const { id } = await params;
  const db = await readDB();
  const site = db.sites.find((x) => x.id === id);
  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const all = db.checks.filter((c) => c.siteId === id);
  const now = Date.now();
  const pct = (ms: number) => {
    const c = ms ? all.filter((x) => x.ts >= now - ms) : all;
    return c.length ? (c.filter((x) => x.ok).length / c.length) * 100 : null;
  };
  const okMs = all.filter((c) => c.ok).map((c) => c.ms);
  const sum = okMs.reduce((a, b) => a + b, 0);
  let incidents = 0;
  all.forEach((c, i) => {
    if (!c.ok && (i === 0 || all[i - 1].ok)) incidents++;
  });
  return NextResponse.json({
    site,
    uptime: {
      h1: pct(3600e3),
      h24: pct(86400e3),
      d7: pct(604800e3),
      all: pct(0),
    },
    ms: {
      avg: okMs.length ? Math.round(sum / okMs.length) : null,
      min: okMs.length ? okMs.reduce((a, b) => Math.min(a, b)) : null,
      max: okMs.length ? okMs.reduce((a, b) => Math.max(a, b)) : null,
    },
    total: all.length,
    failures: all.filter((c) => !c.ok).length,
    warnings: all.filter((c) => c.warning).length,
    incidents,
    series: all.slice(-60),
    recent: all.slice(-12).reverse(),
  });
}
