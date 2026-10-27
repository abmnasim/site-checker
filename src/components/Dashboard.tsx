"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PButton } from "@/components/pulse-button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Status = "active" | "inactive" | "disabled";
type Pt = { ts: number; ok: boolean; ms: number };
type Full = Pt & {
  code: number;
  error?: string;
  warning?: string;
  detail?: string;
};
type SiteView = {
  id: string;
  name: string;
  url: string;
  status: Status;
  health: "up" | "down" | "unknown";
  lastCheck?: number;
  lastMs?: number;
  lastCode?: number;
  lastError?: string;
  lastDetail?: string;
  lastWarning?: string;
  okCodes?: string;
  ignoreCert?: boolean;
  downSince?: number;
  uptime: number | null;
  avgMs: number | null;
  total: number;
  failures: number;
  history: boolean[];
  last10: Pt[];
};
type Detail = {
  site: SiteView;
  uptime: Record<"h1" | "h24" | "d7" | "all", number | null>;
  ms: { avg: number | null; min: number | null; max: number | null };
  total: number;
  failures: number;
  warnings: number;
  incidents: number;
  series: Full[];
  recent: Full[];
};

const statusStyle: Record<Status, string> = {
  active: "bg-emerald-400/20 text-emerald-300 border-emerald-400/40",
  inactive: "bg-amber-400/20 text-amber-300 border-amber-400/40",
  disabled: "bg-slate-400/20 text-slate-300 border-slate-400/30",
};
const pct = (n: number | null) => (n == null ? "–" : `${n.toFixed(1)}%`);
const ms = (n: number | null | undefined) => (n == null ? "–" : `${n} ms`);
const healthLabel = {
  up: "Online",
  down: "Offline",
  unknown: "Pending",
} as const;

function Count({ to, suffix = "" }: { to: number; suffix?: string }) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current,
      t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      setV(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
      else prev.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return (
    <>
      {v}
      {suffix}
    </>
  );
}

export default function Dashboard() {
  const [sites, setSites] = useState<SiteView[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sound, setSound] = useState(false);
  const [editing, setEditing] = useState<Partial<SiteView> | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [now, setNow] = useState(0);
  const audio = useRef<AudioContext | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/sites", { cache: "no-store" });
    setSites(await r.json());
    setLoaded(true);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!openId) {
      setDetail(null);
      return;
    }
    const f = () =>
      fetch(`/api/sites/${openId}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setDetail(d));
    f();
    const t = setInterval(f, 5000);
    return () => clearInterval(t);
  }, [openId]);

  const alerts = sites.filter(
    (s) => s.status === "active" && s.health === "down",
  );

  useEffect(() => {
    if (!sound || alerts.length === 0) return;
    const beep = () => {
      const ctx = (audio.current ??= new AudioContext());
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.4);
    };
    beep();
    const t = setInterval(beep, 2500);
    return () => clearInterval(t);
  }, [sound, alerts.length]);

  async function save() {
    if (!editing) return;
    const { id, name, url, status, okCodes, ignoreCert } = editing;
    const res = await fetch(id ? `/api/sites/${id}` : "/api/sites", {
      method: id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        url,
        status: status ?? "active",
        okCodes: okCodes ?? "",
        ignoreCert: !!ignoreCert,
      }),
    });
    if (!res.ok) return setError((await res.json()).error);
    setEditing(null);
    setError("");
    load();
  }
  const patch = (id: string, body: object) =>
    fetch(`/api/sites/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).then(load);
  const remove = (s: SiteView) =>
    confirm(`Delete ${s.name}? Its history will be removed too.`) &&
    fetch(`/api/sites/${s.id}`, { method: "DELETE" }).then(load);
  const clearLogs = async () => {
    if (
      !confirm(
        "Erase ALL logs for every website, both errors and successful checks? Stats and uptime will start fresh. This cannot be undone.",
      )
    )
      return;
    await fetch("/api/logs", { method: "DELETE" });
    load();
  };
  const clearSiteLogs = async (s: { id: string; name: string }) => {
    if (
      !confirm(
        `Erase all logs for ${s.name}, both errors and successful checks? This cannot be undone.`,
      )
    )
      return;
    await fetch(`/api/logs?siteId=${s.id}`, { method: "DELETE" });
    load();
  };
  const delLog = (siteId: string, ts: number) =>
    fetch(`/api/logs?siteId=${siteId}&ts=${ts}`, { method: "DELETE" })
      .then(() =>
        fetch(`/api/sites/${siteId}`, { cache: "no-store" })
          .then((r) => r.json())
          .then(setDetail),
      )
      .then(load);
  const recheck = (id?: string) =>
    fetch("/api/check", { method: "POST", body: JSON.stringify({ id }) }).then(
      load,
    );

  const up = sites.filter((s) => s.health === "up").length;
  const down = sites.filter((s) => s.health === "down").length;
  const withMs = sites.filter((s) => s.avgMs != null);
  const avg = withMs.length
    ? Math.round(withMs.reduce((a, s) => a + s.avgMs!, 0) / withMs.length)
    : null;

  const last = Math.max(0, ...sites.map((s) => s.lastCheck ?? 0));
  const elapsed =
    last && now ? Math.min(60, Math.max(0, (now - last) / 1000)) : 0;
  const left = Math.max(0, Math.ceil(60 - elapsed));

  const tiles = [
    {
      label: "Websites",
      icon: "🌐",
      node: <Count to={sites.length} />,
      tone: "from-violet-400 to-fuchsia-500",
    },
    {
      label: "Online",
      icon: "✅",
      node: <Count to={up} />,
      tone: "from-emerald-300 to-cyan-400",
    },
    {
      label: "Offline",
      icon: "🚨",
      node: <Count to={down} />,
      tone: "from-rose-400 to-orange-400",
    },
    {
      label: "Avg response",
      icon: "⚡",
      node: avg == null ? "–" : <Count to={avg} suffix=" ms" />,
      tone: "from-amber-300 to-orange-500",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <svg width="46" height="46" viewBox="0 0 44 44" className="shrink-0">
            <circle
              cx="22"
              cy="22"
              r="18"
              stroke="#ffffff22"
              strokeWidth="4"
              fill="none"
            />
            <circle
              cx="22"
              cy="22"
              r="18"
              stroke="#2ee6a6"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
              strokeDasharray="113.1"
              strokeDashoffset={113.1 * (elapsed / 60)}
              transform="rotate(-90 22 22)"
              style={{ transition: "stroke-dashoffset 1s linear" }}
            />
            <text
              x="22"
              y="26"
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="#fff"
            >
              {sites.length ? left : "–"}
            </text>
          </svg>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Your websites</h1>
            <p className="text-sm text-white/60">
              {sites.length
                ? `${left === 0 ? "Checking now…" : `Next check in ${left}s`}. Last test: ${last ? new Date(last).toLocaleTimeString() : "none yet"}`
                : "Add a website to start monitoring."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <PButton
            variant={sound ? "ok" : "glass"}
            onClick={() => {
              audio.current ??= new AudioContext();
              setSound(!sound);
            }}
          >
            {sound ? "🔔 Alarm sound on" : "🔕 Turn alarm sound on"}
          </PButton>
          <PButton variant="glass" onClick={() => recheck()}>
            <span className="ico">↻</span> Check all now
          </PButton>
          <PButton variant="danger" onClick={clearLogs}>
            <span className="ico">🗑</span> Clear all logs
          </PButton>
          <PButton
            variant="primary"
            onClick={() => {
              setEditing({ status: "active", ignoreCert: true });
              setError("");
            }}
          >
            ＋ Add website
          </PButton>
        </div>
      </div>

      {alerts.length > 0 && (
        <div className="alert-blink rounded-2xl p-4 font-medium">
          🚨 {alerts.length} website{alerts.length > 1 ? "s are" : " is"} not
          responding: {alerts.map((a) => a.name).join(", ")}.
          <span className="ml-1 font-normal text-white/70">
            Set a site to inactive once you have handled it.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t, i) => (
          <div
            key={t.label}
            className="rise glass relative overflow-hidden rounded-2xl p-4"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="absolute right-3 top-2 text-2xl opacity-60">
              {t.icon}
            </span>
            <div className="text-sm text-white/60">{t.label}</div>
            <div
              className={`bg-linear-to-r ${t.tone} bg-clip-text text-3xl font-bold text-transparent`}
            >
              {t.node}
            </div>
          </div>
        ))}
      </div>

      {loaded && sites.length === 0 && (
        <div className="glass rounded-2xl p-10 text-center text-white/70">
          No websites yet. Add your first one to start monitoring.
        </div>
      )}

      <div className="space-y-3">
        {sites.map((s, i) => (
          <SiteRow
            key={s.id}
            s={s}
            i={i}
            onOpen={() => setOpenId(s.id)}
            onEdit={() => {
              setEditing(s);
              setError("");
            }}
            onDelete={() => remove(s)}
            onStatus={(st) => patch(s.id, { status: st })}
            onRecheck={() => recheck(s.id)}
            onAccept={(code) =>
              patch(s.id, {
                okCodes: `${s.okCodes || "200-399"},${code}`,
              }).then(() => recheck(s.id))
            }
            onClearLogs={() => clearSiteLogs(s)}
          />
        ))}
      </div>

      {/* Full stats popup */}
      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-white/20 bg-[#150f38] text-white sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              {detail?.site.name ?? "Loading…"}
              {detail && (
                <Badge
                  variant="outline"
                  className={statusStyle[detail.site.status]}
                >
                  {detail.site.status}
                </Badge>
              )}
            </DialogTitle>
            {detail && (
              <a
                href={detail.site.url}
                target="_blank"
                rel="noreferrer"
                className="truncate text-left text-sm text-cyan-300 hover:underline"
              >
                {detail.site.url}
              </a>
            )}
          </DialogHeader>
          {detail && (
            <div className="pop space-y-5">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Big
                  label="Now"
                  value={healthLabel[detail.site.health]}
                  tone={
                    detail.site.health === "up"
                      ? "text-emerald-300"
                      : detail.site.health === "down"
                        ? "text-rose-400"
                        : "text-white/70"
                  }
                />
                <Big label="Average speed" value={ms(detail.ms.avg)} />
                <Big label="Fastest" value={ms(detail.ms.min)} />
                <Big label="Slowest" value={ms(detail.ms.max)} />
                <Big label="Total checks" value={String(detail.total)} />
                <Big
                  label="Failed checks"
                  value={String(detail.failures)}
                  tone={detail.failures ? "text-rose-400" : undefined}
                />
                <Big label="Outages" value={String(detail.incidents)} />
                <Big
                  label="Cert warnings"
                  value={String(detail.warnings)}
                  tone={detail.warnings ? "text-amber-300" : undefined}
                />
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-white/70">
                  Uptime
                </h4>
                <div className="space-y-2">
                  {(
                    [
                      ["Last hour", detail.uptime.h1],
                      ["Last 24 hours", detail.uptime.h24],
                      ["Last 7 days", detail.uptime.d7],
                      ["All time", detail.uptime.all],
                    ] as const
                  ).map(([l, v]) => (
                    <div key={l} className="flex items-center gap-3 text-sm">
                      <span className="w-28 text-white/60">{l}</span>
                      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ${v != null && v < 99 ? "bg-linear-to-r from-amber-400 to-rose-500" : "bg-linear-to-r from-emerald-400 to-cyan-400"}`}
                          style={{ width: `${v ?? 0}%` }}
                        />
                      </div>
                      <span className="w-14 text-right font-semibold">
                        {pct(v)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-white/70">
                  Response time (last {detail.series.length} checks)
                </h4>
                <div className="rounded-xl bg-white/5 p-3">
                  <Chart pts={detail.series} />
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-white/70">
                  Recent checks
                </h4>
                <div className="divide-y divide-white/10 rounded-xl bg-white/5 text-sm">
                  {detail.recent.map((c) => (
                    <div key={c.ts} className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${c.ok ? (c.warning ? "bg-amber-400" : "bg-emerald-400") : "bg-rose-500"}`}
                        />
                        <span className="w-24 shrink-0 text-white/60">
                          {new Date(c.ts).toLocaleTimeString()}
                        </span>
                        <span className="w-12 shrink-0">{c.code || "–"}</span>
                        <span className="w-20 shrink-0">{c.ms} ms</span>
                        <span className="min-w-0 flex-1 wrap-break-words text-white/80">
                          {c.error ?? c.warning ?? "OK"}
                        </span>
                        {(!c.ok || c.warning) && (
                          <PButton
                            icon
                            variant="soft-danger"
                            title="Delete this log"
                            onClick={() => delLog(detail.site.id, c.ts)}
                          >
                            <span className="ico">🗑</span>
                          </PButton>
                        )}
                      </div>
                      {c.detail && (
                        <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap wrap-break-words rounded-lg bg-black/30 p-2 font-mono text-xs text-white/70">
                          {c.detail}
                        </pre>
                      )}
                    </div>
                  ))}
                  {detail.recent.length === 0 && (
                    <div className="p-3 text-white/50">No checks yet.</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <PButton
                  variant="glass"
                  onClick={() => recheck(detail.site.id)}
                >
                  <span className="ico">↻</span> Check now
                </PButton>
                <PButton
                  variant="soft-danger"
                  onClick={() => clearSiteLogs(detail.site)}
                >
                  <span className="ico">🧹</span> Clear logs for this website
                </PButton>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add / edit */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="border-white/20 bg-[#150f38] text-white">
          <DialogHeader>
            <DialogTitle>
              {editing?.id ? "Edit website" : "Add website"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Name, e.g. Company blog"
              value={editing?.name ?? ""}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
            <Input
              placeholder="https://example.com"
              value={editing?.url ?? ""}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
            />
            <Input
              placeholder="OK status codes (optional), e.g. 200-399,500"
              value={editing?.okCodes ?? ""}
              onChange={(e) =>
                setEditing({ ...editing, okCodes: e.target.value })
              }
            />
            <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/5 p-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-violet-500"
                checked={!!editing?.ignoreCert}
                onChange={(e) =>
                  setEditing({ ...editing, ignoreCert: e.target.checked })
                }
              />
              <span>
                Self-signed certificate: skip certificate checks (no warnings)
              </span>
            </label>
            <p className="text-xs text-white/50">
              Leave empty for the default (200-399). Add codes the site returns
              normally, like 500 or 403.
            </p>
            {error && <p className="text-sm text-rose-400">{error}</p>}
            <PButton variant="primary" className="w-full" onClick={save}>
              {editing?.id ? "Save changes" : "Add website"}
            </PButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SiteRow({
  s,
  i,
  onOpen,
  onEdit,
  onDelete,
  onStatus,
  onRecheck,
  onAccept,
  onClearLogs,
}: {
  s: SiteView;
  i: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onStatus: (st: Status) => void;
  onRecheck: () => void;
  onAccept: (code: number) => void;
  onClearLogs: () => void;
}) {
  const blink = s.status === "active" && s.health === "down";
  const live = s.health === "up" && s.status === "active";
  const dot =
    s.health === "up"
      ? "bg-emerald-400"
      : s.health === "down"
        ? "bg-rose-500"
        : "bg-slate-400";
  const accent =
    s.health === "up"
      ? "from-emerald-400 to-cyan-400"
      : s.health === "down"
        ? "from-rose-500 to-orange-400"
        : "from-slate-400 to-slate-500";
  const pts = s.last10;
  const okMs = pts.filter((p) => p.ok).map((p) => p.ms);
  const maxMs = Math.max(1, ...pts.map((p) => p.ms));
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div className="rise" style={{ animationDelay: `${i * 70}ms` }}>
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === "Enter" && onOpen()}
        className={`row group glass relative cursor-pointer overflow-hidden rounded-2xl ${blink ? "alert-blink" : ""} ${live ? "row-up" : ""}`}
      >
        <span
          className={`absolute inset-y-0 left-0 w-1.5 bg-linear-to-b ${accent}`}
        />
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 py-4 pl-6 pr-4">
          <span
            className={`relative h-3.5 w-3.5 shrink-0 rounded-full ${dot} ${live ? "dot-live" : ""}`}
          />
          <div className="min-w-45 flex-1">
            <h3 className="truncate text-lg font-semibold leading-tight">
              {s.name}
            </h3>
            <a
              href={s.url}
              onClick={stop}
              target="_blank"
              rel="noreferrer"
              className="block max-w-md truncate text-sm text-cyan-300 hover:underline"
            >
              {s.url}
            </a>
          </div>
          <div className="hidden h-7 w-28 items-end gap-0.5 lg:flex">
            {s.history.map((ok, k) => (
              <span
                key={k}
                className={`flex-1 rounded-sm ${ok ? "h-full bg-emerald-400/70" : "h-1/2 bg-rose-500"}`}
              />
            ))}
          </div>
          <Metric label="Uptime 24h" value={pct(s.uptime)} />
          <Metric label="Avg speed" value={ms(s.avgMs)} />
          <Metric
            label="Last test"
            value={
              s.lastCheck ? new Date(s.lastCheck).toLocaleTimeString() : "–"
            }
          />
          <Badge variant="outline" className={statusStyle[s.status]}>
            {s.status}
          </Badge>
          <div onClick={stop} className="flex items-center gap-1">
            <select
              value={s.status}
              onChange={(e) => onStatus(e.target.value as Status)}
              className="pselect"
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="disabled">Disabled</option>
            </select>
            <PButton icon title="Check now" onClick={onRecheck}>
              <span className="ico">↻</span>
            </PButton>
            <PButton icon title="Edit" onClick={onEdit}>
              <span className="ico">✎</span>
            </PButton>
            <PButton
              icon
              variant="soft-danger"
              title="Clear this website's logs"
              onClick={onClearLogs}
            >
              <span className="ico">🧹</span>
            </PButton>
            <PButton
              icon
              variant="soft-danger"
              title="Delete website"
              onClick={onDelete}
            >
              <span className="ico">🗑</span>
            </PButton>
          </div>
        </div>

        {s.health === "down" && (
          <div className="pb-3 pl-6 pr-4">
            <p className="wrap-break-words text-sm text-rose-200">
              Down: {s.lastError ?? "no response"}
              {s.downSince &&
                ` since ${new Date(s.downSince).toLocaleTimeString()}`}
            </p>
            {(s.lastCode ?? 0) >= 400 && (
              <PButton
                variant="ok"
                className="mt-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onAccept(s.lastCode!);
                }}
              >
                ✓ This is normal: accept HTTP {s.lastCode} as online
              </PButton>
            )}
            {s.lastDetail && (
              <pre
                onClick={stop}
                className="mt-2 max-h-28 cursor-text overflow-auto whitespace-pre-wrap wrap-break-words rounded-lg bg-black/30 p-2 font-mono text-xs text-rose-100/80"
              >
                {s.lastDetail}
              </pre>
            )}
          </div>
        )}
        {s.health === "up" && s.lastWarning && (
          <p className="pb-3 pl-6 pr-4 text-sm text-amber-300">
            ⚠ {s.lastWarning}. Reachable, so no alarm.
          </p>
        )}

        {/* Hover: last ten minutes */}
        <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-hover:grid-rows-[1fr]">
          <div className="overflow-hidden">
            <div className="flex flex-wrap items-end gap-6 border-t border-white/10 bg-black/20 py-4 pl-6 pr-4">
              <div className="min-w-55 flex-1">
                <div className="mb-2 text-xs text-white/50">
                  Last 10 minutes
                </div>
                <div className="flex h-14 items-end gap-1.5">
                  {pts.length === 0 && (
                    <span className="text-sm text-white/40">
                      No checks in the last 10 minutes.
                    </span>
                  )}
                  {pts.map((p, k) => (
                    <div
                      key={p.ts}
                      title={`${new Date(p.ts).toLocaleTimeString()}: ${p.ok ? p.ms + " ms" : "failed"}`}
                      className={`bar-in max-w-6 flex-1 rounded-t ${p.ok ? "bg-linear-to-t from-emerald-500 to-cyan-300" : "bg-linear-to-t from-rose-600 to-orange-400"}`}
                      style={{
                        height: `${Math.max(16, (p.ms / maxMs) * 100)}%`,
                        animationDelay: `${k * 45}ms`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <Metric
                label="Checks OK"
                value={`${pts.filter((p) => p.ok).length}/${pts.length}`}
              />
              <Metric
                label="Average"
                value={
                  okMs.length
                    ? `${Math.round(okMs.reduce((a, b) => a + b, 0) / okMs.length)} ms`
                    : "–"
                }
              />
              <Metric
                label="Fastest"
                value={okMs.length ? `${Math.min(...okMs)} ms` : "–"}
              />
              <Metric
                label="Slowest"
                value={okMs.length ? `${Math.max(...okMs)} ms` : "–"}
              />
              <span className="text-xs text-white/40">
                Click for full stats
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-19.5 text-center">
      <div className="font-semibold">{value}</div>
      <div className="text-[11px] text-white/50">{label}</div>
    </div>
  );
}
function Big({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-white/5 p-3">
      <div className={`text-xl font-bold ${tone ?? ""}`}>{value}</div>
      <div className="text-xs text-white/50">{label}</div>
    </div>
  );
}

function Chart({ pts }: { pts: Full[] }) {
  if (pts.length < 2)
    return <p className="text-sm text-white/50">Not enough data yet.</p>;
  const W = 320,
    H = 90,
    max = Math.max(1, ...pts.map((p) => p.ms));
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - 8 - (v / max) * (H - 20);
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.ms).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <defs>
        <linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7c5cff" stopOpacity=".55" />
          <stop offset="1" stopColor="#7c5cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#cg)" />
      <path
        d={line}
        fill="none"
        stroke="#2ee6a6"
        strokeWidth="2"
        pathLength={1}
        className="draw"
      />
      {pts.map(
        (p, i) =>
          !p.ok && (
            <circle key={i} cx={x(i)} cy={y(p.ms)} r="3.5" fill="#ff2d55" />
          ),
      )}
    </svg>
  );
}
