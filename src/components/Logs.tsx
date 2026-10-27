"use client";
import { useCallback, useEffect, useState } from "react";
import { PButton } from "@/components/pulse-button";

type Log = {
  siteId: string;
  name: string;
  url: string;
  ts: number;
  code: number;
  ms: number;
  error?: string;
  warning?: string;
  detail?: string;
  ok: boolean;
};

export default function Logs() {
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [site, setSite] = useState("all");
  const load = useCallback(
    () =>
      fetch("/api/logs", { cache: "no-store" })
        .then((r) => r.json())
        .then(setLogs),
    [],
  );
  useEffect(() => {
    fetch("/api/sites")
      .then((r) => r.json())
      .then(setSites);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);

  async function erase() {
    const what =
      site === "all"
        ? "ALL logs for every website"
        : `all logs for ${sites.find((x) => x.id === site)?.name ?? "this website"}`;
    if (
      !confirm(
        `Erase ${what}, both errors and successful checks? Stats and uptime will start fresh. This cannot be undone.`,
      )
    )
      return;
    await fetch(site === "all" ? "/api/logs" : `/api/logs?siteId=${site}`, {
      method: "DELETE",
    });
    load();
  }
  async function removeOne(l: Log) {
    setLogs(
      (cur) =>
        cur && cur.filter((x) => !(x.siteId === l.siteId && x.ts === l.ts)),
    );
    await fetch(`/api/logs?siteId=${l.siteId}&ts=${l.ts}`, {
      method: "DELETE",
    });
  }

  const shown =
    logs && (site === "all" ? logs : logs.filter((l) => l.siteId === site));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Downtime logs</h1>
          <p className="text-sm text-white/60">
            Failed checks and warnings with the full error, newest first (last
            500).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="pselect"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          >
            <option value="all">All websites</option>
            {sites.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <PButton variant="danger" onClick={erase}>
            <span className="ico">🗑</span>{" "}
            {site === "all" ? "Erase all logs" : "Erase this website's logs"}
          </PButton>
        </div>
      </div>
      <div className="space-y-3">
        {shown?.map((l, i) => (
          <div
            key={`${l.siteId}-${l.ts}`}
            className="rise glass relative overflow-hidden rounded-2xl p-4 pl-6"
            style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}
          >
            <span
              className={`absolute inset-y-0 left-0 w-1.5 ${l.ok ? "bg-amber-400" : "bg-linear-to-b from-rose-500 to-orange-400"}`}
            />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{l.name}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${l.ok ? "bg-amber-400/20 text-amber-300" : "bg-rose-500/20 text-rose-300"}`}
                  >
                    {l.ok
                      ? "Warning"
                      : l.code
                        ? `HTTP ${l.code}`
                        : "No response"}
                  </span>
                  <span className="text-xs text-white/50">
                    {new Date(l.ts).toLocaleString()} · waited {l.ms} ms
                  </span>
                </div>
                <div className="break-all text-xs text-cyan-300">{l.url}</div>
              </div>
              <PButton
                icon
                variant="soft-danger"
                title="Delete this log"
                onClick={() => removeOne(l)}
              >
                <span className="ico">🗑</span>
              </PButton>
            </div>
            <p className="mt-2 wrap-break-words text-sm text-white/90">
              {l.error ?? l.warning}
            </p>
            {l.detail && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap wrap-break-words rounded-lg bg-black/30 p-3 font-mono text-xs text-white/70">
                {l.detail}
              </pre>
            )}
          </div>
        ))}
        {shown && shown.length === 0 && (
          <div className="glass rounded-2xl p-8 text-center text-emerald-300">
            Nothing to report. Everything is running smoothly.
          </div>
        )}
      </div>
    </div>
  );
}
